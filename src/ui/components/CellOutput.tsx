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
