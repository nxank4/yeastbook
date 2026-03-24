import * as vscode from "vscode";
import { YbkSerializer } from "./YbkSerializer";
import { YbkKernel } from "./YbkKernel";

let kernel: YbkKernel | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Register notebook serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer("yeastbook", new YbkSerializer(), {
      transientOutputs: false,
    }),
  );

  // Create kernel (registers controller internally)
  kernel = new YbkKernel(context);

  // Auto-start server when a yeastbook notebook is opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
      if (notebook.notebookType !== "yeastbook") return;
      const config = vscode.workspace.getConfiguration("yeastbook");
      if (config.get<boolean>("autoStartServer", true)) {
        try {
          await kernel!.startServer(notebook.uri.fsPath);
        } catch (e) {
          // Silently fail — user can manually start via Shift+Enter
          console.error("[yeastbook] Auto-start failed:", e);
        }
      }
    }),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.runAll", async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== "yeastbook") return;

      const codeCells = editor.notebook.getCells().filter(
        (cell) => cell.kind === vscode.NotebookCellKind.Code,
      );
      if (codeCells.length === 0) return;

      await vscode.commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: 0, end: editor.notebook.cellCount }],
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.restartKernel", async () => {
      if (!kernel) return;
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== "yeastbook") return;

      await kernel.stopServer();
      await kernel.startServer(editor.notebook.uri.fsPath);
      vscode.window.showInformationMessage("Yeastbook kernel restarted.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.showServerLogs", () => {
      kernel?.showOutputChannel();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.openInBrowser", () => {
      if (!kernel?.isRunning || !kernel.serverPort) {
        vscode.window.showWarningMessage("Kernel not running. Run a cell first.");
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${kernel.serverPort}`));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.exportScript", async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== "yeastbook") return;

      const codeCells = editor.notebook.getCells()
        .filter((cell) => cell.kind === vscode.NotebookCellKind.Code)
        .map((cell) => cell.document.getText());

      const script = codeCells.join("\n\n");
      const uri = await vscode.window.showSaveDialog({
        filters: { "TypeScript": ["ts"] },
        defaultUri: vscode.Uri.file(
          editor.notebook.uri.fsPath.replace(/\.ybk$/, ".ts"),
        ),
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(script));
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.stripOutputs", async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== "yeastbook") return;

      // Read current file, strip outputs, write back
      const content = await vscode.workspace.fs.readFile(editor.notebook.uri);
      try {
        const ybk = JSON.parse(new TextDecoder().decode(content));
        if (ybk.cells) {
          for (const cell of ybk.cells) {
            delete cell.outputs;
            delete cell.executionCount;
          }
        }
        await vscode.workspace.fs.writeFile(
          editor.notebook.uri,
          new TextEncoder().encode(JSON.stringify(ybk, null, 2) + "\n"),
        );
        vscode.window.showInformationMessage("Outputs stripped.");
      } catch {
        vscode.window.showErrorMessage("Failed to strip outputs.");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.selectPythonEnvironment", async () => {
      if (!kernel?.isRunning || !kernel.serverPort) {
        vscode.window.showWarningMessage("Kernel not running. Run a cell first to start the server.");
        return;
      }
      try {
        const resp = await fetch(`http://localhost:${kernel.serverPort}/api/python/environments`);
        const { environments, active } = await resp.json() as {
          environments: Array<{ path: string; label: string; type: string; version?: string }>;
          active: string | null;
        };

        if (environments.length === 0) {
          vscode.window.showInformationMessage("No Python environments found.");
          return;
        }

        const items = environments.map((env) => ({
          label: env.path === active ? `$(check) ${env.label}` : env.label,
          description: env.path,
          detail: env.version ? `Python ${env.version}` : undefined,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select Python Environment",
        });

        if (selected) {
          await fetch(`http://localhost:${kernel.serverPort}/api/python/select`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pythonPath: selected.description }),
          });
          vscode.window.showInformationMessage(`Python environment set to: ${selected.description}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to fetch environments: ${e}`);
      }
    }),
  );

  // Clean up on dispose
  context.subscriptions.push({ dispose: () => kernel?.dispose() });
}

export function deactivate() {
  kernel?.dispose();
  kernel = undefined;
}
