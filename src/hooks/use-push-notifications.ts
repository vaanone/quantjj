"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * usePushNotifications
 *
 * Manages browser push notification permission + push subscription
 * for the chart's price-alert and S/R-level-alert hooks.
 *
 * Flow:
 *   1. User clicks "Enable Notifications" button → calls enable()
 *   2. Browser shows permission dialog
 *   3. If granted, registers a push subscription via service worker
 *   4. POSTs the subscription to /api/push/subscribe
 *   5. Status becomes "enabled" — push notifications will fire on
 *      price/SR alerts even when the tab is closed
 *
 * disable() unregisters the subscription and POSTs the endpoint to
 * /api/push/unsubscribe so the server stops sending (and doesn't
 * waste quota).
 *
 * The Notification.permission status is also reflected so the UI can
 * show the right button label.
 */

type PushStatus = "unsupported" | "default" | "granted" | "denied";

interface UsePushNotificationsReturn {
  status: PushStatus;
  /** True after a subscription has been registered with the server. */
  subscribed: boolean;
  /** True while enable/disable is in flight. */
  loading: boolean;
  /** Enable notifications — requests permission + creates subscription. */
  enable: () => Promise<void>;
  /** Disable — unsubscribes + removes subscription from server. */
  disable: () => Promise<void>;
  /**
   * Convenience helper for sending a push notification to all of THIS
   * user's devices via /api/push/send. Returns true if the request
   * succeeded (doesn't guarantee delivery).
   */
  sendPush: (title: string, body: string, tag?: string, url?: string) => Promise<boolean>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [status, setStatus] = useState<PushStatus>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sync browser permission state on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as PushStatus);

    // Check if we already have a subscription.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          setSubscribed(Boolean(sub));
        })
        .catch(() => {});
    }
  }, []);

  const enable = useCallback(async () => {
    if (typeof window === "undefined") return;
    setLoading(true);
    try {
      // Step 1: ask for permission.
      let perm: NotificationPermission;
      if ("Notification" in window) {
        perm = await Notification.requestPermission();
      } else {
        // iOS Safari without PWA install — unsupported.
        setStatus("unsupported");
        return;
      }
      setStatus(perm as PushStatus);
      if (perm !== "granted") return;

      // Step 2: fetch the VAPID public key from our server.
      const res = await fetch("/api/push/subscribe", { cache: "no-store" });
      if (!res.ok) return;
      const { publicKey } = await res.json();
      if (!publicKey) {
        console.warn("[push] No VAPID public key — server misconfigured");
        return;
      }

      // Step 3: register a push subscription via the service worker.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // required by all browsers — must show a notification
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Step 4: POST the subscription to our server.
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      setSubscribed(true);
    } catch (err) {
      console.error("[push] enable failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (typeof window === "undefined") return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Tell the server to drop this subscription too.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setSubscribed(false);
    } catch (err) {
      console.error("[push] disable failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const sendPush = useCallback(
    async (title: string, body: string, tag?: string, url?: string) => {
      try {
        const res = await fetch("/api/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, tag, url }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [],
  );

  return { status, subscribed, loading, enable, disable, sendPush };
}

/** Convert a base64-url string to a Uint8Array (for VAPID key). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
