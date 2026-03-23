// src/kernel/snapshot.ts — Session snapshot: save and restore kernel context

import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface VariableEntry {
  value: unknown;
  type: string; // "string" | "number" | "object" | "array" | "boolean" | "function" | etc.
  serializable: boolean;
}

export interface SessionSnapshot {
  notebookPath: string;
  savedAt: string;
  executionCount: number;
  variables: Record<string, VariableEntry>;
}

/** Keys to skip when serializing globalThis / context */
const SKIP_KEYS = new Set([
  "__", "Bun", "$", "process", "global", "globalThis",
  "console", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "queueMicrotask", "structuredClone", "atob", "btoa",
  "fetch", "crypto", "performance", "navigator", "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "ReadableStream", "WritableStream",
  "TransformStream", "AbortController", "AbortSignal",
  "Headers", "Request", "Response", "WebSocket", "EventSource",
  "Buffer", "Blob", "File", "FormData",
]);

function shouldSkipKey(key: string): boolean {
  if (SKIP_KEYS.has(key)) return true;
  if (key.startsWith("__")) return true;
  if (key.startsWith("Bun")) return true;
  return false;
}

export function serializeContext(context: Record<string, unknown>): Record<string, VariableEntry> {
  const result: Record<string, VariableEntry> = {};

  for (const [key, value] of Object.entries(context)) {
    if (shouldSkipKey(key)) continue;

    const type = Array.isArray(value) ? "array" : typeof value;

    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        // JSON.stringify returns undefined for functions, symbols, etc.
        result[key] = { value: null, type, serializable: false };
        continue;
      }
      result[key] = {
        value: JSON.parse(serialized),
        type,
        serializable: true,
      };
    } catch {
      result[key] = { value: null, type, serializable: false };
    }
  }

  return result;
}

function getSnapshotPath(notebookPath: string): string {
  const hash = createHash("md5").update(notebookPath).digest("hex").slice(0, 8);
  return resolve(homedir(), ".yeastbook", "sessions", `${hash}.json`);
}

export async function saveSnapshot(notebookPath: string, snapshot: SessionSnapshot): Promise<void> {
  const sessionDir = resolve(homedir(), ".yeastbook", "sessions");
  await mkdir(sessionDir, { recursive: true });
  const snapshotPath = getSnapshotPath(notebookPath);
  await Bun.write(snapshotPath, JSON.stringify(snapshot, null, 2));
}

export async function loadSnapshot(notebookPath: string): Promise<SessionSnapshot | null> {
  const snapshotPath = getSnapshotPath(notebookPath);
  try {
    const file = Bun.file(snapshotPath);
    if (!(await file.exists())) return null;
    const snapshot = await file.json() as SessionSnapshot;

    // Expire after 24 hours
    const age = Date.now() - new Date(snapshot.savedAt).getTime();
    const MAX_AGE = 24 * 60 * 60 * 1000;
    if (age > MAX_AGE) return null;

    return snapshot;
  } catch {
    return null;
  }
}

export async function clearSnapshot(notebookPath: string): Promise<void> {
  const snapshotPath = getSnapshotPath(notebookPath);
  try { await unlink(snapshotPath); } catch {}
}
