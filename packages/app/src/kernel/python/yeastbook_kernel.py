#!/usr/bin/env python3
"""Yeastbook Python kernel daemon — persistent process with JSON-line IPC.

Reads newline-delimited JSON from stdin, executes Python code in a persistent
namespace, writes JSON responses to stdout. Variables, imports, and state
persist across cell executions.

IPC Protocol:
  Request (stdin):  {"id": str, "type": "execute"|"bridge_push"|"bridge_get"|"shutdown", ...}
  Response (stdout): {"id": str, "type": "stream"|"result"|"error"|"mime"|"bridge_ack"|"bridge_value"|"bridge_set", ...}
"""

import sys
import json
import ast
import io
import signal
import base64
import traceback

# ── Persistent state ──────────────────────────────────────────────────────────

import os
os.environ["MPLBACKEND"] = "Agg"  # Force non-interactive backend before any matplotlib import

_namespace = {"__name__": "__main__", "__builtins__": __builtins__}
_bridge = {}


# ── Output helpers ────────────────────────────────────────────────────────────

# Keep a reference to the real stdout for IPC — sys.stdout gets redirected
# during code execution to capture user output.
_real_stdout = sys.stdout

def _write(msg: dict):
    """Write a JSON message to the real stdout (the IPC channel)."""
    _real_stdout.write(json.dumps(msg, default=_json_default) + "\n")
    _real_stdout.flush()


def _json_default(obj):
    """JSON serializer for objects not serializable by default."""
    try:
        import numpy as np
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
    except ImportError:
        pass
    return repr(obj)


def _serialize_value(obj):
    """Serialize a Python value to JSON-safe representation."""
    if obj is None:
        return None
    try:
        json.dumps(obj, default=_json_default)
        return obj
    except (TypeError, ValueError):
        return repr(obj)


# ── Rich output detection ────────────────────────────────────────────────────

def _check_matplotlib():
    """If matplotlib has active figures, render them as base64 PNG."""
    try:
        import matplotlib.pyplot as plt
        figs = [plt.figure(i) for i in plt.get_fignums()]
        results = []
        for fig in figs:
            if fig.get_axes():
                buf = io.BytesIO()
                fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
                buf.seek(0)
                results.append(base64.b64encode(buf.read()).decode("ascii"))
                buf.close()
        plt.close("all")
        return results
    except ImportError:
        return []
    except Exception:
        return []


def _try_serialize_pil(obj):
    """If obj is a PIL Image, return base64 PNG."""
    try:
        from PIL import Image
        if isinstance(obj, Image.Image):
            buf = io.BytesIO()
            obj.save(buf, format="PNG")
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("ascii")
    except ImportError:
        pass
    return None


# ── YeastBridge ───────────────────────────────────────────────────────────────

class YeastBridge:
    """Bi-directional data bridge between TypeScript and Python.

    Usage in Python cells:
        yb.get("key")           # read data pushed from TS
        yb.set("key", value)    # push data to TS side
    """

    def get(self, key, default=None):
        return _bridge.get(key, default)

    def set(self, key, value):
        _bridge[key] = value
        _write({
            "type": "bridge_set",
            "key": key,
            "value": _serialize_value(value),
        })

    def keys(self):
        return list(_bridge.keys())

    def __repr__(self):
        return f"YeastBridge(keys={list(_bridge.keys())})"


_namespace["yb"] = YeastBridge()


# ── Code execution ───────────────────────────────────────────────────────────

def _split_last_expr(code: str):
    """Split code into (exec_part, last_expression_or_None).

    If the last statement is a standalone expression (not assignment, not print,
    not import, etc.), return it separately so we can eval() it for a return value.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return code, None

    if not tree.body:
        return code, None

    last = tree.body[-1]
    if isinstance(last, ast.Expr):
        # The last statement is a bare expression — split it out
        if len(tree.body) == 1:
            segment = ast.get_source_segment(code, last)
            return "", segment if segment is not None else code.strip()
        # Get everything except the last statement
        lines = code.split("\n")
        last_line = last.lineno - 1  # 0-indexed
        exec_part = "\n".join(lines[:last_line])
        expr_part = "\n".join(lines[last_line:])
        return exec_part, expr_part

    return code, None


import subprocess as _subprocess
import os as _os

# Track running child processes so SIGINT can kill them
_active_child: _subprocess.Popen | None = None


def _ensure_pip():
    """Ensure pip is available, install via ensurepip if missing."""
    check = _subprocess.run(
        [sys.executable, "-m", "pip", "--version"],
        capture_output=True, text=True,
    )
    if check.returncode != 0:
        _subprocess.run(
            [sys.executable, "-m", "ensurepip", "--upgrade"],
            capture_output=True, text=True,
        )


def _run_subprocess_interruptible(cmd: list[str], req_id: str, timeout: int = 600) -> int:
    """Run a subprocess that can be interrupted by SIGINT. Streams output."""
    global _active_child
    try:
        proc = _subprocess.Popen(
            cmd,
            stdout=_subprocess.PIPE,
            stderr=_subprocess.STDOUT,
            text=True,
            # Use process group so we can kill the entire tree
            preexec_fn=_os.setsid,
        )
        _active_child = proc

        # Stream output line by line
        for line in iter(proc.stdout.readline, ""):
            _write({"id": req_id, "type": "stream", "stream": "stdout", "text": line})

        proc.wait(timeout=timeout)
        return proc.returncode
    except KeyboardInterrupt:
        if proc and proc.poll() is None:
            try:
                _os.killpg(_os.getpgid(proc.pid), 9)
            except (ProcessLookupError, PermissionError):
                proc.kill()
            proc.wait()
        raise
    finally:
        _active_child = None


def _handle_pip_magic(req_id: str, code: str) -> bool:
    """Handle %pip and !pip magic commands. Supports multiple lines."""
    lines = code.strip().splitlines()
    # Check if ALL non-empty lines are pip magics
    pip_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("%pip ") or line.startswith("!pip "):
            pip_lines.append(line)
        else:
            return False  # Mixed content — not a pure pip magic cell

    if not pip_lines:
        return False

    _ensure_pip()
    try:
        for line in pip_lines:
            args = line.split(None, 1)[1] if " " in line else ""
            cmd = [sys.executable, "-m", "pip"] + args.split()
            returncode = _run_subprocess_interruptible(cmd, req_id)
            if returncode != 0:
                _write({"id": req_id, "type": "error", "ename": "PipError",
                       "evalue": f"pip exited with code {returncode}",
                       "traceback": [f"pip install failed (exit code {returncode})"]})
                return True
        _write({"id": req_id, "type": "result", "value": None})
    except KeyboardInterrupt:
        _write({"id": req_id, "type": "error", "ename": "KeyboardInterrupt",
               "evalue": "Installation interrupted",
               "traceback": ["KeyboardInterrupt: Installation interrupted"]})
    except Exception as e:
        _write({"id": req_id, "type": "error", "ename": type(e).__name__,
               "evalue": str(e), "traceback": [str(e)]})
    return True


class _StreamWriter:
    """Streams output to the IPC channel in real-time instead of buffering."""
    def __init__(self, req_id: str, stream_name: str):
        self.req_id = req_id
        self.stream_name = stream_name
        self.buffer = ""

    def write(self, text):
        if not text:
            return 0
        self.buffer += text
        if "\n" in text or len(self.buffer) > 256:
            self.flush()
        return len(text)

    def flush(self):
        if self.buffer:
            _write({"id": self.req_id, "type": "stream", "stream": self.stream_name, "text": self.buffer})
            self.buffer = ""

    def isatty(self):
        return False


def handle_execute(req_id: str, code: str):
    """Execute Python code in the persistent namespace."""
    # Handle %pip / !pip magic before normal execution
    if _handle_pip_magic(req_id, code):
        return

    real_stdout, real_stderr = sys.stdout, sys.stderr
    stream_out = _StreamWriter(req_id, "stdout")
    stream_err = _StreamWriter(req_id, "stderr")

    sys.stdout = stream_out
    sys.stderr = stream_err

    result_value = None
    error = None

    try:
        exec_part, expr_part = _split_last_expr(code)

        if exec_part.strip():
            compiled = compile(exec_part, "<cell>", "exec")
            exec(compiled, _namespace)

        if expr_part is not None and expr_part.strip():
            compiled = compile(expr_part.strip(), "<cell>", "eval")
            result_value = eval(compiled, _namespace)

    except KeyboardInterrupt:
        error = {
            "ename": "KeyboardInterrupt",
            "evalue": "Execution interrupted",
            "traceback": ["KeyboardInterrupt: Execution interrupted"],
        }
    except Exception as e:
        error = {
            "ename": type(e).__name__,
            "evalue": str(e),
            "traceback": traceback.format_exception(e),
        }
    finally:
        # Flush remaining buffered output before restoring
        stream_out.flush()
        stream_err.flush()
        sys.stdout = real_stdout
        sys.stderr = real_stderr

    # Check for matplotlib figures
    for png_b64 in _check_matplotlib():
        _write({"id": req_id, "type": "mime", "mime": "image/png", "data": png_b64})

    # Check if result is a PIL Image
    if result_value is not None:
        pil_b64 = _try_serialize_pil(result_value)
        if pil_b64:
            _write({"id": req_id, "type": "mime", "mime": "image/png", "data": pil_b64})
            result_value = f"<PIL.Image {result_value.size[0]}x{result_value.size[1]}>"

    if error:
        _write({"id": req_id, "type": "error", **error})
    else:
        _write({
            "id": req_id,
            "type": "result",
            "value": repr(result_value) if result_value is not None else None,
        })


# ── Signal handling ───────────────────────────────────────────────────────────

def _sigint_handler(signum, frame):
    """Raise KeyboardInterrupt to cancel running execution. Kill child processes first."""
    global _active_child
    if _active_child is not None and _active_child.poll() is None:
        try:
            _os.killpg(_os.getpgid(_active_child.pid), 9)
        except (ProcessLookupError, PermissionError):
            try:
                _active_child.kill()
            except Exception:
                pass
        _active_child = None
    raise KeyboardInterrupt("Execution interrupted")


signal.signal(signal.SIGINT, _sigint_handler)


# ── Main loop ────────────────────────────────────────────────────────────────

def main():
    # Signal readiness
    _write({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _write({"type": "error", "id": None, "ename": "JSONDecodeError",
                     "evalue": str(e), "traceback": []})
            continue

        req_type = req.get("type")
        req_id = req.get("id")

        if req_type == "execute":
            handle_execute(req_id, req.get("code", ""))

        elif req_type == "bridge_push":
            _bridge[req["key"]] = req.get("value")
            _write({"id": req_id, "type": "bridge_ack", "key": req["key"]})

        elif req_type == "bridge_get":
            val = _bridge.get(req.get("key"))
            _write({"id": req_id, "type": "bridge_value",
                     "key": req.get("key"), "value": _serialize_value(val)})

        elif req_type == "shutdown":
            _write({"id": req_id, "type": "shutdown_ack"})
            break

        else:
            _write({"id": req_id, "type": "error",
                     "ename": "UnknownRequest", "evalue": f"Unknown type: {req_type}",
                     "traceback": []})


if __name__ == "__main__":
    main()
