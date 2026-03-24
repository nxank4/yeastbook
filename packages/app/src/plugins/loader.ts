import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { existsSync } from "node:fs";
import type { YbkPlugin, OutputRendererPlugin } from "@codepawl/yeastbook-core";

function isValidPlugin(obj: unknown): obj is YbkPlugin {
  if (typeof obj !== "object" || obj === null) return false;
  const p = obj as Record<string, unknown>;
  return typeof p.name === "string" && typeof p.version === "string";
}

export class PluginLoader {
  private plugins: YbkPlugin[] = [];
  constructor(private pluginDir: string) {}

  async loadAll(): Promise<void> {
    this.plugins = [];
    if (!existsSync(this.pluginDir)) return;
    let files: string[];
    try { files = await readdir(this.pluginDir); } catch { return; }
    for (const f of files) {
      if (extname(f) !== ".ts" && extname(f) !== ".js") continue;
      try {
        const mod = await import(join(this.pluginDir, f));
        const plugin = mod.default ?? mod;
        if (isValidPlugin(plugin)) this.plugins.push(plugin);
      } catch {}
    }
  }

  registerPlugin(plugin: YbkPlugin): void {
    if (isValidPlugin(plugin)) this.plugins.push(plugin);
  }

  getPlugins(): YbkPlugin[] { return [...this.plugins]; }

  getRenderers(): OutputRendererPlugin[] {
    return this.plugins.flatMap((p) => p.renderers ?? []);
  }

  findRenderer(value: unknown): OutputRendererPlugin | null {
    for (const r of this.getRenderers()) {
      try { if (r.canRender(value)) return r; } catch {}
    }
    return null;
  }
}
