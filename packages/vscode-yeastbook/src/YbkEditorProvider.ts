import * as vscode from "vscode";
import type { KernelManager } from "./KernelManager";

export class YbkEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private kernelManager: KernelManager) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    let port: number;
    try { port = await this.kernelManager.startKernel(document.uri.fsPath); }
    catch (e) {
      vscode.window.showErrorMessage(`Failed to start kernel: ${e instanceof Error ? e.message : e}`);
      return;
    }

    panel.webview.options = { enableScripts: true };
    panel.webview.html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src http://localhost:${port}; style-src 'unsafe-inline';">
  <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:none}</style>
</head><body>
  <iframe src="http://localhost:${port}" allow="clipboard-read; clipboard-write"></iframe>
</body></html>`;

    panel.onDidDispose(() => this.kernelManager.stopKernel(document.uri.fsPath));
  }
}
