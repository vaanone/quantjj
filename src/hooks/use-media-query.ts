"use client";

import { useSyncExternalStore } from "react";

// Hydration-safe media query hook.
//
// `useSyncExternalStore` is React 18+'s official mechanism for subscribing to
// external (browser-only) state. It guarantees that:
//   - During SSR, `getServerSnapshot` is used (returns `initialValue`).
//   - During the FIRST client render (hydration), `getServerSnapshot` is
//     ALSO used — so the client renders the same DOM as the server.
//   - After hydration, React switches to `getSnapshot` and re-renders if the
//     value differs from `getServerSnapshot`.
//
// This eliminates the "tree hydrated but attributes didn't match" warning
// caused by `useState + useEffect` patterns where the effect changes the
// state immediately after hydration, producing a different DOM on the first
// commit than what was server-rendered.

const noopSubscribe = () => () => {};

/**
 * Subscribe to a CSS media query.
 *
 * @param query       A media query string, e.g. "(min-width: 1024px)".
 * @param initialValue The value to use during SSR and the first client render.
 *                     Pick whichever produces the most common / desired layout
 *                     for the initial paint (avoids layout flash on that viewport).
 */
export function useMediaQuery(query: string, initialValue = true): boolean {
  const subscribe = (callback: () => void) => {
    if (typeof window === "undefined") return noopSubscribe();
    const mql = window.matchMedia(query);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  };

  const getSnapshot = () => {
    if (typeof window === "undefined") return initialValue;
    return window.matchMedia(query).matches;
  };

  const getServerSnapshot = () => initialValue;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
