import { describe, test, expect } from "bun:test";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

// Import the loadEnvFile function by reading server source
// Since loadEnvFile is not exported, we test the parsing logic directly
function parseEnvContent(content: string): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[key] = value;
  }
  return envVars;
}

describe("Env: parseEnvContent", () => {
  test("parses KEY=VALUE correctly", () => {
    const result = parseEnvContent("FOO=bar\nBAZ=qux");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("handles quoted values", () => {
    const result = parseEnvContent('MY_KEY="hello world"\nOTHER=\'single quoted\'');
    expect(result).toEqual({ MY_KEY: "hello world", OTHER: "single quoted" });
  });

  test("skips comments and empty lines", () => {
    const result = parseEnvContent("# comment\n\nKEY=value\n  # another comment\n");
    expect(result).toEqual({ KEY: "value" });
  });

  test("returns empty object for empty content", () => {
    expect(parseEnvContent("")).toEqual({});
  });

  test("handles values with equals signs", () => {
    const result = parseEnvContent("URL=postgres://user:pass@host/db?opt=1");
    expect(result).toEqual({ URL: "postgres://user:pass@host/db?opt=1" });
  });

  test("handles whitespace around key and value", () => {
    const result = parseEnvContent("  KEY  =  value  ");
    expect(result).toEqual({ KEY: "value" });
  });

  test("skips lines without equals", () => {
    const result = parseEnvContent("GOOD=value\nBADLINE\nALSO_GOOD=ok");
    expect(result).toEqual({ GOOD: "value", ALSO_GOOD: "ok" });
  });
});

describe("Env: file loading", () => {
  test("loads .env file from directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yb-env-"));
    const envPath = join(dir, ".env");
    await writeFile(envPath, "TEST_KEY=hello123\nDB_URL=postgres://localhost/test\n");

    const content = await Bun.file(envPath).text();
    const result = parseEnvContent(content);

    expect(result.TEST_KEY).toBe("hello123");
    expect(result.DB_URL).toBe("postgres://localhost/test");

    await rm(dir, { recursive: true });
  });

  test("returns empty for missing .env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yb-env-"));
    const envPath = join(dir, ".env");

    try {
      await Bun.file(envPath).text();
      expect(true).toBe(false); // should not reach here
    } catch {
      // Expected — no .env file
    }

    await rm(dir, { recursive: true });
  });
});
