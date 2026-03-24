import { useRef, useEffect } from "react";

interface Props {
  spec: Record<string, unknown>;
}

export function VegaOutput({ spec }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;

    (async () => {
      const vegaEmbed = (await import("vega-embed")).default;
      if (disposed || !ref.current) return;
      try {
        await vegaEmbed(ref.current, spec as any, {
          actions: { export: true, source: false, compiled: false, editor: false },
          theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : undefined,
        });
      } catch (err) {
        if (ref.current) ref.current.textContent = `Vega error: ${err}`;
      }
    })();

    return () => { disposed = true; };
  }, [spec]);

  return <div ref={ref} className="vega-output" />;
}
