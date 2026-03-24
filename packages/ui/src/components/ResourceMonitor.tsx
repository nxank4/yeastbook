import { useState, useEffect, useRef } from "react";

interface SystemStats {
  cpuPercent: number | null;
  memPercent: number | null;
  memUsedMB: number | null;
  memTotalMB: number | null;
  gpuName: string | null;
  gpuPercent: number | null;
  vramUsedMB: number | null;
  vramTotalMB: number | null;
  vramPercent: number | null;
}

interface Props {
  performanceMode?: boolean;
  onSuggestPerfMode?: () => void;
}

function UsageBar({ label, percent, detail, icon }: { label: string; percent: number | null; detail?: string; icon: string }) {
  if (percent === null) return null;
  const level = percent >= 85 ? "critical" : percent >= 70 ? "warning" : "normal";
  return (
    <div className="resource-bar-item">
      <div className="resource-bar-header">
        <i className={icon} />
        <span className="resource-bar-label">{label}</span>
        <span className={`resource-bar-pct ${level}`}>{percent}%</span>
      </div>
      <div className="resource-bar-track">
        <div className={`resource-bar-fill ${level}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      {detail && <div className="resource-bar-detail">{detail}</div>}
    </div>
  );
}

export function ResourceMonitor({ performanceMode, onSuggestPerfMode }: Props) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lowMemDismissed, setLowMemDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchStats = () => {
      fetch("/api/system/stats")
        .then((r) => r.json())
        .then((data) => { if (mounted) setStats(data); })
        .catch(() => {});
    };
    fetchStats();
    // 5x slower in performance mode
    const interval = performanceMode ? 10000 : 2000;
    intervalRef.current = setInterval(fetchStats, interval);
    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [performanceMode]);

  if (!stats) {
    return <div className="resource-empty"><i className="bi bi-hourglass-split" /> Loading stats...</div>;
  }

  const showLowMemWarning = !performanceMode && !lowMemDismissed && stats.memPercent !== null && stats.memPercent >= 85;

  return (
    <div className="resource-monitor">
      {showLowMemWarning && (
        <div className="resource-low-mem-warning">
          <i className="bi bi-exclamation-triangle-fill" />
          <span>High memory usage. <button className="resource-warn-btn" onClick={onSuggestPerfMode}>Enable Performance Mode</button></span>
          <button className="resource-warn-dismiss" onClick={() => setLowMemDismissed(true)} title="Dismiss"><i className="bi bi-x" /></button>
        </div>
      )}
      <UsageBar
        label="CPU"
        percent={stats.cpuPercent}
        icon="bi bi-cpu"
      />
      <UsageBar
        label="RAM"
        percent={stats.memPercent}
        detail={stats.memUsedMB != null && stats.memTotalMB != null
          ? `${(stats.memUsedMB / 1024).toFixed(1)} / ${(stats.memTotalMB / 1024).toFixed(1)} GB`
          : undefined}
        icon="bi bi-memory"
      />
      {stats.gpuName && (
        <>
          <div className="resource-gpu-name">{stats.gpuName}</div>
          <UsageBar
            label="GPU"
            percent={stats.gpuPercent}
            icon="bi bi-gpu-card"
          />
          <UsageBar
            label="VRAM"
            percent={stats.vramPercent}
            detail={stats.vramUsedMB != null && stats.vramTotalMB != null
              ? `${(stats.vramUsedMB / 1024).toFixed(1)} / ${(stats.vramTotalMB / 1024).toFixed(1)} GB`
              : undefined}
            icon="bi bi-gpu-card"
          />
        </>
      )}
      {!stats.gpuName && (
        <div className="resource-no-gpu">
          <i className="bi bi-gpu-card" style={{ opacity: 0.3 }} /> No GPU detected
        </div>
      )}
    </div>
  );
}
