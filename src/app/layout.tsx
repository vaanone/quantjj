import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vaan.One — Vaan Pivot",
  description: "TradingView-style candlestick chart for MT5 Excel/CSV exports, with daily pivot (support & resistance) levels and price alerts.",
  keywords: ["trading", "MT5", "candlestick", "support resistance", "lightweight-charts", "pivot"],
  authors: [{ name: "Vaan One" }],
  // Link the PWA manifest so browsers know this site is installable.
  // The manifest declares icons, theme color, display mode (standalone),
  // and start_url — everything a browser needs to offer "Install App" /
  // "Add to Home Screen" and launch the chart in true app mode.
  manifest: "/manifest.webmanifest",
  // App icons — referenced by the browser for the home-screen icon,
  // taskbar icon, install prompt, etc.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/logo.png", sizes: "473x394", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  // PWA-friendly: lets the page be installed as a standalone app on
  // iOS/Android home screen with no browser chrome.
  appleWebApp: {
    capable: true,
    title: "Vaan.One",
    statusBarStyle: "black-translucent",
  },
  // Format hints for social sharing / messaging apps.
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

// App-like viewport: cover the whole screen (notches, safe areas),
// prevent user zoom (so it feels like a native app, not a webpage).
// Next.js 16 requires viewport to be in a separate `viewport` export.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#070D12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
        style={{ backgroundColor: "#070D12", color: "#EFF3F3" }}
      >
        <ThemeProvider>
          {children}
          <SonnerToaster position="top-right" theme="dark" richColors closeButton />
          {/* Service worker registration — required by Chrome/Edge for the
              PWA install prompt to appear, and gives the app basic offline
              launch capability so the chart shell boots even with no
              network. Registered after load so it never blocks first paint. */}
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
