# Yeastbook Jupyter Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fully working Jupyter kernel that runs TypeScript on Bun runtime via ZeroMQ.

**Architecture:** Three files — protocol layer (message types, HMAC signing, frame serialization), kernel class (5 ZMQ sockets, execution engine with shared globalThis context), and CLI entrypoint (start/install/uninstall). Code execution uses `AsyncFunction` constructor with last-expression detection for return values.

**Tech Stack:** Bun runtime, zeromq 6.5.0 (native addon), node:crypto for HMAC-SHA256

**Spec:** `docs/superpowers/specs/2026-03-20-jupyter-kernel-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/protocol/messages.ts` | Types (ConnectionInfo, MessageHeader, JupyterMessage), HMAC signing, frame parse/serialize, message factory |
| `src/kernel/index.ts` | Kernel class: socket lifecycle, heartbeat, shell/control dispatch, code execution engine, iopub broadcasting |
| `src/cli.ts` | CLI entrypoint: parse args, start kernel, install/uninstall kernelspec |
| `tests/protocol.test.ts` | Tests for message signing, serialization, deserialization, factory |
| `tests/kernel.test.ts` | Tests for code execution engine (last-expression detection, globalThis context, console capture) |

---

## Task 1: Message Protocol Types and HMAC Signing

**Files:**
- Create: `src/protocol/messages.ts`
- Create: `tests/protocol.test.ts`

- [ ] **Step 1: Write failing tests for HMAC signing and message creation**

```ts
// tests/protocol.test.ts
import { test, expect, describe } from "bun:test";
import { sign, createMessage } from "../src/protocol/messages.ts";

describe("HMAC signing", () => {
  test("signs concatenated frames with SHA256", () => {
    const sig = sign("test-key", "header", "parent", "meta", "content");
    expect(sig).toBeString();
    expect(sig).toHaveLength(64); // hex-encoded SHA256
  });

  test("same input produces same signature", () => {
    const sig1 = sign("key", "a", "b", "c", "d");
    const sig2 = sign("key", "a", "b", "c", "d");
    expect(sig1).toBe(sig2);
  });

  test("different input produces different signature", () => {
    const sig1 = sign("key", "a", "b", "c", "d");
    const sig2 = sign("key", "a", "b", "c", "e");
    expect(sig1).not.toBe(sig2);
  });

  test("empty key returns empty signature", () => {
    const sig = sign("", "a", "b", "c", "d");
    expect(sig).toBe("");
  });
});

describe("createMessage", () => {
  test("creates message with correct msg_type", () => {
    const msg = createMessage("kernel_info_reply", { status: "ok" });
    expect(msg.header.msg_type).toBe("kernel_info_reply");
    expect(msg.content).toEqual({ status: "ok" });
  });

  test("generates unique msg_id", () => {
    const msg1 = createMessage("status", {});
    const msg2 = createMessage("status", {});
    expect(msg1.header.msg_id).not.toBe(msg2.header.msg_id);
  });

  test("sets parent_header from parent message", () => {
    const parent = createMessage("execute_request", { code: "1+1" });
    const reply = createMessage("execute_reply", { status: "ok" }, parent);
    expect(reply.parent_header).toEqual(parent.header);
  });

  test("sets protocol version to 5.3", () => {
    const msg = createMessage("status", {});
    expect(msg.header.version).toBe("5.3");
  });

  test("sets ISO date string", () => {
    const msg = createMessage("status", {});
    expect(msg.header.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/protocol.test.ts`
Expected: FAIL — imports don't resolve to real exports yet

- [ ] **Step 3: Implement types and signing**

```ts
// src/protocol/messages.ts
import { createHmac } from "node:crypto";

export interface ConnectionInfo {
  ip: string;
  transport: string;
  shell_port: number;
  iopub_port: number;
  stdin_port: number;
  control_port: number;
  hb_port: number;
  key: string;
  signature_scheme: string;
  kernel_name: string;
}

export interface MessageHeader {
  msg_id: string;
  session: string;
  username: string;
  msg_type: string;
  version: string;
  date: string;
}

export interface JupyterMessage {
  identities: Buffer[];
  header: MessageHeader;
  parent_header: MessageHeader | Record<string, never>;
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
}

const SESSION_ID = crypto.randomUUID();

export function sign(
  key: string,
  header: string,
  parent_header: string,
  metadata: string,
  content: string,
): string {
  if (!key) return "";
  const hmac = createHmac("sha256", key);
  hmac.update(header);
  hmac.update(parent_header);
  hmac.update(metadata);
  hmac.update(content);
  return hmac.digest("hex");
}

export function createMessage(
  msgType: string,
  content: Record<string, unknown>,
  parent?: JupyterMessage,
): JupyterMessage {
  return {
    identities: parent?.identities ?? [],
    header: {
      msg_id: crypto.randomUUID(),
      session: SESSION_ID,
      username: "yeastbook",
      msg_type: msgType,
      version: "5.3",
      date: new Date().toISOString(),
    },
    parent_header: parent?.header ?? {},
    metadata: {},
    content,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/protocol.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol/messages.ts tests/protocol.test.ts
git commit -m "feat: add message types and HMAC signing"
```

---

## Task 2: Frame Serialization and Deserialization

**Files:**
- Modify: `src/protocol/messages.ts`
- Modify: `tests/protocol.test.ts`

- [ ] **Step 1: Write failing tests for serialize/deserialize**

Update the import in `tests/protocol.test.ts` to add `serialize` and `deserialize`, then append these test blocks:

```ts
// Update existing import to:
// import { sign, createMessage, serialize, deserialize } from "../src/protocol/messages.ts";

describe("serialize", () => {
  test("produces correct frame structure", () => {
    const msg = createMessage("status", { execution_state: "idle" });
    msg.identities = [Buffer.from("client-id")];
    const frames = serialize(msg, "test-key");
    // [identity, delimiter, signature, header, parent_header, metadata, content]
    expect(frames).toHaveLength(7);
    expect(frames[0]).toEqual(Buffer.from("client-id"));
    expect(frames[1]).toEqual(Buffer.from("<IDS|MSG>"));
    expect(frames[2]).toBeInstanceOf(Buffer); // signature
    // frames 3-6 are JSON buffers
    expect(JSON.parse(frames[3]!.toString())).toHaveProperty("msg_type", "status");
  });

  test("signature matches sign() output", () => {
    const msg = createMessage("status", { execution_state: "idle" });
    msg.identities = [Buffer.from("test-id")];
    const frames = serialize(msg, "my-key");
    // frames: [identity, delimiter, signature, header, parent, meta, content]
    const headerStr = frames[3]!.toString();
    const parentStr = frames[4]!.toString();
    const metaStr = frames[5]!.toString();
    const contentStr = frames[6]!.toString();
    const expected = sign("my-key", headerStr, parentStr, metaStr, contentStr);
    expect(frames[2]!.toString()).toBe(expected);
  });
});

describe("deserialize", () => {
  test("round-trips through serialize/deserialize", () => {
    const msg = createMessage("execute_request", { code: "1+1" });
    msg.identities = [Buffer.from("abc")];
    const frames = serialize(msg, "key123");
    const restored = deserialize(frames, "key123");
    expect(restored.header.msg_type).toBe("execute_request");
    expect(restored.content).toEqual({ code: "1+1" });
    expect(restored.identities).toEqual([Buffer.from("abc")]);
  });

  test("throws on invalid signature", () => {
    const msg = createMessage("status", {});
    const frames = serialize(msg, "key1");
    expect(() => deserialize(frames, "wrong-key")).toThrow();
  });

  test("skips signature check when key is empty", () => {
    const msg = createMessage("status", {});
    const frames = serialize(msg, "");
    const restored = deserialize(frames, "");
    expect(restored.header.msg_type).toBe("status");
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `bun test tests/protocol.test.ts`
Expected: New serialize/deserialize tests FAIL

- [ ] **Step 3: Implement serialize and deserialize**

Add to `src/protocol/messages.ts`:

```ts
const DELIMITER = Buffer.from("<IDS|MSG>");

export function serialize(msg: JupyterMessage, key: string): Buffer[] {
  const headerStr = JSON.stringify(msg.header);
  const parentStr = JSON.stringify(msg.parent_header);
  const metadataStr = JSON.stringify(msg.metadata);
  const contentStr = JSON.stringify(msg.content);
  const sig = sign(key, headerStr, parentStr, metadataStr, contentStr);

  return [
    ...msg.identities,
    DELIMITER,
    Buffer.from(sig),
    Buffer.from(headerStr),
    Buffer.from(parentStr),
    Buffer.from(metadataStr),
    Buffer.from(contentStr),
  ];
}

export function deserialize(frames: Buffer[], key: string): JupyterMessage {
  // Find delimiter index
  let delimIdx = -1;
  for (let i = 0; i < frames.length; i++) {
    if (Buffer.isBuffer(frames[i]) && frames[i]!.equals(DELIMITER)) {
      delimIdx = i;
      break;
    }
  }
  if (delimIdx === -1) {
    throw new Error("Missing <IDS|MSG> delimiter in message frames");
  }

  const identities = frames.slice(0, delimIdx) as Buffer[];
  const signature = frames[delimIdx + 1]!.toString();
  const headerStr = frames[delimIdx + 2]!.toString();
  const parentStr = frames[delimIdx + 3]!.toString();
  const metadataStr = frames[delimIdx + 4]!.toString();
  const contentStr = frames[delimIdx + 5]!.toString();

  // Validate signature
  if (key) {
    const expected = sign(key, headerStr, parentStr, metadataStr, contentStr);
    if (signature !== expected) {
      throw new Error("Invalid message signature");
    }
  }

  return {
    identities,
    header: JSON.parse(headerStr),
    parent_header: JSON.parse(parentStr),
    metadata: JSON.parse(metadataStr),
    content: JSON.parse(contentStr),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/protocol.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol/messages.ts tests/protocol.test.ts
git commit -m "feat: add frame serialization and deserialization"
```

---

## Task 3: Code Execution Engine

**Files:**
- Create: `tests/kernel.test.ts`
- Modify: `src/kernel/index.ts` (add execution logic that we'll test standalone)

The execution engine is the most complex part. We build and test it independently before wiring it to sockets.

- [ ] **Step 1: Write failing tests for code execution**

```ts
// tests/kernel.test.ts
import { test, expect, describe } from "bun:test";
import { executeCode } from "../src/kernel/index.ts";

describe("executeCode", () => {
  test("returns last expression value", async () => {
    const result = await executeCode("1 + 2", {});
    expect(result.value).toBe(3);
    expect(result.error).toBeUndefined();
  });

  test("captures console.log output", async () => {
    const result = await executeCode('console.log("hello")', {});
    expect(result.stdout).toContain("hello");
  });

  test("captures console.error as stderr", async () => {
    const result = await executeCode('console.error("oops")', {});
    expect(result.stderr).toContain("oops");
  });

  test("persists variables across calls via context", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("var x = 42", ctx);
    const result = await executeCode("x", ctx);
    expect(result.value).toBe(42);
  });

  test("returns undefined for statements", async () => {
    const result = await executeCode("let a = 1", {});
    expect(result.value).toBeUndefined();
  });

  test("catches errors and returns traceback", async () => {
    const result = await executeCode("throw new Error('boom')", {});
    expect(result.error).toBeDefined();
    expect(result.error!.ename).toBe("Error");
    expect(result.error!.evalue).toBe("boom");
    expect(result.error!.traceback.length).toBeGreaterThan(0);
  });

  test("handles async code", async () => {
    const result = await executeCode("await Promise.resolve(99)", {});
    expect(result.value).toBe(99);
  });

  test("does not return value for for-loops", async () => {
    const result = await executeCode("for (let i = 0; i < 3; i++) {}", {});
    expect(result.value).toBeUndefined();
  });

  test("does not return value for if-statements", async () => {
    const result = await executeCode("if (true) { 42 }", {});
    expect(result.value).toBeUndefined();
  });

  test("handles multiline code with last expression", async () => {
    const result = await executeCode("const a = 10\nconst b = 20\na + b", {});
    expect(result.value).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/kernel.test.ts`
Expected: FAIL — `executeCode` not exported

- [ ] **Step 3: Implement the execution engine**

Write the following into `src/kernel/index.ts` (we'll add the Kernel class in the next task, but the execution engine comes first):

```ts
// src/kernel/index.ts

export interface ExecResult {
  value: unknown;
  stdout: string;
  stderr: string;
  error?: { ename: string; evalue: string; traceback: string[] };
}

const STATEMENT_PREFIXES = [
  "let ", "const ", "var ", "if ", "if(", "for ", "for(",
  "while ", "while(", "do ", "do{", "class ", "function ",
  "return ", "throw ", "try ", "try{", "switch ", "switch(",
  "import ", "export ", "{", "//", "/*",
];

function shouldReturnLastLine(line: string): boolean {
  const trimmed = line.trimStart();
  return !STATEMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

function wrapCode(code: string): string {
  const lines = code.split("\n");
  // Find last non-empty line
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx]!.trim()) {
    lastIdx--;
  }
  if (lastIdx < 0) return code;

  const lastLine = lines[lastIdx]!;
  if (shouldReturnLastLine(lastLine)) {
    lines[lastIdx] = `return (${lastLine.trim()})`;
  }
  return lines.join("\n");
}

export async function executeCode(
  code: string,
  context: Record<string, unknown>,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";

  // Snapshot globalThis keys before execution
  const keysBefore = new Set(Object.keys(globalThis));

  // Inject context into globalThis
  Object.assign(globalThis, context);

  // Monkey-patch console
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };
  console.warn = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const wrapped = wrapCode(code);
    const fn = new AsyncFunction(wrapped);
    const value = await fn();

    // Capture new globalThis keys into context
    for (const key of Object.keys(globalThis)) {
      if (!keysBefore.has(key)) {
        context[key] = (globalThis as Record<string, unknown>)[key];
      }
    }

    return { value, stdout, stderr };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      value: undefined,
      stdout,
      stderr,
      error: {
        ename: error.constructor.name,
        evalue: error.message,
        traceback: (error.stack ?? "").split("\n"),
      },
    };
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/kernel.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/kernel/index.ts tests/kernel.test.ts
git commit -m "feat: add code execution engine with shared global context"
```

---

## Task 4: Kernel Class — Socket Setup and Heartbeat

**Files:**
- Modify: `src/kernel/index.ts`

No unit tests for socket wiring — this is integration code that requires a running ZMQ context. We'll test it end-to-end via the CLI later.

- [ ] **Step 1: Add Kernel class with socket setup and heartbeat**

Add to `src/kernel/index.ts` above the `executeCode` export:

```ts
import * as zmq from "zeromq";
import {
  type ConnectionInfo,
  type JupyterMessage,
  createMessage,
  serialize,
  deserialize,
} from "../protocol/messages.ts";

export class Kernel {
  private connectionInfo: ConnectionInfo;
  private shell: zmq.Router;
  private control: zmq.Router;
  private iopub: zmq.Publisher;
  private stdin: zmq.Router;
  private heartbeat: zmq.Reply;
  private executionCount = 0;
  private context: Record<string, unknown> = {};

  constructor(connectionInfo: ConnectionInfo) {
    this.connectionInfo = connectionInfo;
    this.shell = new zmq.Router();
    this.control = new zmq.Router();
    this.iopub = new zmq.Publisher();
    this.stdin = new zmq.Router();
    this.heartbeat = new zmq.Reply();
  }

  private addr(port: number): string {
    return `${this.connectionInfo.transport}://${this.connectionInfo.ip}:${port}`;
  }

  private get key(): string {
    return this.connectionInfo.key;
  }

  async start(): Promise<void> {
    await Promise.all([
      this.shell.bind(this.addr(this.connectionInfo.shell_port)),
      this.control.bind(this.addr(this.connectionInfo.control_port)),
      this.iopub.bind(this.addr(this.connectionInfo.iopub_port)),
      this.stdin.bind(this.addr(this.connectionInfo.stdin_port)),
      this.heartbeat.bind(this.addr(this.connectionInfo.hb_port)),
    ]);

    // Launch all loops concurrently
    this.heartbeatLoop();
    this.shellLoop();
    this.controlLoop();

    console.log("Yeastbook kernel started");
  }

  private async heartbeatLoop(): Promise<void> {
    for await (const [msg] of this.heartbeat) {
      await this.heartbeat.send(msg);
    }
  }
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `bun test`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/kernel/index.ts
git commit -m "feat: add Kernel class with socket setup and heartbeat"
```

---

## Task 5: Shell and Control Message Handlers

**Files:**
- Modify: `src/kernel/index.ts`

- [ ] **Step 1: Add iopub helper, shell dispatch, and all message handlers**

Continue the Kernel class in `src/kernel/index.ts`:

```ts
  // --- iopub helpers ---

  private async publishOnIopub(
    msgType: string,
    content: Record<string, unknown>,
    parent: JupyterMessage,
  ): Promise<void> {
    const msg = createMessage(msgType, content, parent);
    // For PUB socket, use msg_type as topic prefix (not Router identities)
    msg.identities = [Buffer.from(msg.header.msg_type)];
    await this.iopub.send(serialize(msg, this.key));
  }

  private async publishStatus(
    state: "busy" | "idle",
    parent: JupyterMessage,
  ): Promise<void> {
    await this.publishOnIopub("status", { execution_state: state }, parent);
  }

  // --- shell loop ---

  private async shellLoop(): Promise<void> {
    for await (const frames of this.shell) {
      const msg = deserialize(frames as Buffer[], this.key);
      switch (msg.header.msg_type) {
        case "kernel_info_request":
          await this.handleKernelInfo(msg);
          break;
        case "execute_request":
          await this.handleExecute(msg);
          break;
        case "shutdown_request":
          await this.handleShutdown(msg, this.shell);
          break;
        case "is_complete_request":
          await this.handleIsComplete(msg);
          break;
        case "complete_request":
          await this.handleComplete(msg);
          break;
        case "comm_info_request":
          await this.handleCommInfo(msg);
          break;
        // Unrecognized messages are silently dropped
      }
    }
  }

  // --- control loop ---

  private async controlLoop(): Promise<void> {
    for await (const frames of this.control) {
      const msg = deserialize(frames as Buffer[], this.key);
      switch (msg.header.msg_type) {
        case "shutdown_request":
          await this.handleShutdown(msg, this.control);
          break;
        case "interrupt_request":
          await this.handleInterrupt(msg);
          break;
      }
    }
  }

  // --- handlers ---

  private async handleKernelInfo(parent: JupyterMessage): Promise<void> {
    await this.publishStatus("busy", parent);
    const reply = createMessage(
      "kernel_info_reply",
      {
        protocol_version: "5.3",
        implementation: "yeastbook",
        implementation_version: "0.1.0",
        language_info: {
          name: "typescript",
          version: Bun.version,
          mimetype: "text/typescript",
          file_extension: ".ts",
        },
        banner: "Yeastbook - Bun TypeScript Kernel",
        status: "ok",
        help_links: [],
      },
      parent,
    );
    await this.shell.send(serialize(reply, this.key));
    await this.publishStatus("idle", parent);
  }

  private async handleExecute(parent: JupyterMessage): Promise<void> {
    await this.publishStatus("busy", parent);
    this.executionCount++;
    const code = parent.content.code as string;

    // Broadcast execute_input
    await this.publishOnIopub(
      "execute_input",
      { code, execution_count: this.executionCount },
      parent,
    );

    // Execute
    const result = await executeCode(code, this.context);

    // Stream stdout
    if (result.stdout) {
      await this.publishOnIopub(
        "stream",
        { name: "stdout", text: result.stdout },
        parent,
      );
    }

    // Stream stderr
    if (result.stderr) {
      await this.publishOnIopub(
        "stream",
        { name: "stderr", text: result.stderr },
        parent,
      );
    }

    if (result.error) {
      // Publish execute_error on iopub
      await this.publishOnIopub(
        "execute_error",
        {
          ename: result.error.ename,
          evalue: result.error.evalue,
          traceback: result.error.traceback,
        },
        parent,
      );

      // Reply with error status
      const reply = createMessage(
        "execute_reply",
        {
          status: "error",
          execution_count: this.executionCount,
          ename: result.error.ename,
          evalue: result.error.evalue,
          traceback: result.error.traceback,
        },
        parent,
      );
      await this.shell.send(serialize(reply, this.key));
    } else {
      // Publish execute_result if value is not undefined
      if (result.value !== undefined) {
        await this.publishOnIopub(
          "execute_result",
          {
            execution_count: this.executionCount,
            data: { "text/plain": Bun.inspect(result.value) },
            metadata: {},
          },
          parent,
        );
      }

      // Reply with ok status
      const reply = createMessage(
        "execute_reply",
        {
          status: "ok",
          execution_count: this.executionCount,
          user_expressions: {},
        },
        parent,
      );
      await this.shell.send(serialize(reply, this.key));
    }

    await this.publishStatus("idle", parent);
  }

  private async handleShutdown(
    parent: JupyterMessage,
    socket: zmq.Router,
  ): Promise<void> {
    const restart = (parent.content.restart as boolean) ?? false;
    const reply = createMessage(
      "shutdown_reply",
      { status: "ok", restart },
      parent,
    );
    await socket.send(serialize(reply, this.key));

    this.shell.close();
    this.control.close();
    this.iopub.close();
    this.stdin.close();
    this.heartbeat.close();
    process.exit(0);
  }

  private async handleInterrupt(parent: JupyterMessage): Promise<void> {
    // No-op: can't interrupt an AsyncFunction mid-flight
    const reply = createMessage(
      "interrupt_reply",
      { status: "ok" },
      parent,
    );
    await this.control.send(serialize(reply, this.key));
  }

  private async handleIsComplete(parent: JupyterMessage): Promise<void> {
    const reply = createMessage(
      "is_complete_reply",
      { status: "complete" },
      parent,
    );
    await this.shell.send(serialize(reply, this.key));
  }

  private async handleComplete(parent: JupyterMessage): Promise<void> {
    const reply = createMessage(
      "complete_reply",
      { matches: [], cursor_start: 0, cursor_end: 0, status: "ok", metadata: {} },
      parent,
    );
    await this.shell.send(serialize(reply, this.key));
  }

  private async handleCommInfo(parent: JupyterMessage): Promise<void> {
    await this.publishStatus("busy", parent);
    const reply = createMessage(
      "comm_info_reply",
      { status: "ok", comms: {} },
      parent,
    );
    await this.shell.send(serialize(reply, this.key));
    await this.publishStatus("idle", parent);
  }
}
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `bun test`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/kernel/index.ts
git commit -m "feat: add shell/control dispatch and all message handlers"
```

---

## Task 6: CLI Entrypoint

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement the CLI**

```ts
#!/usr/bin/env bun
// src/cli.ts

import { join, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { Kernel } from "./kernel/index.ts";
import type { ConnectionInfo } from "./protocol/messages.ts";

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "start": {
    const connectionFile = args[1];
    if (!connectionFile) {
      console.error("Usage: yeastbook start <connection_file>");
      process.exit(1);
    }
    const info: ConnectionInfo = await Bun.file(connectionFile).json();
    const kernel = new Kernel(info);
    await kernel.start();
    break;
  }

  case "install": {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
    const kernelsDir =
      process.platform === "darwin"
        ? join(home, "Library", "Jupyter", "kernels", "yeastbook")
        : join(home, ".local", "share", "jupyter", "kernels", "yeastbook");

    await mkdir(kernelsDir, { recursive: true });

    const cliPath = resolve(import.meta.dirname!, "cli.ts");
    const kernelSpec = {
      argv: ["bun", "run", cliPath, "start", "{connection_file}"],
      display_name: "Yeastbook (Bun)",
      language: "typescript",
    };

    await Bun.write(
      join(kernelsDir, "kernel.json"),
      JSON.stringify(kernelSpec, null, 2) + "\n",
    );
    console.log(`Kernel spec installed to ${kernelsDir}/kernel.json`);
    break;
  }

  case "uninstall": {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
    const kernelsDir =
      process.platform === "darwin"
        ? join(home, "Library", "Jupyter", "kernels", "yeastbook")
        : join(home, ".local", "share", "jupyter", "kernels", "yeastbook");

    await rm(kernelsDir, { recursive: true, force: true });
    console.log("Kernel spec uninstalled");
    break;
  }

  default:
    console.log("Usage: yeastbook <start|install|uninstall>");
    console.log("  start <connection_file>  Start the kernel");
    console.log("  install                  Install kernelspec for Jupyter");
    console.log("  uninstall                Remove kernelspec");
    process.exit(command ? 1 : 0);
}
```

- [ ] **Step 2: Verify CLI parses correctly**

Run: `bun src/cli.ts`
Expected: Prints usage help text, exits 0

Run: `bun src/cli.ts start`
Expected: Prints "Usage: yeastbook start <connection_file>", exits 1

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI entrypoint with start/install/uninstall commands"
```

---

## Task 7: Integration Smoke Test

**Files:**
- Create: `tests/integration.test.ts`

- [ ] **Step 1: Write an integration test that starts a kernel and sends kernel_info_request**

```ts
// tests/integration.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import * as zmq from "zeromq";
import type { ConnectionInfo } from "../src/protocol/messages.ts";
import { serialize, deserialize, createMessage } from "../src/protocol/messages.ts";

const connectionInfo: ConnectionInfo = {
  ip: "127.0.0.1",
  transport: "tcp",
  shell_port: 0,    // will use actual bound ports
  iopub_port: 0,
  stdin_port: 0,
  control_port: 0,
  hb_port: 0,
  key: "test-key-12345",
  signature_scheme: "hmac-sha256",
  kernel_name: "yeastbook",
};

let kernelProc: ReturnType<typeof Bun.spawn>;
let tmpFile: string;

beforeAll(async () => {
  // Pick random ports
  const ports = [];
  for (let i = 0; i < 5; i++) {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {}, close() {} } });
    ports.push(server.port);
    server.stop();
  }
  connectionInfo.shell_port = ports[0]!;
  connectionInfo.iopub_port = ports[1]!;
  connectionInfo.stdin_port = ports[2]!;
  connectionInfo.control_port = ports[3]!;
  connectionInfo.hb_port = ports[4]!;

  // Write connection file
  tmpFile = `/tmp/yeastbook-test-${Date.now()}.json`;
  await Bun.write(tmpFile, JSON.stringify(connectionInfo));

  // Start kernel
  kernelProc = Bun.spawn(["bun", "run", "src/cli.ts", "start", tmpFile], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for kernel to bind sockets
  await Bun.sleep(1000);
});

afterAll(() => {
  kernelProc?.kill();
});

test("heartbeat echoes back", async () => {
  const hb = new zmq.Request();
  hb.connect(`tcp://127.0.0.1:${connectionInfo.hb_port}`);
  await hb.send(Buffer.from("ping"));
  const [reply] = await hb.receive();
  expect(reply!.toString()).toBe("ping");
  hb.close();
});

test("kernel_info_request returns kernel info", async () => {
  const shell = new zmq.Dealer();
  shell.connect(`tcp://127.0.0.1:${connectionInfo.shell_port}`);

  // Subscribe to iopub for status messages
  const iopub = new zmq.Subscriber();
  iopub.connect(`tcp://127.0.0.1:${connectionInfo.iopub_port}`);
  iopub.subscribe();

  await Bun.sleep(200); // let subscriber connect

  const req = createMessage("kernel_info_request", {});
  await shell.send(serialize(req, connectionInfo.key));

  const replyFrames = await shell.receive();
  const reply = deserialize(replyFrames as Buffer[], connectionInfo.key);
  expect(reply.header.msg_type).toBe("kernel_info_reply");
  expect(reply.content.implementation).toBe("yeastbook");
  expect(reply.content.protocol_version).toBe("5.3");

  shell.close();
  iopub.close();
});

test("execute_request runs code and returns result", async () => {
  const shell = new zmq.Dealer();
  shell.connect(`tcp://127.0.0.1:${connectionInfo.shell_port}`);

  const iopub = new zmq.Subscriber();
  iopub.connect(`tcp://127.0.0.1:${connectionInfo.iopub_port}`);
  iopub.subscribe();
  await Bun.sleep(200);

  const req = createMessage("execute_request", {
    code: "1 + 2",
    silent: false,
    store_history: true,
    user_expressions: {},
    allow_stdin: false,
    stop_on_error: true,
  });
  await shell.send(serialize(req, connectionInfo.key));

  const replyFrames = await shell.receive();
  const reply = deserialize(replyFrames as Buffer[], connectionInfo.key);
  expect(reply.header.msg_type).toBe("execute_reply");
  expect(reply.content.status).toBe("ok");

  shell.close();
  iopub.close();
});
```

- [ ] **Step 2: Run integration test**

Run: `bun test tests/integration.test.ts`
Expected: All 3 integration tests PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add integration smoke tests for heartbeat, kernel_info, execute"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Verify the bin entry works**

Run: `bun src/cli.ts install`
Expected: Prints "Kernel spec installed to ..."

- [ ] **Step 2: Verify kernel.json was written correctly**

Run: `cat ~/.local/share/jupyter/kernels/yeastbook/kernel.json`
Expected: Valid JSON with argv, display_name, language fields

- [ ] **Step 3: Clean up — uninstall**

Run: `bun src/cli.ts uninstall`
Expected: Prints "Kernel spec uninstalled"

- [ ] **Step 4: Final commit with package.json bin entry**

Verify `package.json` already has the bin entry. If not, add it. Then:

```bash
git add package.json
git commit -m "chore: add bin entry for yeastbook CLI"
```
