// src/server.ts — Bun HTTP+WebSocket server for notebook execution

import { resolve, basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { rename, mkdir } from "node:fs/promises";
import { Notebook } from "./notebook.ts";
import { executeCode } from "./kernel/execute.ts";
import type { Settings } from "./ui/types.ts";
import { DEFAULT_SETTINGS } from "./ui/types.ts";

const SETTINGS_DIR = join(homedir(), ".yeastbook");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

async function loadSettings(): Promise<Settings> {
  try {
    const file = Bun.file(SETTINGS_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return { ...DEFAULT_SETTINGS, ...data,
        editor: { ...DEFAULT_SETTINGS.editor, ...data.editor },
        appearance: { ...DEFAULT_SETTINGS.appearance, ...data.appearance },
        execution: { ...DEFAULT_SETTINGS.execution, ...data.execution },
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

interface ServerState {
  notebook: Notebook;
  filePath: string;
  executionCount: number;
  context: Record<string, unknown>;
}

export async function startServer(filePath: string, port: number = 3000) {
  const absPath = resolve(filePath);
  const notebook = await Notebook.load(absPath);

  const settings = await loadSettings();

  const state: ServerState = {
    notebook,
    filePath: absPath,
    executionCount: 0,
    context: {},
  };

  const distDir = resolve(import.meta.dirname!, "../dist");

  const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
  };

  const server = Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      // Serve static files from dist/
      if (url.pathname !== "/" && !url.pathname.startsWith("/api/")) {
        const safePath = url.pathname.slice(1).replace(/\.\./g, "");
        const filePath = resolve(distDir, safePath);
        const ext = safePath.substring(safePath.lastIndexOf("."));
        const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
        const file = Bun.file(filePath);
        return new Response(file, {
          headers: { "Content-Type": contentType },
        });
      }
      return undefined;
    },
    routes: {
      "/": async () => {
        return new Response(Bun.file(resolve(distDir, "index.html")), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      "/api/notebook": {
        GET: () => Response.json({ ...state.notebook.toJSON(), filePath: state.filePath, fileName: basename(state.filePath) }),
      },
      "/api/cells": {
        POST: async (req) => {
          const body = await req.json() as { type: "code" | "markdown"; source?: string };
          const id = state.notebook.addCell(body.type, body.source ?? "");
          await state.notebook.save(state.filePath);
          return Response.json({ id });
        },
      },
      "/api/cells/:id": {
        DELETE: async (req) => {
          state.notebook.deleteCell(req.params.id);
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
        PATCH: async (req) => {
          const body = await req.json() as { source: string };
          state.notebook.updateCellSource(req.params.id, body.source);
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
      },
      "/api/cells/:id/move": {
        POST: async (req) => {
          const body = await req.json() as { direction: "up" | "down" };
          state.notebook.moveCell(req.params.id, body.direction);
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
      },
      "/api/rename": {
        POST: async (req) => {
          const body = await req.json() as { name: string };
          const newName = body.name.endsWith(".ipynb") ? body.name : body.name + ".ipynb";
          const newPath = join(dirname(state.filePath), newName);
          await rename(state.filePath, newPath);
          state.filePath = newPath;
          return Response.json({ fileName: basename(newPath) });
        },
      },
      "/api/restart": {
        POST: () => {
          state.context = {};
          state.executionCount = 0;
          return Response.json({ ok: true });
        },
      },
      "/api/save": {
        POST: async () => {
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
      },
      "/api/settings": {
        GET: async () => {
          const pkg = await Bun.file(resolve(import.meta.dirname!, "../package.json")).json();
          return Response.json({
            ...settings,
            version: pkg.version,
            bunVersion: Bun.version,
          });
        },
        POST: async (req) => {
          const body = await req.json() as Partial<Settings>;
          Object.assign(settings.editor, body.editor);
          Object.assign(settings.appearance, body.appearance);
          Object.assign(settings.execution, body.execution);
          await saveSettings(settings);
          const pkg = await Bun.file(resolve(import.meta.dirname!, "../package.json")).json();
          return Response.json({
            ...settings,
            version: pkg.version,
            bunVersion: Bun.version,
          });
        },
      },
    },
    websocket: {
      open() {},
      async message(ws, message) {
        const msg = JSON.parse(message as string) as
          | { type: "execute"; cellId: string; code: string }
          | { type: "interrupt" };

        if (msg.type === "execute") {
          ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "busy" }));

          state.executionCount++;
          const result = await executeCode(msg.code, state.context);

          state.notebook.updateCellSource(msg.cellId, msg.code);
          state.notebook.setCellOutput(msg.cellId, state.executionCount, {
            value: result.value !== undefined ? Bun.inspect(result.value) : undefined,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          });

          if (result.stdout) {
            ws.send(JSON.stringify({
              type: "stream", cellId: msg.cellId, name: "stdout", text: result.stdout,
            }));
          }
          if (result.stderr) {
            ws.send(JSON.stringify({
              type: "stream", cellId: msg.cellId, name: "stderr", text: result.stderr,
            }));
          }
          if (result.error) {
            ws.send(JSON.stringify({
              type: "error",
              cellId: msg.cellId,
              ename: result.error.ename,
              evalue: result.error.evalue,
              traceback: result.error.traceback,
            }));
          } else if (result.value !== undefined) {
            ws.send(JSON.stringify({
              type: "result",
              cellId: msg.cellId,
              value: Bun.inspect(result.value),
              executionCount: state.executionCount,
            }));
          }

          ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle", executionCount: state.executionCount }));
          await state.notebook.save(state.filePath);
        }
      },
    },
  });

  return server;
}
