"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  triggered: boolean;
  createdAt: number;
}

/**
 * Manages price alerts for the chart.
 *
 * Alerts are stored in localStorage so they persist across page reloads.
 * An alert fires when the live price touches (crosses) the alert price —
 * from either direction. No "above" or "below" condition needed.
 *
 * Alerts only fire once (one-shot).
 */
export function usePriceAlerts(symbol: string, currentPrice: number) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const lastPriceRef = useRef<number>(0);

  // Load alerts from localStorage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vaan-price-alerts");
      if (stored) {
        setAlerts(JSON.parse(stored));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Persist alerts to localStorage whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem("vaan-price-alerts", JSON.stringify(alerts));
    } catch {
      // ignore storage errors
    }
  }, [alerts]);

  // Check alerts against the current price. Fires when price touches
  // the alert level (crosses from either direction).
  useEffect(() => {
    if (currentPrice <= 0) return;
    const prevPrice = lastPriceRef.current;
    lastPriceRef.current = currentPrice;

    setAlerts((prev) => {
      let changed = false;
      const updated = prev.map((alert) => {
        if (alert.triggered || alert.symbol !== symbol) return alert;

        // Trigger when price crosses the alert level from either direction.
        let hit = false;
        if (prevPrice > 0) {
          // Crossed from below to above, or from above to below.
          if ((prevPrice < alert.price && currentPrice >= alert.price) ||
              (prevPrice > alert.price && currentPrice <= alert.price)) {
            hit = true;
          }
        } else {
          // First price update — trigger if already at/very close to alert.
          if (Math.abs(currentPrice - alert.price) / alert.price < 0.001) {
            hit = true;
          }
        }

        if (hit) {
          changed = true;
          fireNotification(alert, currentPrice);
          return { ...alert, triggered: true };
        }
        return alert;
      });
      return changed ? updated : prev;
    });
  }, [currentPrice, symbol]);

  // Fire a browser notification + play an alert sound + send a push
  // notification (for when the tab is closed / device is in standby).
  const fireNotification = (alert: PriceAlert, price: number) => {
    const title = `${alert.symbol} alert: price touched ${alert.price}`;
    const body = `Current price: ${price}. Alert level ${alert.price} has been reached.`;

    // Browser notification (works only while tab is open).
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }

    // Toast notification.
    import("sonner").then(({ toast }) => {
      toast.success(title, { description: body, duration: 10000 });
    });

    // Push notification (works even when tab is closed / device in standby).
    // Fire-and-forget — we don't wait for the response, and we swallow
    // errors so a failed push never blocks the alert from firing locally.
    fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        tag: `price-alert-${alert.symbol}-${alert.price}`,
        url: "/",
      }),
    }).catch(() => { /* ignore network errors */ });

    // Play an alert sound using the Web Audio API (no external file needed).
    // Generates a simple double-beep tone — immediately audible even if
    // the tab is in the background.
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        // First beep (higher pitch).
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.value = 880; // A5
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc1.connect(gain1).connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.3);

        // Second beep (lower pitch) — plays right after the first.
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.value = 660; // E5
        gain2.gain.setValueAtTime(0, now + 0.35);
        gain2.gain.linearRampToValueAtTime(0.3, now + 0.37);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.65);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now + 0.35);
        osc2.stop(now + 0.65);

        // Close the audio context after the sound finishes.
        setTimeout(() => ctx.close(), 1000);
      }
    } catch {
      // Audio not available (e.g. older browser) — silent fail.
    }
  };

  const addAlert = useCallback(
    (price: number) => {
      const alert: PriceAlert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        symbol,
        price,
        triggered: false,
        createdAt: Date.now(),
      };
      setAlerts((prev) => [...prev, alert]);

      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    },
    [symbol],
  );

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setAlerts([]);
  }, []);

  return { alerts, addAlert, removeAlert, clearAll };
}
