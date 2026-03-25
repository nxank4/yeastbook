import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import { Glob } from "bun";

let server: Awaited<ReturnType<typeof import("../packages/app/src/server.ts").startServer>>;
const tmpPath = `/tmp/yeastbook-server-test-${Date.now()}.ipynb`;
let baseUrl: string;
let wsUrl: string;
const cleanupPaths: string[] = [tmpPath];

beforeAll(async () => {
  const { startServer } = await import("../packages/app/src/server.ts");
  server = await startServer(tmpPath, 0); // port 0 = random
  const port = server.port;
  baseUrl = `http://localhost:${port}`;
  wsUrl = `ws://localhost:${port}/ws`;
});

afterAll(async () => {
  server?.stop();
  for (const p of cleanupPaths) {
    try { await unlink(p); } catch {}
  }
});

describe("HTTP routes", () => {
  test("GET / serves HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /api/notebook returns notebook JSON", async () => {
    const res = await fetch(`${baseUrl}/api/notebook`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.nbformat).toBe(4);
    expect(data.cells).toBeArray();
  });

  test("POST /api/cells adds a cell", async () => {
    const res = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "1+1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBeDefined();
  });

  test("DELETE /api/cells/:id removes a cell", async () => {
    const addRes = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "delete me" }),
    });
    const { id } = await addRes.json() as any;
    const delRes = await fetch(`${baseUrl}/api/cells/${id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });

  test("PATCH /api/cells/:id updates cell source", async () => {
    const addRes = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "old" }),
    });
    const { id } = await addRes.json() as any;
    const patchRes = await fetch(`${baseUrl}/api/cells/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "new" }),
    });
    expect(patchRes.status).toBe(200);
    const nbRes = await fetch(`${baseUrl}/api/notebook`);
    const nb = await nbRes.json() as any;
    const cell = nb.cells.find((c: any) => c.id === id);
    expect(cell.source).toEqual(["new"]);
  });
});

describe("WebSocket execution", () => {
  test("execute returns result", async () => {
    const addRes = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "1+1" }),
    });
    const { id: cellId } = await addRes.json() as any;
    const messages: any[] = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "execute", cellId, code: "1 + 1" }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        messages.push(msg);
        if (msg.type === "status" && msg.status === "idle") resolve();
      };
    });
    ws.close();
    expect(messages.find((m) => m.type === "status" && m.status === "busy")).toBeDefined();
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    expect(result.value).toBe("2");
    expect(result.executionCount).toBeGreaterThanOrEqual(1);
    expect(messages.find((m) => m.type === "status" && m.status === "idle")).toBeDefined();
  });

  test("execute captures stdout", async () => {
    const addRes = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "" }),
    });
    const { id: cellId } = await addRes.json() as any;
    const messages: any[] = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "execute", cellId, code: 'console.log("hi")' }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        messages.push(msg);
        if (msg.type === "status" && msg.status === "idle") resolve();
      };
    });
    ws.close();
    const stream = messages.find((m) => m.type === "stream" && m.name === "stdout");
    expect(stream).toBeDefined();
    expect(stream.text).toContain("hi");
  });

  test("execute returns error", async () => {
    const addRes = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "" }),
    });
    const { id: cellId } = await addRes.json() as any;
    const messages: any[] = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "execute", cellId, code: "throw new Error('boom')" }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        messages.push(msg);
        if (msg.type === "status" && msg.status === "idle") resolve();
      };
    });
    ws.close();
    const err = messages.find((m) => m.type === "error");
    expect(err).toBeDefined();
    expect(err.ename).toBe("Error");
    expect(err.evalue).toBe("boom");
  });

  test("shared execution context across cells", async () => {
    const addRes1 = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "" }),
    });
    const { id: cellId1 } = await addRes1.json() as any;
    const addRes2 = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "" }),
    });
    const { id: cellId2 } = await addRes2.json() as any;
    const ws = new WebSocket(wsUrl);
    // Execute first cell: define a variable
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "execute", cellId: cellId1, code: "var testCtx = 99" }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "status" && msg.status === "idle") resolve();
      };
    });
    // Execute second cell: read the variable
    const messages: any[] = [];
    await new Promise<void>((resolve) => {
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        messages.push(msg);
        if (msg.type === "status" && msg.status === "idle") resolve();
      };
      ws.send(JSON.stringify({ type: "execute", cellId: cellId2, code: "testCtx" }));
    });
    ws.close();
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    expect(result.value).toBe("99");
  });
});

describe("New API endpoints", () => {
  test("POST /api/new creates a new .ybk notebook", async () => {
    const res = await fetch(`${baseUrl}/api/new`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.fileName).toMatch(/\.ybk$/);
    expect(data.fileFormat).toBe("ybk");
    expect(data.cells).toBeArray();
    // Track for cleanup
    if (data.filePath) cleanupPaths.push(data.filePath);
  });

  test("POST /api/export/ipynb exports notebook", async () => {
    // First load back the test ipynb
    await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tmpPath }),
    });
    const res = await fetch(`${baseUrl}/api/export/ipynb`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.fileName).toMatch(/\.ipynb$/);
    expect(data.path).toBeDefined();
    cleanupPaths.push(data.path);
  });

  test("POST /api/export/ybk exports notebook", async () => {
    const res = await fetch(`${baseUrl}/api/export/ybk`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.fileName).toMatch(/\.ybk$/);
    expect(data.path).toBeDefined();
    cleanupPaths.push(data.path);
  });

  test("POST /api/import loads a notebook", async () => {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tmpPath }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.fileName).toBeDefined();
    expect(data.fileFormat).toBe("ipynb");
    expect(data.cells).toBeArray();
  });

  test("POST /api/cells/insert inserts cell after specified cell", async () => {
    // Add two cells
    const res1 = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "first" }),
    });
    const { id: firstId } = await res1.json() as any;

    const res2 = await fetch(`${baseUrl}/api/cells`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "third" }),
    });

    // Insert between them
    const insertRes = await fetch(`${baseUrl}/api/cells/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "second", afterId: firstId }),
    });
    expect(insertRes.status).toBe(200);
    const { id: insertedId } = await insertRes.json() as any;
    expect(insertedId).toBeDefined();

    // Verify order
    const nbRes = await fetch(`${baseUrl}/api/notebook`);
    const nb = await nbRes.json() as any;
    const firstIdx = nb.cells.findIndex((c: any) => c.id === firstId);
    const insertedIdx = nb.cells.findIndex((c: any) => c.id === insertedId);
    expect(insertedIdx).toBe(firstIdx + 1);
  });
});
