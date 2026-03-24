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


def handle_execute(req_id: str, code: str):
    """Execute Python code in the persistent namespace."""
    real_stdout, real_stderr = sys.stdout, sys.stderr
    captured_out = io.StringIO()
    captured_err = io.StringIO()

    sys.stdout = captured_out
    sys.stderr = captured_err

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
        sys.stdout = real_stdout
        sys.stderr = real_stderr

    # Send captured stdout
    stdout_text = captured_out.getvalue()
    if stdout_text:
        _write({"id": req_id, "type": "stream", "name": "stdout", "text": stdout_text})

    # Send captured stderr
    stderr_text = captured_err.getvalue()
    if stderr_text:
        _write({"id": req_id, "type": "stream", "name": "stderr", "text": stderr_text})

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
    """Raise KeyboardInterrupt to cancel running execution."""
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
