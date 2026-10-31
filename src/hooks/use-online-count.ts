"use client";

import { useEffect, useState } from "react";

/**
 * Tracks online users via the /api/online heartbeat endpoint.
 *
 * On mount, generates a unique session ID, registers it with the server,
 * then pings every 15 seconds to stay "alive". The server prunes sessions
 * that haven't pinged in 45 seconds. The current online count is polled
 * every 5 seconds so new users/joins are reflected without a full
 * WebSocket connection.
 *
 * Returns 0 while the first request is in flight, then the live count.
 */
const HEARTBEAT_INTERVAL = 15_000; // 15s
const POLL_INTERVAL = 5_000; // 5s

export function useOnlineCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Stable per-tab session ID so reconnection after HMR doesn't inflate count.
    const sessionId =
      sessionStorage.getItem("vaanpulse-session") ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("vaanpulse-session", sessionId);

    let cancelled = false;

    // Register + fetch count.
    const ping = async () => {
      try {
        const res = await fetch(`/api/online?id=${sessionId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setCount(data.online);
        }
      } catch {
        // Network errors are non-fatal — we'll retry on the next interval.
      }
    };

    // Immediate ping on mount.
    ping();

    // Heartbeat: keep our session alive.
    const heartbeat = setInterval(ping, HEARTBEAT_INTERVAL);

    // Poll for the current count more frequently than the heartbeat so
    // other users joining/leaving is reflected quickly.
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/online");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setCount(data.online);
        }
      } catch {
        // ignore
      }
    }, POLL_INTERVAL);

    // On unmount / page close, deregister so the count drops immediately.
    const handleUnload = () => {
      navigator.sendBeacon(`/api/online?id=${sessionId}`);
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      window.removeEventListener("beforeunload", handleUnload);
      // Best-effort deregistration.
      fetch(`/api/online?id=${sessionId}`, { method: "DELETE" }).catch(() => {});
    };
  }, []);

  return count;
}
