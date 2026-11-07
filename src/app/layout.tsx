import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

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
  description: "TradingView-style candlestick chart for MT5 Excel/CSV exports, with automatic pivot levels detection.",
  keywords: ["trading", "MT5", "candlestick", "support resistance", "lightweight-charts"],
  authors: [{ name: "Vaan One" }],
  icons: {
    icon: "/logo.png",
  },
  // PWA-friendly: lets the page be installed as a standalone app on
  // iOS/Android home screen with no browser chrome.
  appleWebApp: {
    capable: true,
    title: "Vaan.One",
    statusBarStyle: "black-translucent",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
