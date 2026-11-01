"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toFinnhubSymbol } from "@/lib/finnhub-symbols";

interface LivePriceState {
  price: number;
  isConnected: boolean;
  isLive: boolean; // true = WebSocket streaming, false = REST polling
  lastUpdate: number; // timestamp of last tick
}

/**
 * Streams live price data for a symbol via Finnhub.
 *
 * Strategy:
 *   1. Try WebSocket (wss://ws.finnhub.io) — true real-time streaming.
 *   2. If no data arrives within 10 seconds, fall back to REST polling
 *      every 3 seconds (free tier forex may not support WS).
 *
 * The hook auto-reconnects on disconnect and cleans up on unmount.
 */
const WS_TIMEOUT_MS = 10_000; // fall back to polling after 10s of no WS data
const POLL_INTERVAL_MS = 3_000; // poll every 3 seconds as fallback

export function useLivePrice(symbol: string): LivePriceState {
  const [state, setState] = useState<LivePriceState>({
    price: 0,
    isConnected: false,
    isLive: false,
    lastUpdate: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    const finnhubSymbol = toFinnhubSymbol(symbol);

    // If no API key or unsupported symbol, do nothing (state stays at initial values).
    if (!apiKey || !finnhubSymbol) {
      return;
    }

    cleanup();

    // ====== REST polling fallback ======
    const startPolling = () => {
      if (pollRef.current) return; // already polling

      const poll = async () => {
        try {
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.c && data.c > 0) {
            setState({
              price: data.c,
              isConnected: true,
              isLive: false, // polling, not live WS
              lastUpdate: Date.now(),
            });
          }
        } catch {
          // network error — keep trying
        }
      };

      poll(); // immediate fetch
      pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    };

    // ====== WebSocket connection ======
    const connectWS = () => {
      try {
        const ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);
        wsRef.current = ws;

        // If no WS data arrives within WS_TIMEOUT_MS, start REST polling.
        fallbackRef.current = setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // WS connected but no forex data — free tier limitation.
            // Start polling as a supplement.
            startPolling();
          }
        }, WS_TIMEOUT_MS);

        ws.onopen = () => {
          // Subscribe to the symbol's trade stream.
          ws.send(JSON.stringify({ type: "subscribe", symbol: finnhubSymbol }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "trade" && msg.data && msg.data.length > 0) {
              // Take the latest trade price.
              const latestTrade = msg.data[msg.data.length - 1];
              if (latestTrade.p && latestTrade.p > 0) {
                // Clear the fallback timer — we're getting live data.
                if (fallbackRef.current) {
                  clearTimeout(fallbackRef.current);
                  fallbackRef.current = null;
                }
                setState({
                  price: latestTrade.p,
                  isConnected: true,
                  isLive: true,
                  lastUpdate: Date.now(),
                });
              }
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          // WS error — fall back to polling.
          startPolling();
        };

        ws.onclose = () => {
          wsRef.current = null;
          // If we were live, try to reconnect after 5 seconds.
          // Otherwise polling is already running.
          if (!pollRef.current) {
            reconnectRef.current = setTimeout(connectWS, 5000);
          }
        };
      } catch {
        // WS construction failed — fall back to polling immediately.
        startPolling();
      }
    };

    // Start with WebSocket, with REST polling as fallback.
    connectWS();

    return cleanup;
  }, [symbol, cleanup]);

  return state;
}
