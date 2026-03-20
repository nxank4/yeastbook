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

- `ConnectionInfo` — shape of the Jupyter connection file (ip, transport, ports, key, signature_scheme, kernel_name)
- `MessageHeader` — msg_id, session, username, msg_type, version ("5.3"), date
- `JupyterMessage` — identities (Buffer[]), header, parent_header, metadata, content

### HMAC Signing

- Use `crypto.createHmac("sha256", key)` from Node's `crypto` module
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

`createMessage(msgType, content, parentMsg?)` — generates msg_id via `crypto.randomUUID()`, sets session, ISO timestamp, wires parent_header from parent message.

## 2. Kernel Class (`src/kernel/index.ts`)

### Socket Setup

| Socket    | ZMQ Type      | Purpose                                    |
|-----------|---------------|--------------------------------------------|
| heartbeat | zmq.Reply     | Echo raw bytes back (keep-alive)           |
| shell     | zmq.Router    | Handle execute_request, kernel_info_request, shutdown_request |
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

### Execute Request Flow

1. Publish `status: busy` on iopub
2. Increment `execution_count`
3. Monkey-patch `console.log`, `.error`, `.warn` — each call sends `stream` message on iopub (name: "stdout"/"stderr")
4. Evaluate code with shared global context (see below)
5. If return value !== undefined → publish `execute_result` (data: {"text/plain": inspected value})
6. On exception → publish `execute_error` (ename, evalue, traceback from error stack)
7. Restore original console methods
8. Send `execute_reply` on shell (status: "ok" or "error")
9. Publish `status: idle` on iopub

### Code Execution & Shared Global Context

- Maintain a persistent plain object as execution context
- Before each cell: `Object.assign(globalThis, context)` to expose prior variables
- Last expression detection: check if last non-empty line starts with a statement keyword (`let`, `const`, `var`, `if`, `for`, `while`, `class`, `function`, `return`, `throw`, `try`, `switch`, `import`, `export`). If not, wrap it in a return statement.
- Execute via `new AsyncFunction(wrappedCode)` — `this` is not used, variables go on globalThis
- After execution: snapshot new/changed properties from globalThis back to context (diff against a known set of keys captured before execution)
- Statement keywords for detection: `let`, `const`, `var`, `if`, `for`, `while`, `do`, `class`, `function`, `return`, `throw`, `try`, `switch`, `import`, `export`, `{`, `//`, `/*`

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
- `crypto` (Node built-in) — HMAC-SHA256 signing, UUID generation
- Bun APIs: `Bun.file()`, `Bun.version`, `process.argv`

## Non-Goals

- No sandboxing/isolation (standard Jupyter kernel behavior)
- No stdin input handling (stub only)
- No rich media output (text/plain only for v1)
- No interrupt mid-execution (AsyncFunction cannot be interrupted)
