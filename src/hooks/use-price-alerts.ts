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

  // Fire a browser notification.
  const fireNotification = (alert: PriceAlert, price: number) => {
    const title = `${alert.symbol} alert: price touched ${alert.price}`;
    const body = `Current price: ${price}. Alert level ${alert.price} has been reached.`;

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }

    import("sonner").then(({ toast }) => {
      toast.success(title, { description: body, duration: 10000 });
    });
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
