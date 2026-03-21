import * as vscode from "vscode";
import { YbkEditorProvider } from "./YbkEditorProvider";
import { KernelManager } from "./KernelManager";

export function activate(context: vscode.ExtensionContext) {
  const km = new KernelManager();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("yeastbook.notebook",
      new YbkEditorProvider(km), { webviewOptions: { retainContextWhenHidden: true } }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.newNotebook", async () => {
      const uri = await vscode.window.showSaveDialog({
        filters: { "Yeastbook Notebook": ["ybk"] },
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(
          JSON.stringify({ version: "0.1.0", cells: [], metadata: {}, settings: {} }, null, 2)));
        await vscode.commands.executeCommand("vscode.openWith", uri, "yeastbook.notebook");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.restartKernel", async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input && "uri" in (tab.input as any)) {
        const fp = ((tab.input as any).uri as vscode.Uri).fsPath;
        await km.stopKernel(fp);
        await km.startKernel(fp);
        vscode.window.showInformationMessage("Kernel restarted.");
      }
    }),
  );

  context.subscriptions.push({ dispose: () => km.stopAll() });
}

export function deactivate() {}
