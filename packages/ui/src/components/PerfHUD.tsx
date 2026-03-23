import { useState, useCallback } from "react";
import { Portal } from "./Portal.tsx";
import type { PerfMetrics } from "../hooks/usePerfMetrics.ts";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data, 60);
  const h = 24;
  const w = 120;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h;
      return `${x},${y}`;
    })
    .join(" ");

  const color =
    min > 50 ? "var(--status-success)" : min > 30 ? "var(--accent)" : "var(--status-error)";

  return (
    <div className="perf-sparkline">
      <svg width={w} height={h}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function formatMetric(value: number | null, unit: string): string {
  if (value == null) return "—";
  return `${value}${unit}`;
}

export function PerfHUD({ metrics }: { metrics: PerfMetrics }) {
  const [open, setOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    let bunVersion = "unknown";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      bunVersion = data.bunVersion ?? "unknown";
    } catch {}
    const cellCount = document.querySelectorAll('[id^="cell-"]').length;
    const text = [
      "Yeastbook Performance Snapshot",
      `FPS: ${metrics.fps}`,
      `WS Latency: ${formatMetric(metrics.wsLatency, "ms")}`,
      `Last Exec: ${formatMetric(metrics.lastExecTime, "ms")}`,
      `Render: ${formatMetric(metrics.renderTime, "ms")}`,
      `Heap: ${metrics.heapMB != null ? `${metrics.heapMB}MB` : "N/A"}`,
      `Cells: ${cellCount}`,
      `Bun: ${bunVersion}`,
      `UA: ${navigator.userAgent}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }, [metrics]);

  return (
    <Portal>
      <button className="perf-toggle" onClick={() => setOpen((p) => !p)} title="Performance HUD">
        ⚡
      </button>
      {open && (
        <div className="perf-panel">
          <div className="perf-header">
            <span>Performance</span>
            <button onClick={handleCopy} title="Copy snapshot">Copy</button>
            <button onClick={() => setOpen(false)} title="Close">×</button>
          </div>
          <div className="perf-row">
            <span className="perf-row-label">FPS</span>
            <span className="perf-row-value">{metrics.fps}</span>
          </div>
          <Sparkline data={metrics.fpsHistory} />
          <div className="perf-row">
            <span className="perf-row-label">WS</span>
            <span className="perf-row-value">{formatMetric(metrics.wsLatency, "ms")}</span>
          </div>
          <div className="perf-row">
            <span className="perf-row-label">Exec</span>
            <span className="perf-row-value">{formatMetric(metrics.lastExecTime, "ms")}</span>
          </div>
          <div className="perf-row">
            <span className="perf-row-label">Render</span>
            <span className="perf-row-value">{formatMetric(metrics.renderTime, "ms")}</span>
          </div>
          {metrics.heapMB != null && (
            <div className="perf-row">
              <span className="perf-row-label">Heap</span>
              <span className="perf-row-value">{metrics.heapMB}MB</span>
            </div>
          )}
        </div>
      )}
    </Portal>
  );
}
