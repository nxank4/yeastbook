// src/kernel/installer.ts — Run bun add with streaming output

export interface InstallResult {
  success: boolean;
  error?: string;
}

export async function installPackages(
  packages: string[],
  onOutput: (text: string, stream: "stdout" | "stderr") => void,
): Promise<InstallResult> {
  if (packages.length === 0) {
    return { success: false, error: "No packages specified" };
  }

  // Validate package names to prevent command injection
  const VALID_PKG = /^(@[\w-]+\/)?[\w][\w.\-]*(@[\w.\-^~>=<*]+)?$/;
  for (const pkg of packages) {
    if (!VALID_PKG.test(pkg)) {
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

    if (exitCode === 0) {
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
      return { success: true };
    }

    return { success: false, error: `bun add exited with code ${exitCode}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
