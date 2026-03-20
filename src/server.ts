// src/server.ts — Bun HTTP+WebSocket server for notebook execution

import { resolve } from "node:path";
import { Notebook } from "./notebook.ts";
import { executeCode } from "./kernel/execute.ts";

interface ServerState {
  notebook: Notebook;
  filePath: string;
  executionCount: number;
  context: Record<string, unknown>;
}

export async function startServer(filePath: string, port: number = 3000) {
  const absPath = resolve(filePath);
  const notebook = await Notebook.load(absPath);

  const state: ServerState = {
    notebook,
    filePath: absPath,
    executionCount: 0,
    context: {},
  };

  const distDir = resolve(import.meta.dirname!, "../dist");

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
        const filePath = resolve(distDir, url.pathname.slice(1));
        const file = Bun.file(filePath);
        return new Response(file);
      }
      return undefined;
    },
    routes: {
      "/": async () => {
        const html = await Bun.file(resolve(distDir, "index.html")).text();
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      "/api/notebook": {
        GET: () => Response.json(state.notebook.toJSON()),
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
      "/api/save": {
        POST: async () => {
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
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

          ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle" }));
          await state.notebook.save(state.filePath);
        }
      },
    },
  });

  return server;
}
