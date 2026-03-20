// src/kernel/index.ts

import * as zmq from "zeromq";
import {
  type ConnectionInfo,
  type JupyterMessage,
  createMessage,
  serialize,
  deserialize,
} from "../protocol/messages.ts";
import { executeCode } from "./execute.ts";

export { executeCode, type ExecResult } from "./execute.ts";

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
} // end of Kernel class
