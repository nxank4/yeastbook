# Yeastbook Jupyter Kernel — Design Spec

## Overview

A Jupyter kernel that runs TypeScript natively on Bun runtime using the Jupyter Messaging Protocol v5.3 over ZeroMQ sockets.

## Architecture

Three source files with clear responsibilities:

```
src/
  protocol/messages.ts  — Message types, HMAC signing, frame parse/serialize
  kernel/index.ts       — Kernel class, socket management, execution engine
  cli.ts                — CLI entrypoint (start, install, uninstall)
```

## 1. Message Protocol (`src/protocol/messages.ts`)

### Types

- `ConnectionInfo` — shape of the Jupyter connection file: `ip`, `transport`, `shell_port`, `iopub_port`, `stdin_port`, `control_port`, `hb_port`, `key`, `signature_scheme`, `kernel_name`
- `MessageHeader` — msg_id, session, username, msg_type, version ("5.3"), date
- `JupyterMessage` — identities (Buffer[]), header, parent_header, metadata, content

### HMAC Signing

- Use `createHmac("sha256", key)` from `node:crypto` for HMAC signing
- Use `crypto.randomUUID()` from the Web Crypto API (globalThis.crypto) for message IDs
- Sign concatenation of serialized: header + parent_header + metadata + content
- Empty key string means no authentication (empty signature)

### Frame Parsing (deserialize)

Receive multipart ZMQ message → split on `<IDS|MSG>` delimiter:
- Everything before delimiter = identities
- After delimiter: signature, header (JSON), parent_header (JSON), metadata (JSON), content (JSON)
- Validate HMAC signature; throw on mismatch

### Frame Serialization (serialize)

JupyterMessage → compute HMAC → return frames array:
`[...identities, "<IDS|MSG>", signature, headerJSON, parentHeaderJSON, metadataJSON, contentJSON]`

### Factory

`createMessage(msgType, content, parentMsg?)` — generates msg_id via `crypto.randomUUID()` (Web Crypto API), sets session, ISO timestamp, wires parent_header from parent message.

## 2. Kernel Class (`src/kernel/index.ts`)

### Socket Setup

| Socket    | ZMQ Type      | Purpose                                    |
|-----------|---------------|--------------------------------------------|
| heartbeat | zmq.Reply     | Echo raw bytes back (keep-alive)           |
| shell     | zmq.Router    | Handle execute_request, kernel_info_request, shutdown_request, is_complete_request, complete_request, comm_info_request |
| control   | zmq.Router    | Handle shutdown_request, interrupt_request |
| iopub     | zmq.Publisher | Broadcast status, stream, execute_result, execute_error |
| stdin     | zmq.Router    | Bind only (stub, no active handling)       |

All sockets bind to `tcp://{ip}:{port}` from connection info.

### Heartbeat

Infinite async loop: receive → send back same bytes. Runs as a detached async task.

### Shell Message Dispatch

Parse incoming multipart message → dispatch on `msg_type`:
- `kernel_info_request` → reply with kernel_info_reply
- `execute_request` → execute code, send results
- `shutdown_request` → clean shutdown
- `is_complete_request` → reply with `{ status: "complete" }` (always; no multi-line detection)
- `complete_request` → reply with empty matches `{ matches: [], cursor_start: 0, cursor_end: 0, status: "ok" }` (stub)
- `comm_info_request` → reply with `{ comms: {} }` (no comms support)

### Execute Request Flow

1. Publish `status: busy` on iopub
2. Increment `execution_count`
3. Publish `execute_input` on iopub with `{ code, execution_count }` (echoes input to frontends)
4. Monkey-patch `console.log`, `.error`, `.warn` — each call sends `stream` message on iopub (name: "stdout"/"stderr")
5. Evaluate code with shared global context (see below)
6. If return value !== undefined → publish `execute_result` (data: {"text/plain": inspected value}, execution_count)
7. On exception → publish `execute_error` (ename, evalue, traceback from error stack)
8. Restore original console methods
9. Send `execute_reply` on shell — for "ok": `{ status, execution_count, user_expressions: {} }`; for "error": `{ status, execution_count, ename, evalue, traceback }`
10. Publish `status: idle` on iopub

### Code Execution & Shared Global Context

- Maintain a persistent plain object as execution context
- Before each cell: `Object.assign(globalThis, context)` to expose prior variables
- Last expression detection: check if last non-empty line starts with a statement keyword (`let`, `const`, `var`, `if`, `for`, `while`, `do`, `class`, `function`, `return`, `throw`, `try`, `switch`, `import`, `export`, `{`, `//`, `/*`). If not, wrap it in a return statement.
- Execute via `new AsyncFunction(wrappedCode)` — variables go on globalThis
- After execution: capture new top-level bindings by diffing globalThis keys (before vs after). Existing object references are shared by identity through globalThis and don't need recapturing — only new keys need to be added to the context.

### kernel_info_reply Content

```json
{
  "protocol_version": "5.3",
  "implementation": "yeastbook",
  "implementation_version": "0.1.0",
  "language_info": {
    "name": "typescript",
    "version": "<Bun.version>",
    "mimetype": "text/typescript",
    "file_extension": ".ts"
  },
  "banner": "Yeastbook - Bun TypeScript Kernel",
  "status": "ok"
}
```

### Shutdown

Set running flag to false, close all sockets, call `process.exit(0)`.

### Control Socket

Same dispatch pattern as shell. Handles `shutdown_request` (same as shell) and `interrupt_request` (no-op acknowledgment since we can't interrupt eval mid-flight).

## 3. CLI (`src/cli.ts`)

Shebang: `#!/usr/bin/env bun`

### Commands

**`yeastbook start <connection_file>`**
- Read connection file via `Bun.file(path).json()`
- Construct Kernel instance, call `kernel.start()`

**`yeastbook install`**
- Determine kernels directory:
  - macOS: `~/Library/Jupyter/kernels/yeastbook/`
  - Linux/WSL: `~/.local/share/jupyter/kernels/yeastbook/`
- Write `kernel.json`:
  ```json
  {
    "argv": ["bun", "run", "<absolute path to cli.ts>", "start", "{connection_file}"],
    "display_name": "Yeastbook (Bun)",
    "language": "typescript"
  }
  ```
- Create directory if needed

**`yeastbook uninstall`**
- Remove the `yeastbook` kernelspec directory

### No external argument parsing libraries — just `process.argv` slicing.

## Dependencies

- `zeromq` (6.5.0) — ZMQ socket bindings
- `node:crypto` (Node built-in) — HMAC-SHA256 signing via `createHmac`
- Web Crypto API (`globalThis.crypto`) — UUID generation via `randomUUID()`
- Bun APIs: `Bun.file()`, `Bun.version`, `process.argv`

## Non-Goals

- No sandboxing/isolation (standard Jupyter kernel behavior)
- No stdin input handling (stub only)
- No rich media output (text/plain only for v1; execute_result with text/plain is sufficient)
- No interrupt mid-execution (AsyncFunction cannot be interrupted)
- No multi-line completion detection (is_complete_request always returns "complete")
- No tab completion (complete_request returns empty matches)
- No comms support (comm_info_request returns empty)
- No history_request or inspect_request handling (messages silently ignored)
