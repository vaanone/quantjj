"use client";

import { useMemo, useState, useCallback } from "react";
import { CandlestickChart, Github, Info, PanelRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TradingChart } from "@/components/trading-chart";
import { FileUploader } from "@/components/file-uploader";
import { SRPanel } from "@/components/sr-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { detectSupportResistance, type SRLevel } from "@/lib/support-resistance";
import { detectTimeframe, type TimeframeInfo } from "@/lib/timeframe";
import type { Candle } from "@/lib/excel-parser";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export default function Home() {
  // rawCandles holds ALL candles from the file (across all symbols).
  // `candles` (derived below) is the filtered subset for the currently
  // selected symbol.
  const [rawCandles, setRawCandles] = useState<Candle[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [sensitivity, setSensitivity] = useState<number>(50);
  const [tolerancePct, setTolerancePct] = useState<number>(0.15);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // Hydration-safe media query: SSR + first client render use `true` (desktop
  // layout), then `useSyncExternalStore` switches to the actual viewport value
  // after mount. This guarantees the server-rendered HTML matches the first
  // client commit, eliminating React's hydration-mismatch warning.
  const isLg = useMediaQuery("(min-width: 1024px)", true);

  // Filter candles to the selected symbol. When the file has only one symbol
  // (or no ticker column at all), all candles pass through unchanged.
  const candles = useMemo(() => {
    if (symbols.length <= 1) return rawCandles;
    return rawCandles.filter(
      (c) => !c.symbol || c.symbol === selectedSymbol,
    );
  }, [rawCandles, symbols, selectedSymbol]);

  const symbol = selectedSymbol;

  // Detect S/R levels. Recomputes when candles or detection settings change.
  const srLevels: SRLevel[] = useMemo(() => {
    if (candles.length < 10) return [];
    const bars = Math.max(1, Math.round(10 - (sensitivity / 100) * 9));
    return detectSupportResistance(candles, {
      leftBars: bars,
      rightBars: bars,
      tolerancePct,
      minTouches: 2,
      maxLevels: 12,
    });
  }, [candles, sensitivity, tolerancePct]);

  // Detect candle timeframe (M1, M5, H1, D1, ...) from candle intervals.
  const timeframe = useMemo(() => detectTimeframe(candles), [candles]);

  // Track which level indices the user has explicitly HIDDEN (rather than which
  // are visible). This way the default "all visible" is implicit — no reset
  // effect needed when new data arrives — and toggling is a pure set operation.
  // Stale indices (after data swap) are simply ignored when rendering because
  // we iterate srLevels, not the hidden set.
  const [hiddenLevels, setHiddenLevels] = useState<Set<number>>(new Set());

  const visibleLevels = useMemo(() => {
    if (hiddenLevels.size === 0) return new Set(srLevels.map((_, i) => i));
    const visible = new Set<number>();
    for (let i = 0; i < srLevels.length; i++) {
      if (!hiddenLevels.has(i)) visible.add(i);
    }
    return visible;
  }, [srLevels, hiddenLevels]);

  const handleLoaded = useCallback(
    (result: { candles: Candle[]; symbol: string; symbols: string[] }, name: string) => {
      setRawCandles(result.candles);
      setSymbols(result.symbols);
      setSelectedSymbol(result.symbol || result.symbols[0] || "");
      setFileName(name);
      // Reset hidden set so new data shows all levels by default.
      setHiddenLevels(new Set());
    },
    [],
  );

  const toggleLevel = useCallback((idx: number) => {
    setHiddenLevels((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (on: boolean) => {
      setHiddenLevels(on ? new Set() : new Set(srLevels.map((_, i) => i)));
    },
    [srLevels],
  );

  const supportsCount = srLevels.filter((l) => l.type === "support").length;
  const resistancesCount = srLevels.filter((l) => l.type === "resistance").length;
  const firstTime = candles.length > 0 ? candles[0].time : 0;
  const lastTime = candles.length > 0 ? candles[candles.length - 1].time : 0;
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const firstClose = candles.length > 0 ? candles[0].close : 0;
  const totalChangePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  return (
    <div className="flex h-screen flex-col bg-[#0a0b0f] text-white">
      {/* ============================================================= HEADER */}
      <header className="flex items-center justify-between border-b border-white/10 bg-[#0c0d12] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-emerald-500/15 p-1.5">
              <CandlestickChart className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">CandleScope</h1>
              <p className="text-[10px] leading-tight text-white/40">
                MT5 candle chart · auto S/R
              </p>
            </div>
          </div>

          {symbol && (
            <div className="ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
              {/* Symbol: dropdown when the file has multiple tickers, static
                  span otherwise. */}
              {symbols.length > 1 ? (
                <Select
                  value={selectedSymbol}
                  onValueChange={(v) => {
                    setSelectedSymbol(v);
                    setHiddenLevels(new Set());
                  }}
                >
                  <SelectTrigger className="h-7 w-auto gap-1.5 border-white/15 bg-white/5 px-2 font-mono text-sm font-bold tracking-wide text-white hover:bg-white/10">
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border-white/15 bg-[#15161d] text-white">
                    {symbols.map((s) => (
                      <SelectItem
                        key={s}
                        value={s}
                        className="font-mono focus:bg-white/10"
                      >
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-mono text-sm font-bold tracking-wide">{symbol}</span>
              )}
              {candles.length > 0 && (
                <span className="font-mono text-xs text-white/50">
                  {lastClose >= 1000 ? lastClose.toFixed(2) : lastClose.toFixed(5)}
                </span>
              )}
              {candles.length > 0 && (
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
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <FileUploader onLoaded={handleLoaded} compact />

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-white/60 hover:text-white"
                  asChild
                >
                  <a
                    href="https://github.com/tradingview/lightweight-charts"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Github className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">lightweight-charts</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>

      {/* ============================================================ TOOLBAR */}
      {candles.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-white/10 bg-[#0c0d12] px-4 py-1.5 text-[11px] text-white/70">
          {timeframe && (
            <Stat
              label="TF"
              value={<span className="font-bold text-emerald-400">{timeframe.label}</span>}
            />
          )}
          <Stat label="Candles" value={String(candles.length)} />
          <Stat label="Range" value={`${formatDate(firstTime)} → ${formatDate(lastTime)}`} />
          <Stat
            label="S/R"
            value={
              <span>
                <span className="text-red-400">{supportsCount}S</span>
                {" / "}
                <span className="text-emerald-400">{resistancesCount}R</span>
              </span>
            }
          />
          <Stat label="Visible" value={`${visibleLevels.size}/${srLevels.length}`} />
          <Stat
            label="Window"
            value={`${Math.max(1, Math.round(10 - (sensitivity / 100) * 9))} bars`}
          />
          <Stat label="Tol" value={`${tolerancePct.toFixed(2)}%`} />
          <div className="ml-auto hidden items-center gap-1 text-white/40 md:flex">
            <Info className="h-3 w-3" />
            <span>Hover the chart for OHLC · drag the panel divider to resize</span>
          </div>
          {/* Mobile: open S/R panel */}
          <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 gap-1.5 border-white/15 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 lg:hidden"
              >
                <PanelRight className="h-3.5 w-3.5" />
                Levels
                <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">{srLevels.length}</Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto border-white/10 bg-[#0c0d12] p-0 lg:hidden">
              <SheetHeader className="border-b border-white/10 px-4 py-3">
                <SheetTitle className="text-sm font-semibold text-white">
                  Support &amp; Resistance Levels
                </SheetTitle>
              </SheetHeader>
              <SRPanel
                levels={srLevels}
                visible={visibleLevels}
                onToggle={toggleLevel}
                onToggleAll={toggleAll}
                sensitivity={sensitivity}
                tolerancePct={tolerancePct}
                onSensitivityChange={setSensitivity}
                onToleranceChange={setTolerancePct}
                candles={candles}
                fileName={fileName}
              />
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* ============================================================== BODY */}
      <main className="flex-1 overflow-hidden">
        {candles.length === 0 ? (
          <EmptyState onLoaded={handleLoaded} />
        ) : isLg ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={75} minSize={50}>
              <ChartArea
                candles={candles}
                srLevels={srLevels}
                visibleLevels={visibleLevels}
                symbol={symbol}
                timeframe={timeframe}
              />
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-white/10" />
            <ResizablePanel defaultSize={25} minSize={18} maxSize={45}>
              <SRPanel
                levels={srLevels}
                visible={visibleLevels}
                onToggle={toggleLevel}
                onToggleAll={toggleAll}
                sensitivity={sensitivity}
                tolerancePct={tolerancePct}
                onSensitivityChange={setSensitivity}
                onToleranceChange={setTolerancePct}
                candles={candles}
                fileName={fileName}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ChartArea
            candles={candles}
            srLevels={srLevels}
            visibleLevels={visibleLevels}
            symbol={symbol}
            timeframe={timeframe}
          />
        )}
      </main>
    </div>
  );
}

function ChartArea({
  candles,
  srLevels,
  visibleLevels,
  symbol,
  timeframe,
}: {
  candles: Candle[];
  srLevels: SRLevel[];
  visibleLevels: Set<number>;
  symbol: string;
  timeframe: TimeframeInfo | null;
}) {
  return (
    <div className="relative h-full w-full bg-[#0e0f14]">
      <TradingChart
        candles={candles}
        srLevels={srLevels}
        visibleLevels={visibleLevels}
        symbol={symbol}
        timeframe={timeframe}
      />
      {/* Symbol + timeframe watermark (top-left) */}
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
          CANDLESCOPE · {candles.length} BARS · FULL HISTORY
        </div>
      </div>
    </div>
  );
}

// ============================================================ EMPTY STATE
function EmptyState({
  onLoaded,
}: {
  onLoaded: (r: { candles: Candle[]; symbol: string; symbols: string[] }, name: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <div className="mx-auto mb-4 inline-flex rounded-xl bg-emerald-500/15 p-3">
          <CandlestickChart className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-semibold">CandleScope</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          Drop your MetaTrader 5 candlestick export (Excel/CSV) and get a TradingView-style chart
          with automatically-detected support &amp; resistance levels.
        </p>
      </div>

      <div className="w-full max-w-xl">
        <FileUploader onLoaded={onLoaded} />
      </div>

      <div className="w-full max-w-xl rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-white/60">
        <p className="mb-2 font-semibold text-white/80">Supported file formats:</p>
        <ul className="space-y-1.5">
          <li className="flex gap-2">
            <span className="text-emerald-400">●</span>
            <span>
              <span className="text-white/80">MT5 History Center</span> — tab-separated, columns
              like{" "}
              <code className="rounded bg-white/5 px-1 font-mono text-[10px]">
                &lt;DATE&gt; &lt;TIME&gt; &lt;OPEN&gt; &lt;HIGH&gt; &lt;LOW&gt; &lt;CLOSE&gt;
              </code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-400">●</span>
            <span>
              <span className="text-white/80">MT5 Save as CSV</span> — Date,Open,High,Low,Close,Volume
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-400">●</span>
            <span>
              <span className="text-white/80">Excel .xlsx / .xls</span> — same columns with header
              row
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================ HELPERS
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/40">{label}:</span>
      <span className="font-mono text-white/90">{value}</span>
    </div>
  );
}

function formatDate(t: number): string {
  if (!t) return "—";
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}
