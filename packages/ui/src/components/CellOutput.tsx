import { JsonTree } from "./outputs/JsonTree.tsx";
import { DataTable } from "./outputs/DataTable.tsx";
import { ChartOutput } from "./outputs/ChartOutput.tsx";
import { HtmlOutput } from "./outputs/HtmlOutput.tsx";
import { PluginRenderer } from "./outputs/PluginRenderer.tsx";
import { MimeOutput } from "./outputs/MimeOutput.tsx";
import { MathOutput } from "./outputs/MathOutput.tsx";
import { VegaOutput } from "./outputs/VegaOutput.tsx";
import { DataFrameViewer } from "./outputs/DataFrameViewer.tsx";
import { SliderWidget } from "./widgets/SliderWidget.tsx";
import { InputWidget } from "./widgets/InputWidget.tsx";
import { ToggleWidget } from "./widgets/ToggleWidget.tsx";
import { SelectWidget } from "./widgets/SelectWidget.tsx";
import type { CellOutput as CellOutputType } from "@codepawl/yeastbook-core";

interface Props {
  outputs: CellOutputType[];
  performanceMode?: boolean;
}

export function CellOutput({ outputs, performanceMode }: Props) {
  if (outputs.length === 0) return null;

  return (
    <div className="output-area">
      {outputs.map((out, i) => {
        if (out.output_type === "stream") {
          const cls = out.name === "stdout" ? "output-stdout" : "output-stderr";
          return <div key={i} className={cls}>{(out.text || []).join("")}</div>;
        }
        if (out.output_type === "execute_result") {
          // Rich output rendering
          if (out.richOutput) {
            return (
              <div key={i} className="output-rich">
                <RichOutputRenderer output={out.richOutput} performanceMode={performanceMode} />
              </div>
            );
          }
          return (
            <div key={i} className="output-result">
              {out.data?.["text/plain"] || ""}
            </div>
          );
        }
        if (out.output_type === "error") {
          return (
            <div key={i} className="output-error">
              {out.traceback?.length ? (
                <pre className="traceback">{out.traceback.join("\n")}</pre>
              ) : (
                <pre className="traceback">{out.ename}: {out.evalue}</pre>
              )}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function RichOutputRenderer({ output, performanceMode }: { output: NonNullable<CellOutputType["richOutput"]>; performanceMode?: boolean }) {
  switch (output.type) {
    case "table":
      return <DataTable rows={output.rows} performanceMode={performanceMode} />;
    case "chart":
      return <ChartOutput data={output.data} config={output.config as any} />;
    case "html":
      return <HtmlOutput html={output.html} />;
    case "json":
      return <JsonTree data={output.data} />;
    case "math":
      return <MathOutput latex={(output as any).latex} displayMode={(output as any).displayMode} />;
    case "vega":
      return <VegaOutput spec={(output as any).spec} />;
    case "dataframe":
      return <DataFrameViewer columns={(output as any).columns} data={(output as any).data} shape={(output as any).shape} />;
    case "text":
      return <div className="output-result">{output.text}</div>;
    case "plugin":
      return <PluginRenderer pluginType={(output as any).pluginType} data={(output as any).data} />;
    case "mime":
      return <MimeOutput mime={(output as any).mime} data={(output as any).data} url={(output as any).url} performanceMode={performanceMode} />;
    case "widget": {
      const w = output as any;
      const onUpdate = (widgetId: string, value: unknown) => {
        window.dispatchEvent(new CustomEvent("widget-update", { detail: { widgetId, value } }));
      };
      switch (w.widgetType) {
        case "slider": return <SliderWidget widgetId={w.widgetId} config={w.config} value={w.value} onUpdate={onUpdate} />;
        case "input": return <InputWidget widgetId={w.widgetId} config={w.config} value={w.value} onUpdate={onUpdate} />;
        case "toggle": return <ToggleWidget widgetId={w.widgetId} config={w.config} value={w.value} onUpdate={onUpdate} />;
        case "select": return <SelectWidget widgetId={w.widgetId} config={w.config} value={w.value} onUpdate={onUpdate} />;
        default: return <div className="output-result">Unknown widget: {w.widgetType}</div>;
      }
    }
    default:
      return null;
  }
}
