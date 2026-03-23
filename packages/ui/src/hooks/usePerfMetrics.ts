import { useState, useEffect, useRef, useCallback } from "react";
import type { ProfilerProps } from "react";

export interface PerfMetrics {
  fps: number;
  fpsHistory: number[];
  wsLatency: number | null;
  lastExecTime: number | null;
  renderTime: number | null;
  heapMB: number | null;
}

const EMPTY_METRICS: PerfMetrics = {
  fps: 0,
  fpsHistory: [],
  wsLatency: null,
  lastExecTime: null,
  renderTime: null,
  heapMB: null,
};

const noop = () => {};

export function usePerfMetrics(
  enabled: boolean,
  send: (data: Record<string, unknown>) => void,
) {
  const [metrics, setMetrics] = useState<PerfMetrics>(EMPTY_METRICS);
  const execStartsRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number>(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const heapIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const renderTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMetrics(EMPTY_METRICS);
      return;
    }

    // FPS counter via rAF
    let frameCount = 0;
    let lastSecond = performance.now();
    let running = true;

    const tick = () => {
      if (!running) return;
      frameCount++;
      const now = performance.now();
      if (now - lastSecond >= 1000) {
        const fps = frameCount;
        frameCount = 0;
        lastSecond = now;
        const renderTime = renderTimeRef.current;
        setMetrics((prev) => {
          const history = [...prev.fpsHistory, fps];
          if (history.length > 20) history.shift();
          return { ...prev, fps, fpsHistory: history, renderTime };
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // WS latency ping every 5s
    pingIntervalRef.current = setInterval(() => {
      send({ type: "ping", ts: Date.now() });
    }, 5000);

    // Heap usage every 2s
    heapIntervalRef.current = setInterval(() => {
      try {
        const mem = (performance as any).memory;
        if (mem?.usedJSHeapSize) {
          const heapMB = Math.round(mem.usedJSHeapSize / 1048576 * 10) / 10;
          setMetrics((prev) => ({ ...prev, heapMB }));
        }
      } catch {}
    }, 2000);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      clearInterval(pingIntervalRef.current);
      clearInterval(heapIntervalRef.current);
    };
  }, [enabled, send]);

  const recordExecStart = useCallback(
    (cellId: string) => {
      if (!enabled) return;
      execStartsRef.current.set(cellId, performance.now());
    },
    [enabled],
  );

  const recordExecEnd = useCallback(
    (cellId: string) => {
      if (!enabled) return;
      const start = execStartsRef.current.get(cellId);
      if (start != null) {
        const lastExecTime = Math.round(performance.now() - start);
        execStartsRef.current.delete(cellId);
        setMetrics((prev) => ({ ...prev, lastExecTime }));
      }
    },
    [enabled],
  );

  const recordPong = useCallback(
    (ts: number) => {
      if (!enabled) return;
      const wsLatency = Date.now() - ts;
      setMetrics((prev) => ({ ...prev, wsLatency }));
    },
    [enabled],
  );

  const onProfilerRender: ProfilerProps["onRender"] = useCallback(
    (_id: string, _phase: string, actualDuration: number) => {
      if (!enabled) return;
      renderTimeRef.current = Math.round(actualDuration * 10) / 10;
    },
    [enabled],
  );

  if (!enabled) {
    return {
      metrics: EMPTY_METRICS,
      onProfilerRender: noop as unknown as ProfilerProps["onRender"],
      recordExecStart: noop,
      recordExecEnd: noop,
      recordPong: noop,
    };
  }

  return { metrics, onProfilerRender, recordExecStart, recordExecEnd, recordPong };
}
