"use client";

import { useMemo, useState, useCallback } from "react";
import { CandlestickChart, Github, Info, PanelRight, Layers, FolderOpen, FileText } from "lucide-react";
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
import { LevelsPanel } from "@/components/levels-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { detectSupportResistance, getTop6Levels } from "@/lib/support-resistance";
import { detectTimeframe, type TimeframeInfo } from "@/lib/timeframe";
import type { Candle, ParseResult } from "@/lib/excel-parser";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

// Fixed S/R detection settings (hidden from UI per "hide all other data").
const SR_SENSITIVITY_BARS = 5;     // pivot window: 5 bars left + 5 right
const SR_TOLERANCE_PCT = 0.15;     // cluster tolerance
const SR_MIN_TOUCHES = 2;

interface LoadedFile {
  result: ParseResult;
  fileName: string;
  /** Currently selected symbol within this file. */
  selectedSymbol: string;
}

export default function Home() {
  // All loaded files, keyed by file name. Each upload/folder-pick adds to this
  // map so the user can switch between loaded files via the dropdown.
  const [files, setFiles] = useState<Map<string, LoadedFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
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

  // Resolve the currently active file + its candles (filtered by selected symbol).
  const currentFile = files.get(selectedFile);
  const currentResult = currentFile?.result;
  const symbols = currentResult?.symbols ?? [];
  const selectedSymbol = currentFile?.selectedSymbol ?? "";

  const candles = useMemo(() => {
    if (!currentResult) return [];
    if (symbols.length <= 1) return currentResult.candles;
    return currentResult.candles.filter(
      (c) => !c.symbol || c.symbol === selectedSymbol,
    );
  }, [currentResult, symbols, selectedSymbol]);

  const timeframe = useMemo(() => detectTimeframe(candles), [candles]);

  // Detect all S/R levels, then keep only the top-6 (3 nearest R + 3 nearest S).
  const top6Lines = useMemo(() => {
    if (candles.length < 10) return [];
    const lastClose = candles[candles.length - 1].close;
    const allLevels = detectSupportResistance(candles, {
      leftBars: SR_SENSITIVITY_BARS,
      rightBars: SR_SENSITIVITY_BARS,
      tolerancePct: SR_TOLERANCE_PCT,
      minTouches: SR_MIN_TOUCHES,
      maxLevels: 20,
    });
    return getTop6Levels(allLevels, lastClose);
  }, [candles]);

  const selectSymbol = useCallback(
    (symbol: string) => {
      if (!selectedFile) return;
      setFiles((prev) => {
        const next = new Map(prev);
        const f = next.get(selectedFile);
        if (f) next.set(selectedFile, { ...f, selectedSymbol: symbol });
        return next;
      });
    },
    [selectedFile],
  );

  // Derived display values.
  const firstTime = candles.length > 0 ? candles[0].time : 0;
  const lastTime = candles.length > 0 ? candles[candles.length - 1].time : 0;
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const firstClose = candles.length > 0 ? candles[0].close : 0;
  const totalChangePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const symbolLabel = selectedSymbol || currentResult?.symbol || "";
  const fileNames = Array.from(files.keys());

  return (
    <div className="flex h-screen flex-col bg-[#0a0b0f] text-white">
      {/* ============================================================= HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0c0d12] px-4 py-2.5">
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

          {/* File dropdown — shows all loaded CSV/Excel files */}
          {fileNames.length > 0 && (
            <div className="ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
              {fileNames.length > 1 ? (
                <Select value={selectedFile} onValueChange={setSelectedFile}>
                  <SelectTrigger className="h-7 w-auto max-w-[180px] gap-1.5 border-white/15 bg-white/5 px-2 font-mono text-xs text-white hover:bg-white/10">
                    <FileText className="h-3.5 w-3.5 text-emerald-400" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border-white/15 bg-[#15161d] text-white">
                    {fileNames.map((name) => (
                      <SelectItem
                        key={name}
                        value={name}
                        className="font-mono text-xs focus:bg-white/10"
                      >
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span
                  className="max-w-[180px] truncate font-mono text-xs text-white/70"
                  title={selectedFile}
                >
                  {selectedFile}
                </span>
              )}

              {/* Symbol dropdown — only when the selected file has multiple symbols */}
              {symbols.length > 1 && (
                <Select value={selectedSymbol} onValueChange={selectSymbol}>
                  <SelectTrigger className="h-7 w-auto gap-1.5 border-white/15 bg-white/5 px-2 font-mono text-sm font-bold tracking-wide text-white hover:bg-white/10">
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border-white/15 bg-[#15161d] text-white">
                    {symbols.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono focus:bg-white/10">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Last close + change % */}
              {candles.length > 0 && (
                <>
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
                </>
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
          <Stat label="Levels" value={`${top6Lines.length}/6`} />
          {fileNames.length > 1 && (
            <Stat label="Files" value={String(fileNames.length)} />
          )}
          <div className="ml-auto hidden items-center gap-1 text-white/40 md:flex">
            <Info className="h-3 w-3" />
            <span>Hover the chart for OHLC · drag the panel divider to resize</span>
          </div>
          {/* Mobile: open levels panel */}
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
      <main className="flex-1 overflow-hidden">
        {candles.length === 0 ? (
          <EmptyState onLoaded={handleLoaded} fileCount={fileNames.length} />
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
  fileCount,
}: {
  onLoaded: (r: ParseResult, fileName: string) => void;
  fileCount: number;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <div className="mx-auto mb-4 inline-flex rounded-xl bg-emerald-500/15 p-3">
          <CandlestickChart className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-semibold">CandleScope</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          Drop your MetaTrader 5 candlestick exports (Excel/CSV) and get a TradingView-style chart
          with automatically-detected support &amp; resistance levels.
        </p>
      </div>

      <div className="w-full max-w-xl">
        <FileUploader onLoaded={onLoaded} />
      </div>

      {fileCount > 0 && (
        <p className="text-xs text-emerald-400">
          {fileCount} file{fileCount > 1 ? "s" : ""} loaded — switch between them via the dropdown
          in the header.
        </p>
      )}

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
          <li className="flex gap-2">
            <span className="text-emerald-400">●</span>
            <span>
              <span className="text-white/80">Folder upload</span> — pick a folder and all CSV/Excel
              files inside are loaded at once
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
