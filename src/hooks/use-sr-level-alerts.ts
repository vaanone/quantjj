"use client";

import { useEffect, useRef } from "react";
import type { SRLine } from "@/lib/support-resistance";

/**
 * Monitors the current price and fires an alert when it touches (crosses)
 * any S/R level — similar to TradingView's "price touches line" alert.
 *
 * Each S/R level can fire only once per session (one-shot). After firing,
 * the level is added to a "triggered" set so it doesn't spam repeated alerts.
 *
 * Uses the same notification system as the price alerts: browser notification +
 * toast + sound.
 */
export function useSRLevelAlerts(
  symbol: string,
  currentPrice: number,
  srLines: SRLine[],
) {
  const lastPriceRef = useRef<number>(0);
  const triggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (currentPrice <= 0 || srLines.length === 0) return;

    const prevPrice = lastPriceRef.current;
    lastPriceRef.current = currentPrice;

    for (const line of srLines) {
      const key = `${symbol}-${line.label}-${line.price}`;
      if (triggeredRef.current.has(key)) continue;

      let touched = false;
      if (prevPrice > 0) {
        // Price crossed the level from either direction.
        if ((prevPrice < line.price && currentPrice >= line.price) ||
            (prevPrice > line.price && currentPrice <= line.price)) {
          touched = true;
        }
      }

      if (touched) {
        triggeredRef.current.add(key);
        fireSRAlert(symbol, line);
      }
    }
  }, [currentPrice, symbol, srLines]);

  // Reset triggered levels when symbol changes.
  useEffect(() => {
    triggeredRef.current = new Set();
    lastPriceRef.current = 0;
  }, [symbol]);
}

function fireSRAlert(symbol: string, line: SRLine) {
  const title = `${symbol}: price touched ${line.label} (${line.price})`;
  const body = `${line.fullLabel} at ${line.price}. ${symbol} has reached this ${line.type} level.`;

  // Browser notification.
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }

  // Toast notification.
  import("sonner").then(({ toast }) => {
    toast.success(title, { description: body, duration: 10000 });
  });

  // Play alert sound (same double-beep as price alerts).
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.value = 880;
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc1.connect(gain1).connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = 660;
      gain2.gain.setValueAtTime(0, now + 0.35);
      gain2.gain.linearRampToValueAtTime(0.3, now + 0.37);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.65);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(now + 0.35);
      osc2.stop(now + 0.65);

      setTimeout(() => ctx.close(), 1000);
    }
  } catch {
    // Audio not available — silent fail.
  }
}
