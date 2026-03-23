import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "yeastbook_debug";

export function useDebugMode(): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState(() => {
    if (process.env.NODE_ENV === "production") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("debug") === "perf" || localStorage.getItem(STORAGE_KEY) === "true";
  });

  const toggle = useCallback(() => {
    if (process.env.NODE_ENV === "production") return;
    setEnabled((prev) => {
      const next = !prev;
      if (next) localStorage.setItem(STORAGE_KEY, "true");
      else localStorage.removeItem(STORAGE_KEY);
      return next;
    });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F12") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  return { enabled, toggle };
}
