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
/** Only the last N candles are shown on the chart — keeps the view "big zoom"
 *  with each candle wide enough to read. The user can still scroll/zoom
 *  afterwards. */
const MAX_DISPLAY_CANDLES = 100;

interface LoadedFile {
  result: ParseResult;
  fileName: string;
  selectedSymbol: string;
}

export default function Home() {
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
  const firstClose = candles.length > 0 ? candles[0].close : 0;
  const totalChangePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const symbolLabel = selectedSymbol || currentResult?.symbol || "";

  // For the symbol dropdown value: the currently active symbol.
  const activeSymbolValue = selectedSymbol || currentResult?.symbol || "";

  return (
    <div className="flex h-screen flex-col bg-[#0a0b0f] text-white">
      {/* ============================================================= HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0c0d12] px-4 py-2">
        {/* Logo + app name */}
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Vaan One"
            className="h-9 w-9 rounded-md object-contain"
          />
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold leading-tight">VaanPulse</h1>
            <p className="text-[10px] leading-tight text-white/40">
              Daily Support &amp; Resistance
            </p>
          </div>
        </div>

        {/* Single dropdown + upload + TF — all data access in one place */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Unified dropdown: shows every loaded (symbol, file) pair. Picking
              an entry switches both the active file and the active symbol. */}
          {activeSymbolValue && (
            <Select value={dropdownValue} onValueChange={handleDropdownChange}>
              <SelectTrigger className="h-8 w-auto min-w-[110px] max-w-[220px] gap-1.5 border-white/15 bg-white/5 px-2 font-mono text-sm font-bold tracking-wide text-white hover:bg-white/10">
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

          {/* Last close + change % */}
          {candles.length > 0 && (
            <div className="flex items-center gap-1.5 border-l border-white/10 pl-2">
              <span className="font-mono text-xs text-white/50">
                {lastClose >= 1000 ? lastClose.toFixed(2) : lastClose.toFixed(5)}
              </span>
              <Badge
                variant="outline"
                className={`h-5 border-white/15 px-1.5 text-[10px] font-mono ${
                  totalChangePct >= 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {totalChangePct >= 0 ? "+" : ""}
                {totalChangePct.toFixed(2)}%
              </Badge>
            </div>
          )}

          {/* Timeframe badge */}
          {timeframe && (
            <Badge className="h-8 gap-1 border border-emerald-500/30 bg-emerald-500/10 px-2 font-mono text-sm font-bold text-emerald-400">
              {timeframe.label}
            </Badge>
          )}

          {/* Last file update date/time (e.g. "Aug 10th | 5:15 AM IST") */}
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

          {/* Upload buttons: Files + Folder */}
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-white/10 bg-[#0c0d12] px-4 py-1.5 text-[11px] text-white/70">
          {/* Disclaimer — left side, small font */}
          <p className="hidden text-[10px] leading-tight text-white/30 sm:block lg:max-w-md">
            Daily Support &amp; Resistance levels are updated manually every morning for educational
            and informational purposes only
          </p>
          <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 gap-1.5 border-white/15 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 lg:hidden"
              >
                <PanelRight className="h-3.5 w-3.5" />
                Levels
                <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">{top6Lines.length}</Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto border-white/10 bg-[#0c0d12] p-0 lg:hidden">
              <SheetHeader className="border-b border-white/10 px-4 py-3">
                <SheetTitle className="text-sm font-semibold text-white">
                  Support &amp; Resistance Levels
                </SheetTitle>
              </SheetHeader>
              <LevelsPanel
                lines={top6Lines}
                lastClose={lastClose}
                fileName={selectedFile}
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
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0b0f]">
            <div className="flex flex-col items-center gap-6">
              <img src="/logo.png" alt="VaanPulse" className="h-16 w-16 rounded-lg object-contain opacity-80" />
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
                fileName={selectedFile}
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
    <div className="relative h-full w-full bg-[#0e0f14]">
      <TradingChart
        candles={candles}
        lines={lines}
        symbol={symbol}
        timeframe={timeframe}
      />
      <div className="pointer-events-none absolute left-4 top-3 select-none">
        <div className="flex items-baseline gap-2">
          <div className="font-mono text-3xl font-bold text-white/[0.06]">{symbol || "—"}</div>
          {timeframe && (
            <div className="font-mono text-xl font-bold text-emerald-400/15">
              {timeframe.label}
            </div>
          )}
        </div>
        <div className="font-mono text-[10px] tracking-widest text-white/[0.05]">
          VAANPULSE · {candles.length} BARS · LAST {MAX_DISPLAY_CANDLES}
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
        <h2 className="text-2xl font-semibold">VaanPulse</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          Upload MT5 candlestick CSV files to load them into the chart. Support &amp; resistance
          levels are read from columns H–O.
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
      <span className="text-emerald-400">{".".repeat(dotCount)}</span>
    </span>
  );
}
