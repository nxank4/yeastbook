import { useEffect, useRef, useState, useCallback } from "react";
import type { WsIncoming } from "./types.ts";

type MessageHandler = (msg: WsIncoming) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const msg: WsIncoming = JSON.parse(e.data as string);
        onMessageRef.current(msg);
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  const send = useCallback((data: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { send, connected };
}
