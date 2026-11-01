"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: "above" | "below";
  triggered: boolean;
  createdAt: number;
}

/**
 * Manages price alerts for the chart.
 *
 * Alerts are stored in localStorage so they persist across page reloads.
 * Each alert monitors the current price — when the condition is met
 * (price crosses above/below the alert price), a browser notification
 * is fired and the alert is marked as triggered.
 *
 * Alerts only fire once (one-shot), matching TradingView behavior.
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

  // Check alerts against the current price. Fires notifications when
  // a condition is met.
  useEffect(() => {
    if (currentPrice <= 0) return;
    const prevPrice = lastPriceRef.current;
    lastPriceRef.current = currentPrice;

    setAlerts((prev) => {
      let changed = false;
      const updated = prev.map((alert) => {
        if (alert.triggered || alert.symbol !== symbol) return alert;

        let hit = false;
        if (alert.condition === "above" && currentPrice >= alert.price) {
          // Only trigger if the price actually crossed (was below, now at/above).
          if (prevPrice === 0 || prevPrice < alert.price) hit = true;
        }
        if (alert.condition === "below" && currentPrice <= alert.price) {
          if (prevPrice === 0 || prevPrice > alert.price) hit = true;
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
    const title = `${alert.symbol} alert: ${alert.condition} ${alert.price}`;
    const body = `Current price: ${price}. ${alert.condition === "above" ? "Price crossed above" : "Price crossed below"} ${alert.price}.`;

    // Try browser notification.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }

    // Also show a toast (imported dynamically to avoid circular deps).
    import("sonner").then(({ toast }) => {
      toast.success(title, { description: body, duration: 10000 });
    });
  };

  const addAlert = useCallback(
    (price: number, condition: "above" | "below") => {
      const alert: PriceAlert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        symbol,
        price,
        condition,
        triggered: false,
        createdAt: Date.now(),
      };
      setAlerts((prev) => [...prev, alert]);

      // Request notification permission if not already granted.
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
