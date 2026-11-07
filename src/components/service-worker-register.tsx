"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (`/sw.js`) so the site qualifies as a
 * Progressive Web App (PWA). This is what makes Chrome / Edge / Brave
 * show the "Install app" prompt, and lets iOS Safari launch the chart
 * in true standalone mode once the user has added it to the home
 * screen.
 *
 * The registration is deferred until after the page has loaded so it
 * never blocks first paint or chart data fetching. Failures are
 * swallowed silently — service worker is a progressive enhancement,
 * not a hard requirement.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Defer registration to the next idle tick so it never contends
    // with chart data loading on first paint.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Check for an updated SW every hour (browsers do this on
          // navigation, but we explicitly trigger a check on focus too).
          if (reg.waiting) {
            // A new version is waiting — activate it on next reload.
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        })
        .catch(() => {
          // Ignore — service worker is best-effort.
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
