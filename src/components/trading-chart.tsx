"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/excel-parser";
import type { SRLine } from "@/lib/support-resistance";
import type { TimeframeInfo } from "@/lib/timeframe";

interface TradingChartProps {
  candles: Candle[];
  /** The S/R lines to draw on the chart — typically the top-6 (R I/II/III, S I/II/III). */
  lines: SRLine[];
  symbol: string;
  timeframe?: TimeframeInfo | null;
  /** Number of candles to show in the visible viewport on initial load.
   *  The full `candles` array is loaded; the viewport is just zoomed to the
   *  last N. The user can scroll left to see older candles. */
  visibleCount?: number;
  /** Active price alert levels to draw on the chart (dashed orange lines). */
  alertPrices?: { price: number; triggered: boolean }[];
  /** Live price from Finnhub streaming. When provided, the last candle
   *  updates in real-time as new ticks arrive. */
  livePrice?: number;
  /** Whether the live stream is connected (WebSocket). Shows LIVE badge. */
  isLive?: boolean;
}

const COLORS = {
  bg: "#070D12",
  text: "#9EA6A9",
  grid: "#11171C",
  border: "#1F2933",
  up: "#75D380",
  down: "#ef4444",
  resistance: "#75D380", // neon green — solid line
  support: "#ef4444",    // red — solid line
};

export function TradingChart({
  candles,
  lines,
  symbol,
  timeframe,
  visibleCount,
  alertPrices,
  livePrice,
  isLive,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const alertLinesRef = useRef<IPriceLine[]>([]);
  // Vertical-day-separator line series — one per day boundary, recreated
  // whenever candles change. Stored as an array so we can remove them all
  // on cleanup / refresh.
  const daySepSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // -- Create chart once -----------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#6b7280",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#374151",
        },
        horzLine: {
          color: "#6b7280",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#374151",
        },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        autoScale: true,
        scaleMargins: { top: 0.25, bottom: 0.25 },
        ensureEdgeTickMarksVisible: true,
        // Force the price scale to be wide enough for labels like "RI 1.3400"
        minimumWidth: 5,
      },
      timeScale: {
        borderColor: COLORS.border,
        // Right Offset — empty space (in number of bars) between the last
        // candle and the right edge of the chart. Keep it small (5 bars)
        // so the latest candle is comfortably visible with just enough
        // breathing room for the price line label, but not so much that
        // the chart canvas is wasted on empty space.
        rightOffset: 5,
        timeVisible: true,
        secondsVisible: false,
        // Bar Spacing – horizontal distance between candles (wider = fewer candles visible)
        barSpacing: 12,
        minBarSpacing: 4,
        // Draw a vertical separator line at each day boundary.
        ticksVisible: true,
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          const d = new Date(time * 1000);
          // Show date when at day boundary, time otherwise.
          if (tickMarkType === 0) {
            // Year
            return `${d.getUTCFullYear()}`;
          } else if (tickMarkType === 1) {
            // Month
            return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
          } else if (tickMarkType === 2) {
            // Day
            return `${d.getUTCDate()}`;
          }
          // Time
          return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        },
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      // Current market price line — dashed grey.
      priceLineColor: "#9ca3af",
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1,
      // Price format: detect precision from the actual CSV data.
      // If the data has 5 decimals (1.24566), show 5. If 2 (3455.55), show 2.
      priceFormat: {
        type: "price",
        precision: detectPrecision(candles),
        minMove: detectMinMove(candles),
      },
    });
    candleSeriesRef.current = candleSeries;

    // Tooltip ---------------------------------------------------------------
    const tooltip = document.createElement("div");
    tooltip.style.position = "absolute";
    tooltip.style.zIndex = "10";
    tooltip.style.pointerEvents = "none";
    tooltip.style.background = "rgba(17, 19, 24, 0.92)";
    tooltip.style.border = "1px solid #2a2f3a";
    tooltip.style.borderRadius = "6px";
    tooltip.style.padding = "8px 10px";
    tooltip.style.fontSize = "11px";
    tooltip.style.fontFamily = "var(--font-geist-mono), monospace";
    tooltip.style.color = "#e5e7eb";
    tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
    tooltip.style.display = "none";
    tooltip.style.lineHeight = "1.5";
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;

    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current || !candleSeriesRef.current) return;
      const tt = tooltipRef.current;
      if (
        !param.time ||
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0
      ) {
        tt.style.display = "none";
        return;
      }

      const data = param.seriesData.get(candleSeriesRef.current);
      if (!data || typeof data !== "object" || !("open" in data)) {
        tt.style.display = "none";
        return;
      }

      const o = (data as { open: number }).open;
      const h = (data as { high: number }).high;
      const l = (data as { low: number }).low;
      const c = (data as { close: number }).close;

      const change = c - o;
      const changePct = (change / o) * 100;
      const sign = change >= 0 ? "+" : "";
      const color = change >= 0 ? COLORS.up : COLORS.down;

      const dateStr = formatTime(param.time as UTCTimestamp);

      tt.innerHTML = `
        <div style="color:#9ca3af;margin-bottom:2px">${dateStr}</div>
        <div>O <span style="color:${color}">${fmt(o)}</span>  H <span style="color:${color}">${fmt(h)}</span></div>
        <div>L <span style="color:${color}">${fmt(l)}</span>  C <span style="color:${color}">${fmt(c)}</span></div>
        <div>Δ <span style="color:${color}">${sign}${fmt(change)} (${sign}${changePct.toFixed(2)}%)</span></div>
      `;
      tt.style.display = "block";

      const containerWidth = containerRef.current!.clientWidth;
      const ttWidth = tt.offsetWidth;
      let left = param.point.x + 14;
      if (left + ttWidth > containerWidth - 8) {
        left = param.point.x - ttWidth - 14;
      }
      const top = Math.max(8, Math.min(param.point.y - 30, containerRef.current!.clientHeight - 80));
      tt.style.left = `${left}px`;
      tt.style.top = `${top}px`;
    });

    // Resize observer ------------------------------------------------------
    const resize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);
    resize();

    return () => {
      ro.disconnect();
      tooltip.remove();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLinesRef.current = [];
      daySepSeriesRef.current = [];
    };
  }, []);

  // -- Update candle data: show the FULL loaded history ----------------------
  // All candles from the CSV are rendered; the time scale fits to the entire
  // dataset so the user sees their complete original data on first load. The
  // user can still scroll/zoom freely afterwards.
  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current) return;
    if (candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(candleData);

    // Update the price format to match the new symbol's decimal precision.
    // This fixes the issue where switching from XAUUSD (2 decimals) to
    // EURUSD (5 decimals) didn't update the price bar format.
    const precision = detectPrecision(candles);
    const minMove = Math.pow(10, -precision);
    candleSeriesRef.current.applyOptions({
      priceFormat: { type: "price", precision, minMove },
    });

    // Reset the price scale so it auto-fits to the new symbol's price range.
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });

    // Day-separation vertical lines: draw a true full-height vertical
    // dashed RED line at the first candle of each new UTC day, spanning
    // the entire chart pane from the very top to the very bottom.
    //
    // To make the line span the FULL chart height (including the 25%
    // top/bottom scale margins of the candle price scale), we put each
    // separator LineSeries on a SEPARATE invisible price scale whose
    // own scaleMargins are {0, 0}. That scale autoscales to whatever Y
    // values we give it (here 0..1), and since its margins are zero it
    // maps that 0..1 range to the full pane height — giving a true
    // top-to-bottom vertical line that doesn't affect the candle scale.

    // Remove any previous day-separator series (e.g. on symbol switch).
    if (daySepSeriesRef.current.length > 0 && chartRef.current) {
      for (const s of daySepSeriesRef.current) {
        try { chartRef.current.removeSeries(s); } catch { /* ignore */ }
      }
      daySepSeriesRef.current = [];
    }

    const dayBoundaryTimes: UTCTimestamp[] = [];
    let lastDay = -1;
    for (const c of candles) {
      const d = new Date(c.time * 1000);
      const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      if (dayKey !== lastDay) {
        dayBoundaryTimes.push(c.time as UTCTimestamp);
        lastDay = dayKey;
      }
    }

    if (dayBoundaryTimes.length > 0 && chartRef.current) {
      // Use ~5% of timeframe seconds as the X offset between the two
      // endpoints of the vertical line. Small enough to look vertical,
      // large enough to satisfy lightweight-charts' strict ascending
      // time rule.
      const tfSec = timeframe?.seconds ?? 3600;
      const eps = Math.max(1, Math.floor(tfSec * 0.05));

      // Track whether we've configured the "day-sep" overlay scale yet.
      // In lightweight-charts v5 you can't applyOptions to a custom price
      // scale until at least one series is using it — the scale is created
      // lazily when a series references its ID.
      let sepScaleConfigured = false;

      for (const t of dayBoundaryTimes) {
        const sepSeries = chartRef.current.addSeries(LineSeries, {
          // Neon cyan day-boundary marker — stands out clearly against the
          // dark chart background. Dashed style + vertical orientation
          // distinguishes it from the solid green/red horizontal S/R lines.
          color: "#60D2D5",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          pointMarkersVisible: false,
          // Put this series on the invisible full-height overlay scale
          // so it doesn't affect the candle price scale's autoscale and
          // spans the full chart pane height.
          priceScaleId: "day-sep",
        });

        // Now that the "day-sep" scale exists, configure it ONCE to span
        // the full pane height with no margins and no visible axis labels.
        if (!sepScaleConfigured) {
          chartRef.current.priceScale("day-sep").applyOptions({
            scaleMargins: { top: 0, bottom: 0 },
            visible: false,
          });
          sepScaleConfigured = true;
        }

        // Two points: just before the day boundary at y=0, and at the
        // day boundary at y=1. The "day-sep" scale autoscales to 0..1
        // and (with scaleMargins 0,0) maps that to the full chart height.
        const x0 = (t - eps) as UTCTimestamp;
        const x1 = t as UTCTimestamp;
        sepSeries.setData([
          { time: x0, value: 0 },
          { time: x1, value: 1 },
        ] as any);
        daySepSeriesRef.current.push(sepSeries);
      }
    }

    // First fit ALL content (resets both time + price scales), then zoom
    // the time axis to show only the last N candles.
    chartRef.current.timeScale().fitContent();

    // Set the visible range to show only the last `visibleCount` candles.
    if (visibleCount && visibleCount < candles.length) {
      const fromIdx = candles.length - visibleCount;
      const fromTime = candles[fromIdx].time as UTCTimestamp;
      const toTime = candles[candles.length - 1].time as UTCTimestamp;
      chartRef.current.timeScale().setVisibleRange({ from: fromTime, to: toTime });
    }
  }, [candles, visibleCount, timeframe]);

  // -- Update S/R price lines (only the top-6: R I/II/III + S I/II/III) -----
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    for (const line of priceLinesRef.current) {
      candleSeriesRef.current.removePriceLine(line);
    }
    priceLinesRef.current = [];

    lines.forEach((srLine) => {
      const line = candleSeriesRef.current!.createPriceLine({
        price: srLine.price,
        color: srLine.type === "resistance" ? COLORS.resistance : COLORS.support,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true, // show label on price scale (right side)
        title: srLine.label, // "RI", "SI", "RII", ...
      });
      priceLinesRef.current.push(line);
    });
  }, [lines]);

  // -- Update alert price lines (dashed, orange/gray for triggered) ----------
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    for (const line of alertLinesRef.current) {
      candleSeriesRef.current.removePriceLine(line);
    }
    alertLinesRef.current = [];

    if (alertPrices && alertPrices.length > 0) {
      alertPrices.forEach((alert) => {
        const line = candleSeriesRef.current!.createPriceLine({
          price: alert.price,
          color: alert.triggered ? "#6b7280" : "#00ffff", // aqua for active, gray for triggered
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: alert.triggered
            ? `⚡ ${alert.price}`
            : `🔔 ${alert.price}`,
        });
        alertLinesRef.current.push(line);
      });
    }
  }, [alertPrices]);

  // -- Live price update: update the last candle in real-time --------------
  // When a new live price tick arrives, we either update the current candle
  // (if the tick falls within the same timeframe period) or create a new one.
  const currentCandleRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);

  useEffect(() => {
    if (!candleSeriesRef.current || !livePrice || livePrice <= 0) return;
    if (candles.length === 0) return;

    const tfSeconds = timeframe?.seconds ?? 3600; // default to H1
    const now = Math.floor(Date.now() / 1000);
    // Floor to the current candle period.
    const candleTime = Math.floor(now / tfSeconds) * tfSeconds;

    // Initialize the current candle from the last CSV candle if not set.
    if (!currentCandleRef.current) {
      const last = candles[candles.length - 1];
      currentCandleRef.current = {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      };
    }

    const current = currentCandleRef.current;

    if (candleTime > current.time) {
      // New candle period — push a new candle starting at the live price.
      currentCandleRef.current = {
        time: candleTime as UTCTimestamp,
        open: livePrice,
        high: livePrice,
        low: livePrice,
        close: livePrice,
      };
    } else {
      // Same candle period — update OHLC.
      current.close = livePrice;
      if (livePrice > current.high) current.high = livePrice;
      if (livePrice < current.low) current.low = livePrice;
    }

    // Update the chart — series.update() replaces the bar at the given time
    // if it exists, or adds a new bar if the time is new.
    candleSeriesRef.current.update({
      time: currentCandleRef.current.time as UTCTimestamp,
      open: currentCandleRef.current.open,
      high: currentCandleRef.current.high,
      low: currentCandleRef.current.low,
      close: currentCandleRef.current.close,
    });
  }, [livePrice, candles, timeframe]);

  // Reset the current candle ref when candles change (new file loaded).
  useEffect(() => {
    currentCandleRef.current = null;
  }, [candles]);

  void symbol;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* LIVE badge (top-right) — shows when streaming is active */}
      {isLive && (
        <div className="pointer-events-none absolute right-2 top-12 z-10 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">LIVE</span>
        </div>
      )}
      {/* Timeframe badge (top-right, just under the price scale) */}
      {timeframe && (
        <div className="pointer-events-none absolute right-2 top-2 select-none rounded-md border border-white/10 bg-black/40 px-2 py-1 backdrop-blur-sm">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-bold text-amber-400">
              {timeframe.label}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-white/50">
              timeframe
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

/**
 * Detects the decimal precision from actual candle data.
 * Scans a sample of candles and finds the maximum number of decimal places
 * in their prices. If the data has 5 decimals (1.24566), returns 5.
 * If 2 decimals (3455.55), returns 2.
 */
function detectPrecision(candles: Candle[]): number {
  let maxDecimals = 0;
  const sample = candles.slice(0, Math.min(candles.length, 50));
  for (const c of sample) {
    for (const price of [c.open, c.high, c.low, c.close]) {
      const str = price.toString();
      const dotIdx = str.indexOf(".");
      if (dotIdx >= 0) {
        const decimals = str.length - dotIdx - 1;
        if (decimals > maxDecimals) maxDecimals = decimals;
      }
    }
  }
  // Default to at least 2 if no decimals found.
  return Math.max(maxDecimals, 2);
}

/**
 * Detects the minimum price move from candle data.
 * Returns 10^(-precision) — e.g. 0.00001 for 5 decimals, 0.01 for 2.
 */
function detectMinMove(candles: Candle[]): number {
  const precision = detectPrecision(candles);
  return Math.pow(10, -precision);
}

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  return n.toFixed(5);
}

function formatTime(t: UTCTimestamp): string {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// Re-exported to silence unused import.
export type { Time };
