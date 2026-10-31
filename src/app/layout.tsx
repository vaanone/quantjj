import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JJPIVOX — Daily Pivot Levels",
  description: "TradingView-style candlestick chart for MT5 Excel/CSV exports, with automatic pivot levels detection.",
  keywords: ["trading", "MT5", "candlestick", "support resistance", "lightweight-charts"],
  authors: [{ name: "Vaan One" }],
  icons: {
    icon: "/logo.png",
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
        <ThemeProvider>
          {children}
          <SonnerToaster position="top-right" theme="dark" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
