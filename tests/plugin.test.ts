import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PluginLoader } from "../packages/app/src/plugins/loader.ts";

describe("PluginLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ybk-plugins-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loads valid plugin files", async () => {
    await Bun.write(join(tempDir, "test.ts"), `export default { name: "test", version: "1.0.0", renderers: [{
      type: "custom", displayName: "Custom",
      canRender: (v) => typeof v === "object" && v?.__type === "custom",
      serialize: (v) => ({ data: v }),
    }] };`);
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(1);
  });

  test("skips invalid plugin files", async () => {
    await Bun.write(join(tempDir, "bad.ts"), "export default { invalid: true }");
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(0);
  });

  test("findRenderer returns matching renderer", async () => {
    await Bun.write(join(tempDir, "t.ts"), `export default { name: "p", version: "1.0.0", renderers: [{
      type: "custom", displayName: "C",
      canRender: (v) => typeof v === "object" && v?.__type === "custom",
      serialize: (v) => ({ data: v }),
    }] };`);
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.findRenderer({ __type: "custom" })?.type).toBe("custom");
  });

  test("findRenderer returns null for no match", async () => {
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.findRenderer("x")).toBeNull();
  });

  test("loads from non-existent directory", async () => {
    const loader = new PluginLoader(join(tempDir, "nope"));
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(0);
  });

  test("registerPlugin with invalid object does not add to plugins", () => {
    const loader = new PluginLoader(tempDir);
    loader.registerPlugin({ invalid: true } as any);
    expect(loader.getPlugins()).toHaveLength(0);
  });

  test("registerPlugin with valid plugin adds to plugins", () => {
    const loader = new PluginLoader(tempDir);
    loader.registerPlugin({ name: "test", version: "1.0", renderers: [] });
    expect(loader.getPlugins()).toHaveLength(1);
  });

  test("two plugins each with 1 renderer gives getRenderers().length === 2", () => {
    const loader = new PluginLoader(tempDir);
    const makeRenderer = (type: string) => ({
      type,
      displayName: type,
      canRender: (_v: unknown) => false,
      serialize: (_v: unknown) => ({}),
    });
    loader.registerPlugin({ name: "plugin-a", version: "1.0", renderers: [makeRenderer("type-a")] });
    loader.registerPlugin({ name: "plugin-b", version: "1.0", renderers: [makeRenderer("type-b")] });
    expect(loader.getRenderers()).toHaveLength(2);
  });
});
