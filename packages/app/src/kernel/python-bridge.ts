// src/kernel/python-bridge.ts — Manages a persistent Python daemon process
//
// Spawns a Python process running yeastbook_kernel.py, communicates via
// newline-delimited JSON over stdin/stdout. Provides venv discovery,
// lifecycle management, and the TypeScript side of YeastBridge.

import { join, dirname } from "path";
import type { Subprocess } from "bun";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PythonExecResult {
  value: string | null;
  stdout: string;
  stderr: string;
  mimeOutputs: Array<{ mime: string; data: string }>;
  error?: { ename: string; evalue: string; traceback: string[] };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onStream?: (msg: IpcMessage) => void;
  result: PythonExecResult;
}

interface IpcMessage {
  id?: string | null;
  type: string;
  [key: string]: unknown;
}

// ── YeastBridge (TS side) ────────────────────────────────────────────────────

export class YeastBridge {
  private store = new Map<string, unknown>();
  private kernel: PythonKernel | null = null;

  /** Link to the Python kernel for push operations. */
  _setKernel(kernel: PythonKernel | null) {
    this.kernel = kernel;
  }

  /** Push data to both local store and Python side. */
  push(key: string, value: unknown): void {
    this.store.set(key, value);
    if (this.kernel?.isRunning) {
      this.kernel.pushBridge(key, value).catch(() => {});
    }
  }

  /** Get data from local store. */
  get(key: string): unknown {
    return this.store.get(key);
  }

  /** List all keys. */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /** Internal: update store when Python side sets a value. */
  _onBridgeSet(key: string, value: unknown) {
    this.store.set(key, value);
  }

  /** Clear all data (on kernel restart). */
  _clear() {
    this.store.clear();
  }
}

// ── Python Kernel ────────────────────────────────────────────────────────────

export class PythonKernel {
  private proc: Subprocess | null = null;
  private pending = new Map<string, PendingRequest>();
  private pythonPath: string | null = null;
  private reqCounter = 0;
  private buffer = "";
  private _isRunning = false;
  private notebookDir: string;
  private onBridgeSet?: (key: string, value: unknown) => void;

  constructor(
    notebookDir: string,
    opts?: { onBridgeSet?: (key: string, value: unknown) => void },
  ) {
    this.notebookDir = notebookDir;
    this.onBridgeSet = opts?.onBridgeSet;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get detectedPythonPath(): string | null {
    return this.pythonPath;
  }

  // ── Venv Discovery ──────────────────────────────────────────────────────

  private async discoverPython(): Promise<string> {
    const dir = this.notebookDir;
    const isWindows = process.platform === "win32";
    const binDir = isWindows ? "Scripts" : "bin";
    const pyName = isWindows ? "python.exe" : "python3";
    const pyFallback = isWindows ? "python.exe" : "python";

    const candidates = [
      join(dir, ".venv", binDir, pyName),
      join(dir, "venv", binDir, pyName),
      join(dir, ".venv", binDir, pyFallback),
      join(dir, "venv", binDir, pyFallback),
    ];

    for (const p of candidates) {
      if (await Bun.file(p).exists()) {
        return p;
      }
    }

    // Fallback: system python3 (Bun.which is cross-platform)
    const python3 = Bun.which("python3");
    if (python3) return python3;

    const python = Bun.which("python");
    if (python) return python;

    throw new Error(
      "Python not found. Install Python 3 or create a virtualenv (.venv/ or venv/) in your project directory.",
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._isRunning) return;

    this.pythonPath = await this.discoverPython();

    const kernelScript = join(
      dirname(new URL(import.meta.url).pathname),
      "python",
      "yeastbook_kernel.py",
    );

    this.proc = Bun.spawn([this.pythonPath, kernelScript], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: this.notebookDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this._isRunning = true;

    // Read stdout for IPC messages
    this.readStdout();

    // Log stderr for diagnostics
    this.readStderr();

    // Monitor process exit
    this.proc.exited.then((code) => {
      this._isRunning = false;
      // Reject any pending requests
      for (const [id, req] of this.pending) {
        req.reject(new Error(`Python process exited with code ${code}`));
      }
      this.pending.clear();
      this.proc = null;
    });

    // Wait for ready message
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Python kernel failed to start within 10 seconds"));
      }, 10000);

      const checkReady = () => {
        // The ready message will be handled by readStdout, we just need to
        // wait a bit for it. We use a special pending entry.
        const id = "__ready__";
        this.pending.set(id, {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          result: { value: null, stdout: "", stderr: "", mimeOutputs: [] },
        });
      };
      checkReady();
    });
  }

  private async readStdout() {
    if (!this.proc?.stdout) return;

    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newlineIdx).trim();
          this.buffer = this.buffer.slice(newlineIdx + 1);

          if (!line) continue;

          try {
            const msg: IpcMessage = JSON.parse(line);
            this.handleMessage(msg);
          } catch {
            process.stderr.write(`[python-bridge] invalid JSON: ${line}\n`);
          }
        }
      }
    } catch {
      // Stream closed
    }
  }

  private async readStderr() {
    if (!this.proc?.stderr) return;

    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        process.stderr.write(`[python] ${decoder.decode(value, { stream: true })}`);
      }
    } catch {
      // Stream closed
    }
  }

  private handleMessage(msg: IpcMessage) {
    // Handle ready signal
    if (msg.type === "ready") {
      const readyReq = this.pending.get("__ready__");
      if (readyReq) {
        this.pending.delete("__ready__");
        readyReq.resolve(undefined);
      }
      return;
    }

    // Handle unsolicited bridge_set from Python
    if (msg.type === "bridge_set" && !msg.id) {
      this.onBridgeSet?.(msg.key as string, msg.value);
      return;
    }

    const id = msg.id as string;
    if (!id) return;

    const req = this.pending.get(id);
    if (!req) return;

    switch (msg.type) {
      case "stream":
        if (msg.name === "stdout") {
          req.result.stdout += msg.text as string;
        } else {
          req.result.stderr += msg.text as string;
        }
        req.onStream?.(msg);
        break;

      case "mime":
        req.result.mimeOutputs.push({
          mime: msg.mime as string,
          data: msg.data as string,
        });
        req.onStream?.(msg);
        break;

      case "result":
        req.result.value = (msg.value as string) ?? null;
        this.pending.delete(id);
        req.resolve(req.result);
        break;

      case "error":
        req.result.error = {
          ename: msg.ename as string,
          evalue: msg.evalue as string,
          traceback: (msg.traceback as string[]) ?? [],
        };
        this.pending.delete(id);
        req.resolve(req.result);
        break;

      case "bridge_ack":
      case "bridge_value":
      case "shutdown_ack":
        this.pending.delete(id);
        req.resolve(msg);
        break;

      case "bridge_set":
        // bridge_set with id — from a response to our request
        this.onBridgeSet?.(msg.key as string, msg.value);
        req.onStream?.(msg);
        break;
    }
  }

  // ── Execution ───────────────────────────────────────────────────────────

  async execute(
    code: string,
    onStream?: (msg: IpcMessage) => void,
  ): Promise<PythonExecResult> {
    if (!this._isRunning || !this.proc) {
      await this.start();
    }

    const id = `py-${++this.reqCounter}`;
    const request = JSON.stringify({ id, type: "execute", code }) + "\n";

    return new Promise<PythonExecResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onStream,
        result: { value: null, stdout: "", stderr: "", mimeOutputs: [] },
      });

      try {
        this.proc!.stdin.write(request);
      } catch (err) {
        this.pending.delete(id);
        reject(new Error(`Failed to write to Python process: ${err}`));
      }
    });
  }

  // ── Bridge IPC ──────────────────────────────────────────────────────────

  async pushBridge(key: string, value: unknown): Promise<void> {
    if (!this._isRunning || !this.proc) return;

    const id = `br-${++this.reqCounter}`;
    const request = JSON.stringify({ id, type: "bridge_push", key, value }) + "\n";

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        result: { value: null, stdout: "", stderr: "", mimeOutputs: [] },
      });

      try {
        this.proc!.stdin.write(request);
      } catch (err) {
        this.pending.delete(id);
        reject(new Error(`Failed to push bridge data: ${err}`));
      }
    });
  }

  async getBridge(key: string): Promise<unknown> {
    if (!this._isRunning || !this.proc) return undefined;

    const id = `br-${++this.reqCounter}`;
    const request = JSON.stringify({ id, type: "bridge_get", key }) + "\n";

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (msg: unknown) => resolve((msg as IpcMessage).value),
        reject,
        result: { value: null, stdout: "", stderr: "", mimeOutputs: [] },
      });

      try {
        this.proc!.stdin.write(request);
      } catch (err) {
        this.pending.delete(id);
        reject(new Error(`Failed to get bridge data: ${err}`));
      }
    });
  }

  // ── Interrupt & Shutdown ────────────────────────────────────────────────

  interrupt(): void {
    if (this.proc && this._isRunning) {
      this.proc.kill("SIGINT");
    }
  }

  async shutdown(): Promise<void> {
    if (!this.proc || !this._isRunning) return;

    // Try graceful shutdown first
    try {
      const id = `sh-${++this.reqCounter}`;
      const request = JSON.stringify({ id, type: "shutdown" }) + "\n";
      this.proc.stdin.write(request);

      // Give it 3 seconds to shut down gracefully
      const graceful = await Promise.race([
        this.proc.exited,
        new Promise<null>((r) => setTimeout(() => r(null), 3000)),
      ]);

      if (graceful === null && this.proc) {
        // Force kill
        this.proc.kill("SIGKILL");
      }
    } catch {
      // Process already dead or stdin closed
      try {
        this.proc?.kill("SIGKILL");
      } catch {}
    }

    this._isRunning = false;
    this.proc = null;
    this.pending.clear();
    this.buffer = "";
  }
}
