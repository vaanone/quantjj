"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Thin wrapper around next-themes' ThemeProvider so we can use `useTheme()`
 * (e.g. inside the Sonner toaster) without triggering hydration mismatches.
 *
 * Configured to:
 *   - Apply the active theme as a `class` attribute on <html>.
 *   - Default to dark mode (matches the chart's dark canvas background).
 *   - Disable system preference detection so SSR and client always agree on
 *     the initial theme (no `prefers-color-scheme` lookup that would
 *     differ between server and client).
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
