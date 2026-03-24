import * as vscode from "vscode";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { statSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

interface WsIncoming {
  type: string;
  cellId?: string;
  status?: "busy" | "idle";
  executionCount?: number;
  name?: "stdout" | "stderr";
  text?: string;
  value?: string;
  richOutput?: { type: string; [key: string]: unknown };
  ename?: string;
  evalue?: string;
  traceback?: string[];
  packages?: string[];
  stream?: "stdout" | "stderr";
  error?: string;
  success?: boolean;
}

export class YbkKernel {
  private controller: vscode.NotebookController;
  private process: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private port: number = 0;
  private notebookPath: string = "";
  private statusBar: vscode.StatusBarItem;
  private executionOrder = 0;
  private output: vscode.OutputChannel;
  private retryCount = 0;
  private maxRetries = 5;

  // Pending executions: cellId → { execution, resolve }
  private pending = new Map<string, {
    execution: vscode.NotebookCellExecution;
    resolve: () => void;
  }>();

  constructor(private context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Yeastbook");

    this.controller = vscode.notebooks.createNotebookController(
      "yeastbook-kernel",
      "yeastbook",
      "Bun Kernel",
    );
    this.controller.supportedLanguages = ["typescript", "javascript", "python"];
    this.controller.supportsExecutionOrder = true;
    this.controller.executeHandler = this.executeHandler.bind(this);
    this.controller.interruptHandler = this.interruptHandler.bind(this);

    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.command = "yeastbook.restartKernel";
    this.setStatus("stopped");

    context.subscriptions.push(this.controller, this.statusBar, this.output);
  }

  get serverPort(): number {
    return this.port;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  private setStatus(state: "stopped" | "starting" | "idle" | "busy" | "error") {
    const icons: Record<string, string> = {
      stopped: "$(circle-slash)",
      starting: "$(loading~spin)",
      idle: "$(circle-filled)",
      busy: "$(loading~spin)",
      error: "$(error)",
    };
    this.statusBar.text = `${icons[state]} Bun Kernel`;
    this.statusBar.tooltip = `Yeastbook Kernel: ${state} (click to restart)`;
    this.statusBar.show();
  }

  async startServer(notebookPath: string): Promise<void> {
    if (this.isRunning && this.notebookPath === notebookPath) return;
    await this.stopServer();

    this.notebookPath = notebookPath;
    this.setStatus("starting");

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Starting Bun Kernel",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: "Finding port..." });
        const config = vscode.workspace.getConfiguration("yeastbook");
        const configPort = config.get<number>("serverPort", 0);
        this.port = configPort || await this.findFreePort();

        progress.report({ increment: 20, message: "Resolving CLI..." });
        const bunPath = config.get<string>("bunPath", "bun");
        const cliPath = this.findYeastbook();
        if (!cliPath) {
          this.setStatus("error");
          throw new Error("yeastbook CLI not found. Install: bun install -g yeastbook");
        }

        progress.report({ increment: 10, message: "Spawning server..." });
        this.output.appendLine(`Starting server: ${bunPath} ${cliPath} ${notebookPath} --port ${this.port}`);

        this.process = spawn(bunPath, [cliPath, notebookPath, "--port", String(this.port), "--no-open"], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        const startupTimeout = config.get<number>("kernelStartupTimeout", 15000);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Kernel startup timed out")), startupTimeout);
          this.process!.stdout?.on("data", (d: Buffer) => {
            const text = d.toString();
            this.output.appendLine(`[stdout] ${text.trimEnd()}`);
            if (text.includes("running at")) {
              clearTimeout(timeout);
              resolve();
            }
          });
          this.process!.stderr?.on("data", (d: Buffer) => {
            const msg = d.toString();
            this.output.appendLine(`[stderr] ${msg.trimEnd()}`);
          });
          this.process!.on("error", (e) => {
            this.output.appendLine(`[error] Process error: ${e.message}`);
            clearTimeout(timeout);
            reject(e);
          });
          this.process!.on("exit", (code) => {
            if (code) {
              this.output.appendLine(`[exit] Server exited with code ${code}`);
              clearTimeout(timeout);
              reject(new Error(`Server exited with code ${code}`));
            }
          });
        });

        progress.report({ increment: 30, message: "Connecting WebSocket..." });
        await this.connectWebSocket();
        progress.report({ increment: 40, message: "Connected" });
        this.output.appendLine("Server started and WebSocket connected.");
        this.setStatus("idle");
      },
    );
  }

  async stopServer(): Promise<void> {
    this.ws?.close();
    this.ws = null;

    if (this.process && !this.process.killed) {
      const proc = this.process;
      proc.kill();

      // SIGKILL fallback after 3 seconds
      const killTimeout = setTimeout(() => {
        try {
          if (!proc.killed) {
            this.output.appendLine("Process did not exit after SIGTERM, sending SIGKILL.");
            proc.kill("SIGKILL");
          }
        } catch { /* already dead */ }
      }, 3000);

      proc.on("exit", () => clearTimeout(killTimeout));
    }

    this.process = null;
    this.notebookPath = "";
    this.port = 0;
    this.executionOrder = 0;
    this.retryCount = 0;
    this.setStatus("stopped");
    this.output.appendLine("Server stopped.");

    // Reject any pending executions
    for (const [, pending] of this.pending) {
      pending.execution.end(false, Date.now());
      pending.resolve();
    }
    this.pending.clear();
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `ws://localhost:${this.port}/ws`;
      this.output.appendLine(`Connecting WebSocket to ${url}`);
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => reject(new Error("WebSocket connection timed out")), 5000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.retryCount = 0;
        this.output.appendLine("WebSocket connected.");
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg: WsIncoming = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch { /* ignore non-JSON messages */ }
      });

      this.ws.on("close", () => {
        this.output.appendLine("WebSocket disconnected.");

        // End all pending executions with error
        for (const [cellId, pending] of this.pending) {
          pending.execution.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.error(new Error("Connection lost")),
          ]));
          pending.execution.end(false, Date.now());
          pending.resolve();
          this.pending.delete(cellId);
        }

        if (this.isRunning) {
          this.setStatus("error");
          this.retryCount++;
          if (this.retryCount <= this.maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000);
            this.output.appendLine(`Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})...`);
            setTimeout(() => {
              if (this.isRunning) this.connectWebSocket().catch(() => {});
            }, delay);
          } else {
            this.output.appendLine("Max reconnection attempts reached. Giving up.");
            this.setStatus("error");
            vscode.window.showErrorMessage(
              "Kernel connection lost and could not reconnect. Restart the kernel to continue.",
              "Restart Kernel",
            ).then((choice) => {
              if (choice === "Restart Kernel") {
                vscode.commands.executeCommand("yeastbook.restartKernel");
              }
            });
          }
        }
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        this.output.appendLine(`WebSocket error: ${err.message}`);
        reject(err);
      });
    });
  }

  private handleMessage(msg: WsIncoming): void {
    const cellId = msg.cellId;
    if (!cellId) {
      // Non-cell messages (status updates, etc.)
      if (msg.type === "status") {
        this.setStatus(msg.status === "busy" ? "busy" : "idle");
      }
      return;
    }

    const pending = this.pending.get(cellId);
    if (!pending) return;

    const { execution } = pending;

    switch (msg.type) {
      case "stream": {
        const text = msg.text ?? "";
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(text, "text/plain"),
        ]));
        break;
      }

      case "result": {
        const items: vscode.NotebookCellOutputItem[] = [];
        if (msg.richOutput) {
          const mimeMap: Record<string, string> = {
            chart: "x-application/yeastbook-chart",
            table: "x-application/yeastbook-table",
            json: "x-application/yeastbook-json",
            html: "x-application/yeastbook-html",
            widget: "x-application/yeastbook-widget",
          };
          const mime = mimeMap[msg.richOutput.type];
          if (mime) {
            items.push(vscode.NotebookCellOutputItem.text(
              JSON.stringify(msg.richOutput), mime,
            ));
          }
        }
        if (msg.value !== undefined) {
          items.push(vscode.NotebookCellOutputItem.text(msg.value, "text/plain"));
        }
        if (items.length > 0) {
          execution.appendOutput(new vscode.NotebookCellOutput(items));
        }
        break;
      }

      case "error": {
        const errMsg = `${msg.ename}: ${msg.evalue}\n${(msg.traceback ?? []).join("\n")}`;
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(new Error(errMsg)),
        ]));
        // Error ends execution
        execution.end(false, Date.now());
        pending.resolve();
        this.pending.delete(cellId);
        break;
      }

      case "status": {
        if (msg.status === "idle") {
          this.setStatus("idle");
          execution.end(true, Date.now());
          pending.resolve();
          this.pending.delete(cellId);
        } else {
          this.setStatus("busy");
        }
        break;
      }

      case "install_start": {
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            `Installing packages: ${(msg.packages ?? []).join(", ")}...`,
            "text/plain",
          ),
        ]));
        break;
      }

      case "install_log": {
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(msg.text ?? "", "text/plain"),
        ]));
        break;
      }

      case "install_done": {
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text("Packages installed successfully.", "text/plain"),
        ]));
        break;
      }

      case "install_error": {
        execution.appendOutput(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(new Error(`Install failed: ${msg.error}`)),
        ]));
        break;
      }
    }
  }

  private async executeHandler(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
  ): Promise<void> {
    // VS Code passes cancellation token via controller.interruptHandler, not executeHandler
    // We use a per-cell token approach instead via the controller's interrupt
    // Ensure server is running
    if (!this.isRunning) {
      try {
        await this.startServer(notebook.uri.fsPath);
      } catch (e) {
        vscode.window.showErrorMessage(
          `Failed to start kernel: ${e instanceof Error ? e.message : e}`,
        );
        return;
      }
    }

    for (const cell of cells) {
      await this.executeCell(cell);
    }
  }

  private interruptHandler(): void {
    this.output.appendLine("Interrupt requested — cancelling all pending executions.");
    this.interrupt();
    for (const [cellId, pending] of this.pending) {
      pending.execution.appendOutput(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text("Execution interrupted.", "text/plain"),
      ]));
      pending.execution.end(false, Date.now());
      pending.resolve();
      this.pending.delete(cellId);
    }
  }

  private async executeCell(cell: vscode.NotebookCell): Promise<void> {
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this.executionOrder;
    execution.start(Date.now());
    execution.clearOutput();

    const cellId = cell.metadata?.id ?? `vscode-${cell.index}`;
    const code = cell.document.getText();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      execution.appendOutput(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.error(new Error("WebSocket not connected")),
      ]));
      execution.end(false, Date.now());
      vscode.window.showErrorMessage(
        "Kernel WebSocket is not connected. Try restarting the kernel.",
        "Restart Kernel",
      ).then((choice) => {
        if (choice === "Restart Kernel") {
          vscode.commands.executeCommand("yeastbook.restartKernel");
        }
      });
      return;
    }

    return new Promise<void>((resolve) => {
      this.pending.set(cellId, { execution, resolve });

      // Send execute message
      this.ws!.send(JSON.stringify({
        type: "execute",
        cellId,
        code,
      }));

      this.output.appendLine(`Executing cell ${cellId}`);

      // Timeout safety: resolve after 5 minutes if no response
      const timeout = setTimeout(() => {
        if (this.pending.has(cellId)) {
          execution.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.error(new Error("Execution timed out")),
          ]));
          execution.end(false, Date.now());
          this.pending.delete(cellId);
          resolve();
        }
      }, 300000);

      // Clean up timeout when execution completes
      this.pending.set(cellId, {
        execution,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });
  }

  interrupt(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  private findYeastbook(): string | null {
    // 1. Check global install
    try {
      const p = execFileSync("which", ["yeastbook"], { encoding: "utf-8" }).trim();
      if (p) return p;
    } catch { /* not found */ }

    // 2. Check workspace node_modules
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const p = join(folder.uri.fsPath, "node_modules", ".bin", "yeastbook");
      try { if (statSync(p).isFile()) return p; } catch { /* skip */ }
    }

    // 3. Check monorepo CLI path
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const p = join(folder.uri.fsPath, "packages", "app", "src", "cli.ts");
      try { if (statSync(p).isFile()) return p; } catch { /* skip */ }
    }

    return null;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          server.close(() => resolve(addr.port));
        } else {
          server.close(() => reject(new Error("Could not find free port")));
        }
      });
      server.on("error", reject);
    });
  }

  dispose(): void {
    this.stopServer();
    this.statusBar.dispose();
    this.controller.dispose();
  }
}
