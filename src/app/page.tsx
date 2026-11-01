"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TradingChart } from "@/components/trading-chart";
import { DriveFilePicker } from "@/components/drive-file-picker";
import { LevelsPanel } from "@/components/levels-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { detectSupportResistance, getTop6Levels, userLevelsToLines } from "@/lib/support-resistance";
import { detectTimeframe, type TimeframeInfo } from "@/lib/timeframe";
import type { Candle, ParseResult } from "@/lib/excel-parser";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

const SR_SENSITIVITY_BARS = 5;
const SR_TOLERANCE_PCT = 0.15;
const SR_MIN_TOUCHES = 2;
/** Load this many candles into the chart data (the user can scroll back to see older ones). */
const MAX_DISPLAY_CANDLES = 200;
/** Number of candles visible at once on initial load (zoom level). */
const VISIBLE_CANDLES = 100;

interface LoadedFile {
  result: ParseResult;
  fileName: string;
  selectedSymbol: string;
}

export default function Home() {
  const [view, setView] = useState<"landing" | "chart">("landing");
  const [files, setFiles] = useState<Map<string, LoadedFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const isLg = useMediaQuery("(min-width: 1024px)", true);

  const handleLoaded = useCallback(
    (result: ParseResult, fileName: string) => {
      const primarySymbol = result.symbol || result.symbols[0] || "";
      setFiles((prev) => {
        const next = new Map(prev);
        next.set(fileName, { result, fileName, selectedSymbol: primarySymbol });
        return next;
      });
      setSelectedFile(fileName);
    },
    [],
  );

  const currentFile = files.get(selectedFile);
  const currentResult = currentFile?.result;
  const selectedSymbol = currentFile?.selectedSymbol ?? "";

  const candles = useMemo(() => {
    if (!currentResult) return [];
    const syms = currentResult.symbols;
    const filtered =
      syms.length <= 1
        ? currentResult.candles
        : currentResult.candles.filter(
            (c) => !c.symbol || c.symbol === selectedSymbol,
          );
    // Show only the last MAX_DISPLAY_CANDLES so each candle is wide and
    // readable ("big zoom" view). The full history is still in memory if
    // we ever need it.
    if (filtered.length > MAX_DISPLAY_CANDLES) {
      return filtered.slice(filtered.length - MAX_DISPLAY_CANDLES);
    }
    return filtered;
  }, [currentResult, selectedSymbol]);

  const timeframe = useMemo(() => detectTimeframe(candles), [candles]);

  // S/R lines: prefer user-defined levels from CSV columns J–O when present.
  // Fall back to auto-detection only when the file has no user levels.
  // Computed inline (not memoized) to avoid stale-closure issues when switching
  // files — the computation is cheap enough.
  const top6Lines = (() => {
    if (candles.length < 10) return [];
    const lastClose = candles[candles.length - 1].close;
    const result = files.get(selectedFile)?.result;
    if (result?.userLevels && result.userLevels.length > 0) {
      return userLevelsToLines(result.userLevels, lastClose);
    }
    const allLevels = detectSupportResistance(candles, {
      leftBars: SR_SENSITIVITY_BARS,
      rightBars: SR_SENSITIVITY_BARS,
      tolerancePct: SR_TOLERANCE_PCT,
      minTouches: SR_MIN_TOUCHES,
      maxLevels: 20,
    });
    return getTop6Levels(allLevels, lastClose);
  })();

  // ---- Global symbol list: all symbols across ALL loaded files ----
  // Each entry: { symbol, fileName }. Used to populate the unified dropdown
  // so the user can pick any symbol from any file directly.
  const allSymbols = useMemo(() => {
    const entries: { symbol: string; fileName: string }[] = [];
    for (const [fileName, loaded] of files) {
      for (const sym of loaded.result.symbols) {
        entries.push({ symbol: sym, fileName });
      }
    }
    // Sort by symbol name, then by file name for duplicates.
    entries.sort((a, b) =>
      a.symbol !== b.symbol
        ? a.symbol.localeCompare(b.symbol)
        : a.fileName.localeCompare(b.fileName),
    );
    return entries;
  }, [files]);

  // The dropdown's value encodes BOTH the file and symbol as `fileName::symbol`.
  // This lets us disambiguate when the same symbol exists in multiple files.
  const dropdownValue = selectedFile && selectedSymbol
    ? `${selectedFile}::${selectedSymbol}`
    : selectedFile;

  const handleDropdownChange = useCallback(
    (value: string) => {
      const [fileName, ...symbolParts] = value.split("::");
      const symbol = symbolParts.join("::");
      setFiles((prev) => {
        const next = new Map(prev);
        const f = next.get(fileName);
        if (f && symbol) next.set(fileName, { ...f, selectedSymbol: symbol });
        return next;
      });
      setSelectedFile(fileName);
    },
    [],
  );

  const fileNames = Array.from(files.keys());
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // Market change%: calculated from TODAY's first candle (the day's open).
  // We find the first candle whose UTC date matches the last candle's UTC date,
  // and use its open price as the "market open" reference. This gives the
  // correct intraday change, not the change across all 200 loaded candles.
  const todayOpen = (() => {
    if (candles.length === 0) return 0;
    const lastCandle = candles[candles.length - 1];
    const lastD = new Date(lastCandle.time * 1000);
    const lastDay = lastD.getUTCFullYear() * 10000 + (lastD.getUTCMonth() + 1) * 100 + lastD.getUTCDate();
    for (let i = candles.length - 1; i >= 0; i--) {
      const d = new Date(candles[i].time * 1000);
      const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      if (dayKey !== lastDay) {
        // The candle just before this one is the first candle of today.
        return candles[i + 1]?.open ?? lastClose;
      }
    }
    // All candles are from the same day — use the very first candle's open.
    return candles[0].open;
  })();
  const totalChangePct = todayOpen > 0 ? ((lastClose - todayOpen) / todayOpen) * 100 : 0;
  const symbolLabel = selectedSymbol || currentResult?.symbol || "";

  // For the symbol dropdown value: the currently active symbol.
  const activeSymbolValue = selectedSymbol || currentResult?.symbol || "";

  if (view === "landing") {
    return <LandingPage onOpenChart={() => setView("chart")} />;
  }

  return (
    <div className="flex h-screen flex-col bg-[#000000] text-white">
      {/* ============================================================= HEADER */}
      <header className="flex items-center gap-2 border-b border-white/10 bg-[#0d0a00] px-3 py-2">
        {/* Back to home button */}
        <button
          onClick={() => setView("landing")}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="Back to home"
        >
          <img src="/logo.png" alt="Vaan.One" className="h-7 w-7 rounded-md object-contain sm:h-9 sm:w-9" />
        {/* App name — hidden on mobile to save space */}
        <div className="hidden shrink-0 sm:block">
          <h1 className="text-sm font-semibold leading-tight">Vaan.One</h1>
          <p className="text-[10px] leading-tight text-white/40">Vaan Pivot</p>
        </div>
        </button>

        {/* Spacer to push the rest to the right on desktop */}
        <div className="flex-1" />

        {/* All controls in one row, no wrapping */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Symbol dropdown — right next to logo */}
          {activeSymbolValue && (
            <Select value={dropdownValue} onValueChange={handleDropdownChange}>
              <SelectTrigger className="h-7 w-auto min-w-[70px] max-w-[120px] gap-1 border-white/15 bg-white/5 px-1.5 font-mono text-xs font-bold tracking-wide text-white hover:bg-white/10 sm:h-8 sm:min-w-[110px] sm:max-w-[220px] sm:px-2 sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 border-white/15 bg-[#15161d] text-white">
                {allSymbols.map((entry) => (
                  <SelectItem
                    key={`${entry.fileName}::${entry.symbol}`}
                    value={`${entry.fileName}::${entry.symbol}`}
                    className="font-mono focus:bg-white/10"
                  >
                    {entry.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Last close + change % — same line, next to dropdown */}
          {candles.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 sm:border-l sm:border-white/10 sm:pl-2">
              <span className="font-mono text-[10px] text-white/50 sm:text-xs">
                {lastClose >= 1000 ? lastClose.toFixed(2) : lastClose.toFixed(5)}
              </span>
              <Badge
                variant="outline"
                className={`h-5 border-white/15 px-1 text-[9px] font-mono sm:text-[10px] ${
                  totalChangePct >= 0
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {totalChangePct >= 0 ? "+" : ""}
                {totalChangePct.toFixed(2)}%
              </Badge>
            </div>
          )}

          {/* Timeframe badge — same line, next to percentage */}
          {timeframe && (
            <Badge className="h-7 shrink-0 gap-1 border border-amber-500/30 bg-amber-500/10 px-1.5 font-mono text-xs font-bold text-amber-400 sm:h-8 sm:px-2 sm:text-sm">
              {timeframe.label}
            </Badge>
          )}

          {/* Drive refresh button — always rendered (even before candles load)
              so it can fetch files and clear the loading state. */}
          <DriveFilePicker
            onLoaded={handleLoaded}
            onLastUpdate={setLastUpdate}
            onLoadingChange={setChartLoading}
            compact
          />
        </div>
      </header>

      {/* ============================================================ TOOLBAR */}
      {candles.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-white/10 bg-[#0d0a00] px-4 py-1.5 text-[11px] text-white/70">
          {/* Disclaimer — left side, small font, single line */}
          <p className="hidden whitespace-nowrap text-[10px] leading-tight text-white/30 sm:block">
            Daily Vaan.One Levels are updated manually every morning for educational and informational purposes only.
          </p>
          {/* Last Update timestamp — right side */}
          <div className="ml-auto flex items-center gap-3">
            {lastUpdate && (
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[9px] uppercase tracking-wider text-white/30">
                  Last Update @
                </span>
                <span className="font-mono text-xs text-white/50">
                  {formatLastUpdate(lastUpdate)}
                </span>
              </div>
            )}
          </div>
          <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-white/15 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 lg:hidden"
              >
                <PanelRight className="h-3.5 w-3.5" />
                Levels
                <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">{top6Lines.length}</Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto border-white/10 bg-[#0d0a00] p-0 lg:hidden">
              <SheetHeader className="border-b border-white/10 px-4 py-3">
                <SheetTitle className="text-sm font-semibold text-white">
                  Pivot Levels
                </SheetTitle>
              </SheetHeader>
              <LevelsPanel
                lines={top6Lines}
                lastClose={lastClose}
                symbol={symbolLabel}
              />
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* ============================================================== BODY */}
      <main className="relative flex-1 overflow-hidden">
        {/* Full-screen loading overlay — shown on first load while Drive files
            are being fetched and parsed. */}
        {chartLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#000000]">
            <div className="flex flex-col items-center gap-6">
              <img src="/logo.png" alt="Vaan.One" className="h-16 w-16 rounded-lg object-contain opacity-80" />
              <LoadingDots />
            </div>
          </div>
        )}
        {candles.length === 0 && !chartLoading ? (
          <EmptyState onLoaded={handleLoaded} />
        ) : isLg ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={75} minSize={50}>
              <ChartArea
                candles={candles}
                lines={top6Lines}
                symbol={symbolLabel}
                timeframe={timeframe}
              />
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-white/10" />
            <ResizablePanel defaultSize={25} minSize={18} maxSize={45}>
              <LevelsPanel
                key={selectedFile}
                lines={top6Lines}
                lastClose={lastClose}
                symbol={symbolLabel}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ChartArea
            candles={candles}
            lines={top6Lines}
            symbol={symbolLabel}
            timeframe={timeframe}
          />
        )}
      </main>
    </div>
  );
}

function ChartArea({
  candles,
  lines,
  symbol,
  timeframe,
}: {
  candles: Candle[];
  lines: ReturnType<typeof getTop6Levels>;
  symbol: string;
  timeframe: TimeframeInfo | null;
}) {
  return (
    <div className="relative h-full w-full bg-[#100c00]">
      <TradingChart
        candles={candles}
        lines={lines}
        symbol={symbol}
        timeframe={timeframe}
        visibleCount={VISIBLE_CANDLES}
      />
      <div className="pointer-events-none absolute left-4 top-3 select-none">
        <div className="flex items-baseline gap-2">
          <div className="font-mono text-3xl font-bold text-white/[0.06]">{symbol || "—"}</div>
          {timeframe && (
            <div className="font-mono text-xl font-bold text-amber-400/15">
              {timeframe.label}
            </div>
          )}
        </div>
        <div className="font-mono text-[10px] tracking-widest text-white/[0.05]">
          Vaan.One · {candles.length} BARS · LAST {MAX_DISPLAY_CANDLES}
        </div>
      </div>
    </div>
  );
}

// ============================================================ EMPTY STATE
function EmptyState({
  onLoaded,
}: {
  onLoaded: (r: ParseResult, fileName: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Vaan One"
          className="mx-auto mb-4 h-16 w-16 rounded-lg object-contain"
        />
        <h2 className="text-2xl font-semibold">Vaan.One</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          Upload MT5 candlestick CSV files to load them into the chart. Pivot Levels
          are read from columns H–O.
        </p>
      </div>
      <div className="w-full max-w-xl">
        <DriveFilePicker onLoaded={onLoaded} />
      </div>
    </div>
  );
}

// Format an ISO timestamp as "Aug 10th | 5:15 AM IST".
// Uses Asia/Kolkata (IST = UTC+5:30) regardless of the viewer's local
// timezone, because the user's data source operates on IST.
function formatLastUpdate(isoTime: string): string {
  const d = new Date(isoTime);
  if (isNaN(d.getTime())) return "";

  // Force IST (Asia/Kolkata = UTC+5:30) so the time is consistent for all viewers.
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = istFormatter.formatToParts(d);

  const month = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const hour = parts.find((p) => p.type === "hour")?.value || "";
  const minute = parts.find((p) => p.type === "minute")?.value || "";
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";

  const dayNum = parseInt(day, 10);
  const ordinal = getOrdinal(dayNum);

  return `${month} ${day}${ordinal} | ${hour}:${minute} ${dayPeriod} IST`;
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// "Loading Chart" with animated dots that grow from . to .....
// Uses a JS interval (250ms) so the animation works in all browsers
// without relying on CSS @keyframes content animations.
function LoadingDots() {
  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 5 ? 0 : prev + 1));
    }, 250);
    return () => clearInterval(interval);
  }, []);
  return (
    <span className="font-mono text-2xl text-white/80">
      Loading Chart
      <span className="text-amber-400">{".".repeat(dotCount)}</span>
    </span>
  );
}

// ============================================================ LANDING PAGE
function LandingPage({ onOpenChart }: { onOpenChart: () => void }) {
  return (
    <div className="min-h-screen bg-[#000000] text-white">
      {/* ====== NAV ====== */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0d0a00]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vaan.One" className="h-8 w-8 rounded-md object-contain" />
            <div>
              <h1 className="text-sm font-bold leading-tight">Vaan.One</h1>
              <p className="text-[9px] leading-tight text-white/40">Vaan Pivot</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="#levels" className="hidden text-xs text-white/60 hover:text-white sm:block">Levels</a>
            <a href="#quant" className="hidden text-xs text-white/60 hover:text-white sm:block">Quant</a>
            <a href="#faq" className="hidden text-xs text-white/60 hover:text-white sm:block">FAQ</a>
            <Button
              onClick={onOpenChart}
              size="sm"
              className="bg-red-600/15 font-mono text-xs text-red-400 hover:bg-red-600/25"
            >
              Open Chart →
            </Button>
          </div>
        </div>
      </nav>

      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden px-4 py-20 text-center">
        {/* Animated background: drifting grid + floating glow orbs */}
        <div className="pointer-events-none absolute inset-0">
          {/* Drifting grid */}
          <div
            className="animate-grid-drift absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
          {/* Glow orb 1 — gold */}
          <div className="animate-float-slow absolute -left-20 top-10 h-72 w-72 rounded-full bg-amber-500/8 blur-[80px]" />
          {/* Glow orb 2 — red */}
          <div className="animate-float-medium absolute -right-20 top-40 h-96 w-96 rounded-full bg-red-600/5 blur-[100px]" />
          {/* Glow orb 3 — gold pulse */}
          <div className="animate-pulse-glow absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-amber-400/5 blur-[90px]" />
        </div>

        <div className="relative mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            <span className="text-[10px] uppercase tracking-wider text-amber-400">Live Levels Updated Daily</span>
          </div>
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-red-500 via-amber-400 to-amber-600 bg-clip-text text-transparent">Vaan Pivot</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-amber-400 sm:text-xl">
            Know Your Levels. Trade with Confidence.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/60 sm:text-base">
            Vaan.One Pivot Levels are calculated using a customized pivot calculation method, designed to
            identify potential intraday support and resistance zones.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              onClick={onOpenChart}
              className="bg-red-600 px-8 py-3 text-sm font-semibold text-white hover:bg-red-700"
            >
              Launch Chart →
            </Button>
          </div>
        </div>

        {/* Sample equity curve card */}
        <div className="relative mx-auto mt-16 max-w-2xl">
          <EquityCurveCard />
        </div>
      </section>

      {/* ====== Vaan.One LEVELS ====== */}
      <section id="levels" className="border-t border-white/5 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <span className="text-[10px] uppercase tracking-widest text-amber-400">01 — Chart</span>
            <h3 className="mt-2 text-2xl font-bold sm:text-3xl">Vaan.One Levels on Chart</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-white/60">
              Get daily Pivot Points and Support &amp; Resistance levels for your favourite trading
              instruments.
            </p>
          </div>

          {/* Key facts */}
          <div className="mb-10 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Daily Updates"
              desc="Vaan.One Pivot levels are manually updated every morning at 5:30 AM IST."
            />
            <FeatureCard
              title="Claimed Accuracy"
              desc="Up to 80%"
            />
            <FeatureCard
              title="Currently FREE!"
              desc="Access all available levels at no cost for now."
            />
          </div>

          {/* Available symbols */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h4 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-amber-400">
              Available Trading Symbols
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { sym: "XAUUSD", name: "Gold" },
                { sym: "EURUSD", name: "Euro / US Dollar" },
                { sym: "GBPUSD", name: "British Pound / US Dollar" },
                { sym: "USDCHF", name: "US Dollar / Swiss Franc" },
              ].map((s) => (
                <div
                  key={s.sym}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.01] px-4 py-2.5"
                >
                  <span className="font-mono text-sm font-bold text-amber-400">{s.sym}</span>
                  <span className="text-xs text-white/60">{s.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mb-8 rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-5">
            <p className="text-xs leading-relaxed text-white/50">
              <span className="font-semibold text-amber-400">Disclaimer:</span>{" "}
              Vaan.One Levels are provided for educational and informational purposes only. These levels
              are manually calculated and updated daily. Accuracy is not guaranteed. They are not
              investment advice or trading recommendations. Always do your own research and manage your
              risk.
            </p>
          </div>

          <div className="text-center">
            <Button
              onClick={onOpenChart}
              className="bg-red-600 px-8 py-3 text-sm font-semibold text-white hover:bg-red-700"
            >
              View Live Chart →
            </Button>
          </div>
        </div>
      </section>

      {/* ====== QUANT DEVELOPER ====== */}
      <section id="quant" className="border-t border-white/5 bg-[#0d0a00] px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <span className="text-[10px] uppercase tracking-widest text-amber-400">02 — Development</span>
            <h3 className="mt-2 text-2xl font-bold sm:text-3xl">Quant Developer</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-white/60">
              MT5/MT4 and Amibroker Indicators &amp; EA — custom algorithmic trading systems built to
              your specification.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="shimmer-border rounded-xl border border-amber-500/15 bg-white/[0.02] p-6 transition-colors hover:border-amber-500/30">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 font-mono text-xs font-bold text-amber-400">M5</span>
                <h4 className="font-mono text-lg font-bold text-amber-400">MetaTrader 5 / MT4</h4>
              </div>
              <ul className="space-y-2 text-sm text-white/60">
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Expert Advisors (EAs) for automated trading</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Custom indicators for pivot-level detection</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Strategy backtesting &amp; optimization</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Multi-symbol and multi-timeframe systems</li>
              </ul>
            </div>
            <div className="shimmer-border rounded-xl border border-red-500/15 bg-white/[0.02] p-6 transition-colors hover:border-red-500/30">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 font-mono text-xs font-bold text-red-400">AB</span>
                <h4 className="font-mono text-lg font-bold text-red-400">Amibroker (AFL)</h4>
              </div>
              <ul className="space-y-2 text-sm text-white/60">
                <li className="flex gap-2"><span className="text-red-400">▸</span> AFL formulas for scanning &amp; screening</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Custom chart templates with pivot overlays</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Backtesting with historical data</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Automated exploration &amp; alerts</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 text-center">
            <a
              href="mailto:valan@outlook.com"
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-600/10 px-6 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-600/20"
            >
              Get a Quote →
            </a>
          </div>
        </div>
      </section>

      {/* ====== CTA ====== */}
      <section className="border-t border-white/5 px-4 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <h3 className="text-2xl font-bold sm:text-3xl">Ready to trade with precision?</h3>
          <p className="mt-3 text-sm text-white/60">
            Launch the live chart with today's pivot levels loaded automatically.
          </p>
          <Button
            onClick={onOpenChart}
            className="mt-6 bg-red-600 px-8 py-3 text-sm font-semibold text-white hover:bg-red-700"
          >
            Launch Vaan.One Chart →
          </Button>
        </div>
      </section>

      {/* ====== FAQ ====== */}
      <section id="faq" className="border-t border-white/5 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <span className="text-[10px] uppercase tracking-widest text-amber-400">FAQ</span>
            <h3 className="mt-2 text-2xl font-bold sm:text-3xl">Frequently Asked Questions</h3>
          </div>
          <div className="space-y-3">
            <FaqItem
              q="What are Vaan Pivot Levels?"
              a="Vaan Pivot Levels are daily support and resistance price levels calculated using a customized pivot methodology. They identify potential intraday reversal zones for trading instruments like XAUUSD, EURUSD, GBPUSD, and USDCHF."
            />
            <FaqItem
              q="When are the levels updated?"
              a="Levels are manually updated every morning at 5:30 AM IST (Indian Standard Time), before the major trading sessions open."
            />
            <FaqItem
              q="How accurate are the levels?"
              a="We claim up to 80% accuracy. However, accuracy is not guaranteed — these levels are for educational and informational purposes only and should not be considered investment advice."
            />
            <FaqItem
              q="Is there a cost to use Vaan Pivot?"
              a="Currently FREE! You can access all available levels at no cost for now."
            />
            <FaqItem
              q="Which trading symbols are available?"
              a="XAUUSD (Gold), EURUSD (Euro / US Dollar), GBPUSD (British Pound / US Dollar), and USDCHF (US Dollar / Swiss Franc)."
            />
            <FaqItem
              q="How do I view the live chart?"
              a="Click the 'Launch Chart' button on this page. The chart auto-loads the latest pivot levels from our data source — no login or upload required."
            />
            <FaqItem
              q="Are these levels trading recommendations?"
              a="No. Vaan Pivot Levels are provided for educational and informational purposes only. They are not investment advice or trading recommendations. Always do your own research and manage your risk."
            />
            <FaqItem
              q="How can I contact you?"
              a="Email us at valan@outlook.com for any questions, feedback, or collaboration inquiries."
            />
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="border-t border-white/10 px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vaan.One" className="h-6 w-6 rounded-md object-contain" />
            <span className="text-xs font-mono text-white/40">Vaan.One</span>
          </div>
          <a
            href="mailto:valan@outlook.com"
            className="text-xs text-amber-400 transition-colors hover:text-amber-300"
          >
            valan@outlook.com
          </a>
          <p className="text-[10px] text-white/30">
            Daily Vaan Pivot Levels are updated manually every morning for educational and
            informational purposes only.
          </p>
          <p className="text-[10px] font-medium text-white/40">Designed By JJ</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="shimmer-border animate-fade-in-up rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-amber-500/40 hover:bg-amber-500/[0.04] hover:shadow-lg hover:shadow-amber-500/5">
      <h4 className="mb-2 text-sm font-semibold text-white">{title}</h4>
      <p className="text-xs leading-relaxed text-white/50">{desc}</p>
    </div>
  );
}

/** Sample equity curve card — mimics a backtest performance chart */
function EquityCurveCard() {
  // Generate an upward-trending equity curve path (SVG points)
  const points = [
    80, 75, 78, 70, 72, 65, 68, 60, 58, 62, 55, 50, 48, 52, 45, 42, 38, 40, 35, 30, 25, 20,
  ];
  const w = 400;
  const h = 160;
  const stepX = w / (points.length - 1);
  const maxVal = 90;
  const pathD = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - (p / maxVal) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div className="shimmer-border overflow-hidden rounded-xl border border-amber-500/20 bg-[#100c00]/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Vaan.One" className="h-5 w-5 rounded object-contain" />
          <span className="font-mono text-xs font-semibold text-white/80">
            Master Equity Curve · XAUUSD
          </span>
        </div>
        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
          Simulated
        </span>
      </div>
      {/* Equity curve SVG */}
      <div className="relative p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          {/* Gradient fill under curve */}
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#equityGrad)" />
          {/* Curve line */}
          <path
            d={pathD}
            fill="none"
            stroke="#d4af37"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-draw-line"
          />
        </svg>
      </div>
      {/* Footer stats */}
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
        <div className="flex gap-4">
          <div>
            <span className="text-[9px] uppercase text-white/30">Net Profit</span>
            <p className="font-mono text-xs font-bold text-amber-400">+$24,580</p>
          </div>
          <div>
            <span className="text-[9px] uppercase text-white/30">Win Rate</span>
            <p className="font-mono text-xs font-bold text-white/80">72%</p>
          </div>
        </div>
        <div>
          <span className="text-[9px] uppercase text-white/30">Max DD</span>
          <p className="font-mono text-xs font-bold text-red-400">-8.3%</p>
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-amber-500/20">
      <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-white/80 [&::-webkit-details-marker]:hidden">
        {q}
        <span className="ml-2 text-amber-400 transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 text-xs leading-relaxed text-white/50">{a}</p>
    </details>
  );
}
