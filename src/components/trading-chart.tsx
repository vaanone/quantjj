"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
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
}

const COLORS = {
  bg: "#100c00",
  text: "#d1d5db",
  grid: "#1c1e26",
  border: "#262a36",
  up: "#26a69a",
  down: "#ef5350",
  resistance: "#d4af37", // dark gold — solid line
  support: "#ef4444",    // red — solid line
};

export function TradingChart({
  candles,
  lines,
  symbol,
  timeframe,
  visibleCount,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
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
        // Volume overlay removed — chart now uses full vertical extent.
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        // Zoom out by default — reduces the bar width so more candles fit
        // comfortably and the chart feels less cramped.
        barSpacing: 6,
        minBarSpacing: 2,
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

    // Day-separation vertical lines: insert a vertical line marker at the
    // first candle of each new UTC day. This visually separates trading days.
    const dayMarkers = [];
    let lastDay = -1;
    for (const c of candles) {
      const d = new Date(c.time * 1000);
      const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      if (dayKey !== lastDay) {
        dayMarkers.push({
          time: c.time as UTCTimestamp,
          position: "aboveBar" as const,
          color: "#3a3f4b",
          shape: "line" as const,
          lineStyle: LineStyle.Solid,
        });
        lastDay = dayKey;
      }
    }
    if (dayMarkers.length > 0) {
      createSeriesMarkers(candleSeriesRef.current, dayMarkers);
    }

    // Set the visible range to show only the last `visibleCount` candles.
    // The full dataset (up to 200) is loaded so the user can scroll left,
    // but the initial viewport is zoomed to show only the most recent N.
    if (visibleCount && visibleCount < candles.length) {
      const fromIdx = candles.length - visibleCount;
      const fromTime = candles[fromIdx].time as UTCTimestamp;
      const toTime = candles[candles.length - 1].time as UTCTimestamp;
      chartRef.current.timeScale().setVisibleRange({ from: fromTime, to: toTime });
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles, visibleCount]);

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
        axisLabelVisible: true,
        title: srLine.label, // "R I", "S I", "R II", ...
      });
      priceLinesRef.current.push(line);
    });
  }, [lines]);

  void symbol;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
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

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
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
