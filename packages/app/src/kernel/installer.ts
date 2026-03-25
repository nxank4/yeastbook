// src/kernel/installer.ts — Run bun add with streaming output

import { resolve } from "node:path";

export interface InstallResult {
  success: boolean;
  error?: string;
  versions?: Record<string, string>;
}

const VALID_PKG = /^(@[\w-]+\/)?[\w][\w.\-]*(@[\w.\-^~>=<*]+)?$/;

export function validatePackageName(name: string): boolean {
  return VALID_PKG.test(name);
}

export async function installPackages(
  packages: string[],
  onOutput: (text: string, stream: "stdout" | "stderr") => void,
): Promise<InstallResult> {
  if (packages.length === 0) {
    return { success: false, error: "No packages specified" };
  }

  for (const pkg of packages) {
    if (!validatePackageName(pkg)) {
      return { success: false, error: `Invalid package name: ${pkg}` };
    }
  }

  try {
    const proc = Bun.spawn(["bun", "add", ...packages], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Stream stdout
    const stdoutReader = (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onOutput(decoder.decode(value), "stdout");
      }
    })();

    // Stream stderr
    const stderrReader = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onOutput(decoder.decode(value), "stderr");
      }
    })();

    await Promise.all([stdoutReader, stderrReader]);
    const exitCode = await proc.exited;

    // Check which packages were actually installed (bun can exit non-zero but still install some)
    const versions: Record<string, string> = {};
    for (const pkg of packages) {
      try {
        const pkgJson = await Bun.file(resolve("node_modules", pkg, "package.json")).json();
        if (pkgJson.version) versions[pkg] = pkgJson.version;
      } catch {}
    }

    const allInstalled = Object.keys(versions).length === packages.length;

    if (exitCode === 0 || allInstalled) {
      // Silently try to install @types packages for better editor support
      for (const pkg of packages) {
        if (pkg.startsWith("@")) continue; // Skip scoped packages
        try {
          const typesProc = Bun.spawn(["bun", "add", "-d", `@types/${pkg}`], {
            stdout: "ignore",
            stderr: "ignore",
          });
          await typesProc.exited;
        } catch {}
      }
      return { success: true, versions };
    }

    return { success: false, error: `bun add exited with code ${exitCode}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
