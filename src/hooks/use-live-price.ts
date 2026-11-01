"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface LivePriceState {
  price: number;
  change: number;
  changePct: number;
  isConnected: boolean;
  lastUpdate: number;
  marketState: string;
}

const POLL_INTERVAL_MS = 3_000; // poll every 3 seconds
const SUPPORTED_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDCHF"];

/**
 * Polls live price for a symbol via our /api/live-price Yahoo Finance proxy.
 *
 * Yahoo Finance doesn't offer a free WebSocket for forex, so we poll every
 * 3 seconds. This is fast enough for S/R-level trading — the price updates
 * smoothly on the chart without needing real-time WebSocket streaming.
 *
 * The hook auto-stops when the symbol is unsupported or the component unmounts.
 */
export function useLivePrice(symbol: string): LivePriceState {
  const [state, setState] = useState<LivePriceState>({
    price: 0,
    change: 0,
    changePct: 0,
    isConnected: false,
    lastUpdate: 0,
    marketState: "CLOSED",
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");

    // Only poll for supported symbols.
    if (!SUPPORTED_SYMBOLS.includes(clean)) {
      cleanup();
      return;
    }

    cleanup();

    const poll = async () => {
      try {
        const res = await fetch(`/api/live-price?symbol=${encodeURIComponent(clean)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.price && data.price > 0) {
          setState({
            price: data.price,
            change: data.change ?? 0,
            changePct: data.changePct ?? 0,
            isConnected: true,
            lastUpdate: Date.now(),
            marketState: data.marketState ?? "REGULAR",
          });
        }
      } catch {
        // Network error — keep trying, don't crash.
      }
    };

    poll(); // immediate fetch
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return cleanup;
  }, [symbol, cleanup]);

  return state;
}
