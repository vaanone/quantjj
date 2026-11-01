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
import { AlertButton } from "@/components/alert-button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { userLevelsToLines } from "@/lib/support-resistance";
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
  const [chartLayout, setChartLayout] = useState<1 | 2 | 3 | 4>(1);
  // Per-chart symbol selections (for multi-chart layouts).
  // Index 0 = first chart (uses the main selectedFile), 1-3 = additional charts.
  const [multiSymbols, setMultiSymbols] = useState<Record<number, string>>({});
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

  // S/R lines: STRICTLY from CSV columns H–O (user-defined levels).
  // No auto-detection fallback — only the user's CSV data is used.
  // If the CSV has no S/R levels in columns H–O, no lines are drawn.
  const top6Lines = (() => {
    if (candles.length < 10) return [];
    const lastClose = candles[candles.length - 1].close;
    const result = files.get(selectedFile)?.result;
    if (result?.userLevels && result.userLevels.length > 0) {
      return userLevelsToLines(result.userLevels, lastClose);
    }
    return [];
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

  // Price alerts — monitors current price and fires notifications.
  const { alerts, addAlert, removeAlert, clearAll } = usePriceAlerts(symbolLabel, lastClose);

  // No live price streaming — chart uses CSV data only.

  // For the symbol dropdown value: the currently active symbol.
  const activeSymbolValue = selectedSymbol || currentResult?.symbol || "";

  // Helper: get candles + lines for a specific chart slot.
  // Slot 0 = main chart (uses selectedFile/multiSymbols[0]).
  // Slots 1-3 = additional charts with their own symbol selection.
  const getChartSlotData = (slot: number) => {
    if (slot === 0) {
      return { candles, lines: top6Lines, symbol: symbolLabel, lastClose };
    }

    // For multi-chart slots, find the symbol and its file.
    const slotSymbol = multiSymbols[slot];
    if (!slotSymbol) return { candles: [], lines: [], symbol: "", lastClose: 0 };

    // Find which file contains this symbol.
    let slotResult: ParseResult | null = null;
    let slotFileName = "";
    for (const [fName, loaded] of files) {
      if (loaded.result.symbols.includes(slotSymbol)) {
        slotResult = loaded.result;
        slotFileName = fName;
        break;
      }
    }
    if (!slotResult) return { candles: [], lines: [], symbol: slotSymbol, lastClose: 0 };

    const slotCandles = (() => {
      const syms = slotResult!.symbols;
      const filtered =
        syms.length <= 1
          ? slotResult!.candles
          : slotResult!.candles.filter(
              (c) => !c.symbol || c.symbol === slotSymbol,
            );
      if (filtered.length > MAX_DISPLAY_CANDLES) {
        return filtered.slice(filtered.length - MAX_DISPLAY_CANDLES);
      }
      return filtered;
    })();

    const slotClose = slotCandles.length > 0 ? slotCandles[slotCandles.length - 1].close : 0;
    const slotLines =
      slotResult.userLevels && slotResult.userLevels.length > 0
        ? userLevelsToLines(slotResult.userLevels, slotClose)
        : [];

    return { candles: slotCandles, lines: slotLines, symbol: slotSymbol, lastClose: slotClose, fileName: slotFileName };
  };

  // Get live price for a specific slot.
  const getSlotLivePrice = (slot: number) => {
    const data = getChartSlotData(slot);
    return data.symbol;
  };

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
          {/* Chart layout dropdown — 1/2/3/4 chart views */}
          {candles.length > 0 && (
            <Select
              value={String(chartLayout)}
              onValueChange={(v) => {
                const n = Number(v) as 1 | 2 | 3 | 4;
                setChartLayout(n);
                if (n > 1) {
                  setMultiSymbols((prev) => {
                    const next = { ...prev };
                    const syms = Array.from(files.values()).flatMap((f) => f.result.symbols);
                    for (let i = 1; i < n; i++) {
                      if (!next[i] && syms[i]) next[i] = syms[i];
                    }
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger className="h-7 w-auto shrink-0 gap-1 border-white/15 bg-white/5 px-1.5 text-white hover:bg-white/10 sm:h-8 sm:px-2">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/60">
                  {chartLayout === 1 && <rect x="1" y="1" width="10" height="10" rx="1" />}
                  {chartLayout === 2 && (<><rect x="1" y="1" width="10" height="4.5" rx="1" /><rect x="1" y="6.5" width="10" height="4.5" rx="1" /></>)}
                  {chartLayout === 3 && (<><rect x="1" y="1" width="10" height="2.8" rx="1" /><rect x="1" y="4.6" width="10" height="2.8" rx="1" /><rect x="1" y="8.2" width="10" height="2.8" rx="1" /></>)}
                  {chartLayout === 4 && (<><rect x="1" y="1" width="10" height="2" rx="1" /><rect x="1" y="3.7" width="10" height="2" rx="1" /><rect x="1" y="6.4" width="10" height="2" rx="1" /><rect x="1" y="9.1" width="10" height="2" rx="1" /></>)}
                </svg>
              </SelectTrigger>
              <SelectContent className="border-white/15 bg-[#15161d] text-white">
                {/* 1 chart */}
                <SelectItem value="1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="10" height="10" rx="1" />
                  </svg>
                </SelectItem>
                {/* 2 charts — vertical stack */}
                <SelectItem value="2">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="10" height="4.5" rx="1" />
                    <rect x="1" y="6.5" width="10" height="4.5" rx="1" />
                  </svg>
                </SelectItem>
                {/* 3 charts — vertical stack */}
                <SelectItem value="3">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="10" height="2.8" rx="1" />
                    <rect x="1" y="4.6" width="10" height="2.8" rx="1" />
                    <rect x="1" y="8.2" width="10" height="2.8" rx="1" />
                  </svg>
                </SelectItem>
                {/* 4 charts — vertical stack */}
                <SelectItem value="4">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="10" height="2" rx="1" />
                    <rect x="1" y="3.7" width="10" height="2" rx="1" />
                    <rect x="1" y="6.4" width="10" height="2" rx="1" />
                    <rect x="1" y="9.1" width="10" height="2" rx="1" />
                  </svg>
                </SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Symbol dropdown — only shown in single-chart mode */}
          {activeSymbolValue && chartLayout === 1 && (
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
                {lastClose >= 1000
                  ? lastClose.toFixed(2)
                  : lastClose.toFixed(5)}
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

          {/* Price alert button — set alerts like TradingView */}
          {candles.length > 0 && (
            <AlertButton
              symbol={symbolLabel}
              currentPrice={lastClose}
              alerts={alerts}
              onAddAlert={addAlert}
              onRemoveAlert={removeAlert}
              onClearAll={clearAll}
            />
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
        ) : chartLayout === 1 ? (
          isLg ? (
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={75} minSize={50}>
                <ChartArea
                  candles={candles}
                  lines={top6Lines}
                  symbol={symbolLabel}
                  timeframe={timeframe}
                  alertPrices={alerts
                    .filter((a) => a.symbol === symbolLabel)
                    .map((a) => ({ price: a.price, triggered: a.triggered }))}
                  livePrice={lastClose}
                  
                  lastUpdate={lastUpdate}
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
              alertPrices={alerts
                .filter((a) => a.symbol === symbolLabel)
                .map((a) => ({ price: a.price, triggered: a.triggered }))}
              livePrice={lastClose}
              
              lastUpdate={lastUpdate}
            />
          )
        ) : (
          /* Multi-chart grid layout */
          <MultiChartGrid
            layout={chartLayout}
            allSymbols={allSymbols.map((s) => s.symbol)}
            multiSymbols={multiSymbols}
            onSymbolChange={(slot, sym) => {
              if (slot === 0) {
                // Slot 0 uses the main symbol — find the file containing
                // this symbol and switch to it.
                for (const [fName, loaded] of files) {
                  if (loaded.result.symbols.includes(sym)) {
                    setFiles((prev) => {
                      const next = new Map(prev);
                      next.set(fName, { ...loaded, selectedSymbol: sym });
                      return next;
                    });
                    setSelectedFile(fName);
                    break;
                  }
                }
              } else {
                setMultiSymbols((prev) => ({ ...prev, [slot]: sym }));
              }
            }}
            getSlotData={getChartSlotData}
            timeframe={timeframe}
            lastUpdate={lastUpdate}
            slotSymbols={[symbolLabel, multiSymbols[1], multiSymbols[2], multiSymbols[3]]}
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
  alertPrices,
  livePrice,
  lastUpdate,
}: {
  candles: Candle[];
  lines: ReturnType<typeof getTop6Levels>;
  symbol: string;
  timeframe: TimeframeInfo | null;
  alertPrices?: { price: number; triggered: boolean }[];
  livePrice?: number;
  lastUpdate?: string | null;
}) {
  return (
    <div className="relative h-full w-full bg-[#100c00]">
      <TradingChart
        candles={candles}
        lines={lines}
        symbol={symbol}
        timeframe={timeframe}
        visibleCount={VISIBLE_CANDLES}
        alertPrices={alertPrices}
        livePrice={livePrice}
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
      {/* Pivot line update timestamp — bottom-left of chart */}
      {lastUpdate && (
        <div className="pointer-events-none absolute bottom-8 left-3 select-none">
          <span className="font-mono text-[10px] text-white/40">
            Vaan.One Pivot line Updated at {formatLastUpdate(lastUpdate)}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================ MULTI-CHART GRID
function MultiChartGrid({
  layout,
  allSymbols,
  multiSymbols,
  onSymbolChange,
  getSlotData,
  timeframe,
  lastUpdate,
  slotSymbols,
}: {
  layout: 2 | 3 | 4;
  allSymbols: string[];
  multiSymbols: Record<number, string>;
  onSymbolChange: (slot: number, sym: string) => void;
  getSlotData: (slot: number) => {
    candles: Candle[];
    lines: ReturnType<typeof userLevelsToLines>;
    symbol: string;
    lastClose: number;
  };
  timeframe: TimeframeInfo | null;
  lastUpdate?: string | null;
  slotSymbols: string[];
}) {
  // For 4 charts: stacked vertically, each gets 1/4 height.
  if (layout === 4) {
    const slots4 = Array.from({ length: 4 }, (_, i) => {
      const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
      return { slot: i, symbol: sym };
    });
    return (
      <div className="flex h-full flex-col gap-0.5">
        <div className="flex h-1/4">
          <ChartSlot slot={slots4[0].slot} symbol={slots4[0].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex h-1/4">
          <ChartSlot slot={slots4[1].slot} symbol={slots4[1].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex h-1/4">
          <ChartSlot slot={slots4[2].slot} symbol={slots4[2].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex h-1/4">
          <ChartSlot slot={slots4[3].slot} symbol={slots4[3].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      </div>
    );
  }

  // For 3 charts: stacked vertically, each gets 1/3 height.
  if (layout === 3) {
    const slots3 = Array.from({ length: 3 }, (_, i) => {
      const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
      return { slot: i, symbol: sym };
    });
    return (
      <div className="flex h-full flex-col gap-0.5">
        <div className="flex h-1/3">
          <ChartSlot slot={slots3[0].slot} symbol={slots3[0].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex h-1/3">
          <ChartSlot slot={slots3[1].slot} symbol={slots3[1].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex h-1/3">
          <ChartSlot slot={slots3[2].slot} symbol={slots3[2].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      </div>
    );
  }

  // Layout 2 — vertical stack, each gets 1/2 height.
  const slots = Array.from({ length: layout }, (_, i) => {
    const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
    return { slot: i, symbol: sym };
  });

  return (
    <div className="flex h-full flex-col gap-0.5">
      {slots.map(({ slot, symbol }) => (
        <div key={slot} className="h-1/2">
          <ChartSlot slot={slot} symbol={symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      ))}
    </div>
  );
}

// Individual chart slot — used in multi-chart layouts.
function ChartSlot({
  slot,
  symbol,
  getSlotData,
  allSymbols,
  onSymbolChange,
  timeframe,
  lastUpdate,
}: {
  slot: number;
  symbol: string;
  getSlotData: (slot: number) => {
    candles: Candle[];
    lines: ReturnType<typeof userLevelsToLines>;
    symbol: string;
    lastClose: number;
  };
  allSymbols: string[];
  onSymbolChange: (slot: number, sym: string) => void;
  timeframe: TimeframeInfo | null;
  lastUpdate?: string | null;
}) {
  const data = getSlotData(slot);
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border border-white/5 bg-[#100c00]">
      {/* Per-chart header: symbol dropdown + price */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0d0a00] px-2 py-1">
        <Select
          value={symbol}
          onValueChange={(v) => onSymbolChange(slot, v)}
        >
          <SelectTrigger className="h-6 w-auto min-w-[60px] max-w-[100px] gap-1 border-white/10 bg-white/5 px-1.5 font-mono text-[10px] font-bold text-white hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60 border-white/15 bg-[#15161d] text-white">
            {allSymbols.map((s) => (
              <SelectItem key={s} value={s} className="font-mono text-xs focus:bg-white/10">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          {data.lastClose > 0 && (
            <span className="font-mono text-[10px] text-white/50">
              {data.lastClose >= 1000 ? data.lastClose.toFixed(2) : data.lastClose.toFixed(5)}
            </span>
          )}
          {timeframe && (
            <Badge className="h-4 px-1 font-mono text-[8px] font-bold text-amber-400">
              {timeframe.label}
            </Badge>
          )}
        </div>
      </div>
      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        {data.candles.length > 0 ? (
          <ChartArea
            candles={data.candles}
            lines={data.lines}
            symbol={data.symbol}
            timeframe={timeframe}
            lastUpdate={lastUpdate}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-white/30">No data</span>
          </div>
        )}
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

  return `${month} ${day}${ordinal} ${hour}:${minute} ${dayPeriod} (IST)`;
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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Vaan.One" className="h-10 w-10 rounded-md object-contain" />
            <div>
              <h1 className="text-base font-bold leading-tight">Vaan.One</h1>
              <p className="text-[11px] leading-tight text-white/40">Vaan Pivot</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a href="#levels" className="hidden text-sm text-white/60 hover:text-white sm:block">Levels</a>
            <a href="#quant" className="hidden text-sm text-white/60 hover:text-white sm:block">Quant</a>
            <a href="#faq" className="hidden text-sm text-white/60 hover:text-white sm:block">FAQ</a>
            <Button
              onClick={onOpenChart}
              size="sm"
              className="bg-red-600/15 font-mono text-sm text-red-400 hover:bg-red-600/25"
            >
              Open Chart →
            </Button>
          </div>
        </div>
      </nav>

      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden px-6 py-28 text-center">
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

        <div className="relative mx-auto max-w-4xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="text-xs uppercase tracking-wider text-amber-400">Live Levels Updated Daily</span>
          </div>
          <h2 className="text-5xl font-bold tracking-tight sm:text-7xl">
            <span className="bg-gradient-to-r from-red-500 via-amber-400 to-amber-600 bg-clip-text text-transparent">Vaan Pivot</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-xl font-medium text-amber-400 sm:text-2xl">
            Know Your Levels. Trade with Confidence.
          </p>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-white/60 sm:text-lg">
            Vaan.One Pivot Levels are calculated using a customized pivot calculation method, designed to
            identify potential intraday support and resistance zones.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              onClick={onOpenChart}
              className="bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
            >
              Launch Chart →
            </Button>
          </div>
        </div>

        {/* Sample equity curve card */}
        <div className="relative mx-auto mt-20 max-w-3xl">
          <EquityCurveCard />
        </div>
      </section>

      {/* ====== Vaan.One LEVELS ====== */}
      <section id="levels" className="border-t border-white/5 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-amber-400">01 — Chart</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Vaan.One Levels on Chart</h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/60">
              Get daily Pivot Points and Support &amp; Resistance levels for your favourite trading
              instruments.
            </p>
          </div>

          {/* Key facts */}
          <div className="mb-12 grid gap-5 sm:grid-cols-3">
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
          <div className="mb-10 rounded-xl border border-white/10 bg-white/[0.02] p-8">
            <h4 className="mb-6 text-center text-base font-semibold uppercase tracking-wider text-amber-400">
              Available Trading Symbols
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { sym: "XAUUSD", name: "Gold" },
                { sym: "EURUSD", name: "Euro / US Dollar" },
                { sym: "GBPUSD", name: "British Pound / US Dollar" },
                { sym: "USDCHF", name: "US Dollar / Swiss Franc" },
              ].map((s) => (
                <div
                  key={s.sym}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.01] px-5 py-3.5"
                >
                  <span className="font-mono text-base font-bold text-amber-400">{s.sym}</span>
                  <span className="text-sm text-white/60">{s.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mb-10 rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-6">
            <p className="text-sm leading-relaxed text-white/50">
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
              className="bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
            >
              View Live Chart →
            </Button>
          </div>
        </div>
      </section>

      {/* ====== QUANT DEVELOPER ====== */}
      <section id="quant" className="border-t border-white/5 bg-[#0d0a00] px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-amber-400">02 — Development</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Quant Developer</h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/60">
              MT5/MT4 and Amibroker Indicators &amp; EA — custom algorithmic trading systems built to
              your specification.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="shimmer-border rounded-xl border border-amber-500/15 bg-white/[0.02] p-8 transition-colors hover:border-amber-500/30">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 font-mono text-sm font-bold text-amber-400">M5</span>
                <h4 className="font-mono text-lg font-bold text-amber-400">MetaTrader 5 / MT4</h4>
              </div>
              <ul className="space-y-3 text-base text-white/60">
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Expert Advisors (EAs) for automated trading</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Custom indicators for pivot-level detection</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Strategy backtesting &amp; optimization</li>
                <li className="flex gap-2"><span className="text-amber-400">▸</span> Multi-symbol and multi-timeframe systems</li>
              </ul>
            </div>
            <div className="shimmer-border rounded-xl border border-red-500/15 bg-white/[0.02] p-8 transition-colors hover:border-red-500/30">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 font-mono text-sm font-bold text-red-400">AB</span>
                <h4 className="font-mono text-lg font-bold text-red-400">Amibroker (AFL)</h4>
              </div>
              <ul className="space-y-3 text-base text-white/60">
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
      <section className="border-t border-white/5 px-6 py-20 text-center">
        <div className="mx-auto max-w-2xl">
          <h3 className="text-3xl font-bold sm:text-4xl">Ready to trade with precision?</h3>
          <p className="mt-4 text-base text-white/60">
            Launch the live chart with today's pivot levels loaded automatically.
          </p>
          <Button
            onClick={onOpenChart}
            className="mt-8 bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
          >
            Launch Vaan.One Chart →
          </Button>
        </div>
      </section>

      {/* ====== FAQ ====== */}
      <section id="faq" className="border-t border-white/5 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-amber-400">FAQ</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Frequently Asked Questions</h3>
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
    <div className="shimmer-border animate-fade-in-up rounded-xl border border-white/10 bg-white/[0.02] p-7 transition-all hover:border-amber-500/40 hover:bg-amber-500/[0.04] hover:shadow-lg hover:shadow-amber-500/5">
      <h4 className="mb-3 text-lg font-semibold text-white">{title}</h4>
      <p className="text-sm leading-relaxed text-white/50">{desc}</p>
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
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-amber-500/20">
      <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-white/80 [&::-webkit-details-marker]:hidden">
        {q}
        <span className="ml-2 text-lg text-amber-400 transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-4 text-sm leading-relaxed text-white/50">{a}</p>
    </details>
  );
}
