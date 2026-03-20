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
