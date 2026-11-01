"use client";

import { useEffect, useState } from "react";

/**
 * Tracks online users + total visits via the /api/online heartbeat endpoint.
 *
 * - `online`: current live users (heartbeat-based, pruned after 45s of silence)
 * - `visited`: cumulative unique visitors (ever-increasing, resets on server restart)
 */
const HEARTBEAT_INTERVAL = 15_000; // 15s
const POLL_INTERVAL = 5_000; // 5s

export interface OnlineStats {
  online: number;
  visited: number;
}

export function useOnlineCount(): OnlineStats {
  const [stats, setStats] = useState<OnlineStats>({ online: 0, visited: 0 });

  useEffect(() => {
    const sessionId =
      sessionStorage.getItem("vaan-session") ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("vaan-session", sessionId);

    let cancelled = false;

    const ping = async () => {
      try {
        const res = await fetch(`/api/online?id=${sessionId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setStats({ online: data.online, visited: data.visited });
        }
      } catch {
        // Network errors are non-fatal.
      }
    };

    ping();
    const heartbeat = setInterval(ping, HEARTBEAT_INTERVAL);

    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/online");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setStats({ online: data.online, visited: data.visited });
        }
      } catch {
        // ignore
      }
    }, POLL_INTERVAL);

    const handleUnload = () => {
      navigator.sendBeacon(`/api/online?id=${sessionId}`);
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      window.removeEventListener("beforeunload", handleUnload);
      fetch(`/api/online?id=${sessionId}`, { method: "DELETE" }).catch(() => {});
    };
  }, []);

  return stats;
}
