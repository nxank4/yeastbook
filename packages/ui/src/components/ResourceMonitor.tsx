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

export function ResourceMonitor() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchStats = () => {
      fetch("/api/system/stats")
        .then((r) => r.json())
        .then((data) => { if (mounted) setStats(data); })
        .catch(() => {});
    };
    fetchStats();
    intervalRef.current = setInterval(fetchStats, 2000);
    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!stats) {
    return <div className="resource-empty"><i className="bi bi-hourglass-split" /> Loading stats...</div>;
  }

  return (
    <div className="resource-monitor">
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
