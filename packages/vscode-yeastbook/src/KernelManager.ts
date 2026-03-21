import * as vscode from "vscode";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { statSync } from "node:fs";

interface KernelInfo { process: ChildProcess; port: number; }

export class KernelManager {
  private kernels = new Map<string, KernelInfo>();

  async startKernel(notebookPath: string): Promise<number> {
    const existing = this.kernels.get(notebookPath);
    if (existing && !existing.process.killed) return existing.port;

    const port = await this.findFreePort();
    const ybk = this.findYeastbook();
    if (!ybk) throw new Error("yeastbook not found. Install: bun install -g yeastbook");

    const proc = spawn("bun", [ybk, notebookPath, "--port", String(port), "--no-open"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Kernel timeout")), 10000);
      proc.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("running at")) { clearTimeout(t); resolve(); }
      });
      proc.on("error", (e) => { clearTimeout(t); reject(e); });
      proc.on("exit", (c) => { if (c) { clearTimeout(t); reject(new Error(`Exit ${c}`)); } });
    });

    this.kernels.set(notebookPath, { process: proc, port });
    return port;
  }

  async stopKernel(path: string) {
    const k = this.kernels.get(path);
    if (k) { k.process.kill(); this.kernels.delete(path); }
  }

  async stopAll() {
    for (const [, k] of this.kernels) k.process.kill();
    this.kernels.clear();
  }

  private findYeastbook(): string | null {
    try { return execFileSync("which", ["yeastbook"], { encoding: "utf-8" }).trim() || null; } catch {}
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const p = vscode.Uri.joinPath(f.uri, "node_modules", ".bin", "yeastbook").fsPath;
      try { if (statSync(p).isFile()) return p; } catch {}
    }
    return null;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = createServer();
      s.listen(0, () => {
        const a = s.address();
        if (a && typeof a !== "string") s.close(() => resolve(a.port));
        else s.close(() => reject(new Error("No free port")));
      });
      s.on("error", reject);
    });
  }
}
