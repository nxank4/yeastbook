import { useEffect, useState, useRef } from "react";

export function useActiveCellObserver(cellIds: string[]): string | null {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (cellIds.length === 0) {
      setActiveCellId(null);
      return;
    }

    // Top 40% of viewport is the trigger zone
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace(/^cell-/, "");
            setActiveCellId(id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );

    const observer = observerRef.current;
    for (const id of cellIds) {
      const el = document.getElementById(`cell-${id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [cellIds]);

  return activeCellId;
}
