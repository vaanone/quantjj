import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CandleScope — MT5 Chart with Auto S/R",
  description: "TradingView-style candlestick chart for MT5 Excel/CSV exports, with automatic support & resistance detection.",
  keywords: ["trading", "MT5", "candlestick", "support resistance", "TradingView", "lightweight-charts"],
  authors: [{ name: "Z.ai" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        style={{ backgroundColor: "#0a0b0f", color: "#e5e7eb" }}
      >
        {children}
        <ShadcnToaster />
        <SonnerToaster position="top-right" theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
