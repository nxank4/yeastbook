import { JsonTree } from "./outputs/JsonTree.tsx";
import { DataTable } from "./outputs/DataTable.tsx";
import { ChartOutput } from "./outputs/ChartOutput.tsx";
import { HtmlOutput } from "./outputs/HtmlOutput.tsx";
import type { CellOutput as CellOutputType } from "../types.ts";

interface Props {
  outputs: CellOutputType[];
}

export function CellOutput({ outputs }: Props) {
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
                <RichOutputRenderer output={out.richOutput} />
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
              <div className="error-header">{out.ename}: {out.evalue}</div>
              {out.traceback?.length ? (
                <pre className="traceback">{out.traceback.join("\n")}</pre>
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function RichOutputRenderer({ output }: { output: NonNullable<CellOutputType["richOutput"]> }) {
  switch (output.type) {
    case "table":
      return <DataTable rows={output.rows} />;
    case "chart":
      return <ChartOutput data={output.data} config={output.config as any} />;
    case "html":
      return <HtmlOutput html={output.html} />;
    case "json":
      return <JsonTree data={output.data} />;
    case "text":
      return <div className="output-result">{output.text}</div>;
    default:
      return null;
  }
}
