import type { YbkPlugin } from "@codepawl/yeastbook-core";

export default {
  name: "yeastbook-vega",
  version: "0.1.0",
  renderers: [{
    type: "vega",
    displayName: "Vega-Lite Chart",
    canRender: (value: unknown): boolean =>
      typeof value === "object" && value !== null &&
      (value as Record<string, unknown>).__type === "vega",
    serialize: (value: unknown): Record<string, unknown> =>
      ({ spec: (value as Record<string, unknown>).spec }),
    componentSource: `function VegaChart({ data }) {
  return React.createElement("pre", {
    style: { padding: "8px", fontFamily: "monospace", fontSize: "12px" }
  }, JSON.stringify(data.spec, null, 2));
}
VegaChart`,
  }],
} satisfies YbkPlugin;
