"use client";

import { useEffect, useRef } from "react";
import type { SRLine } from "@/lib/support-resistance";
import type { Candle } from "@/lib/excel-parser";

/**
 * Monitors the chart's candles and fires an alert when any candle's
 * high or low actually touches (crosses) an S/R level.
 *
 * This checks the FULL candle range (high/low), not just the close —
 * so if a candle's wick touches a level, the alert fires.
 *
 * Each S/R level fires only once per symbol session (one-shot).
 *
 * Uses: browser notification + toast + double-beep sound.
 */
export function useSRLevelAlerts(
  symbol: string,
  candles: Candle[],
  srLines: SRLine[],
) {
  // Track which candles we've already checked (by timestamp) so we don't
  // re-fire on candles we've already scanned.
  const lastCheckedTimeRef = useRef<number>(0);
  const triggeredRef = useRef<Set<string>>(new Set());
  // Track whether we've done the initial scan for this symbol.
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    if (candles.length === 0 || srLines.length === 0) return;

    // Find candles we haven't checked yet (newer than lastCheckedTime).
    const newCandles = candles.filter((c) => c.time > lastCheckedTimeRef.current);

    if (newCandles.length === 0) return;

    // Update the last checked timestamp.
    lastCheckedTimeRef.current = candles[candles.length - 1].time;

    // On initial load, DON'T fire alerts — just mark current levels as
    // "already known" if the last candle is already touching them.
    // This prevents the "alert on page load" bug.
    if (!initializedRef.current) {
      initializedRef.current = true;
      const lastCandle = candles[candles.length - 1];
      for (const line of srLines) {
        // If the last candle's range already includes this level,
        // mark it as triggered so it doesn't fire immediately.
        if (lastCandle.low <= line.price && lastCandle.high >= line.price) {
          const key = `${symbol}-${line.label}-${line.price}`;
          triggeredRef.current.add(key);
        }
      }
      return; // Skip alerting on the initial load.
    }

    // Check each new candle against each S/R level.
    for (const candle of newCandles) {
      for (const line of srLines) {
        const key = `${symbol}-${line.label}-${line.price}`;
        if (triggeredRef.current.has(key)) continue;

        // A candle "touches" a level if its high or low crosses the level.
        // This means the candle's range [low, high] includes the level price.
        if (candle.low <= line.price && candle.high >= line.price) {
          triggeredRef.current.add(key);
          fireSRAlert(symbol, line, candle.close);
        }
      }
    }
  }, [candles, symbol, srLines]);

  // Reset everything when symbol changes.
  useEffect(() => {
    triggeredRef.current = new Set();
    lastCheckedTimeRef.current = 0;
    initializedRef.current = false;
  }, [symbol]);
}

function fireSRAlert(symbol: string, line: SRLine, price: number) {
  const title = `${symbol}: price touched ${line.label} (${line.price})`;
  const body = `${line.fullLabel} at ${line.price}. ${symbol} current price: ${price}.`;

  // Browser notification (works only while tab is open).
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }

  // Toast notification.
  import("sonner").then(({ toast }) => {
    toast.success(title, { description: body, duration: 10000 });
  });

  // Push notification — fires even when tab is closed / device in standby.
  // Fire-and-forget so a network failure doesn't break the local alert.
  if (typeof fetch === "function") {
    fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        tag: `sr-alert-${symbol}-${line.label}-${line.price}`,
        url: "/",
      }),
    }).catch(() => { /* ignore */ });
  }

  // Play alert sound (double-beep).
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
