"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/excel-parser";
import type { SRLevel } from "@/lib/support-resistance";

interface TradingChartProps {
  candles: Candle[];
  srLevels: SRLevel[];
  visibleLevels: Set<number>; // indices into srLevels that should be drawn
  symbol: string;
}

const COLORS = {
  bg: "#0e0f14",
  text: "#d1d5db",
  grid: "#1c1e26",
  border: "#262a36",
  up: "#26a69a",
  down: "#ef5350",
  resistance: "#f59e0b",
  support: "#10b981",
  volumeUp: "rgba(38, 166, 154, 0.35)",
  volumeDown: "rgba(239, 83, 80, 0.35)",
};

export function TradingChart({ candles, srLevels, visibleLevels, symbol }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Price lines are tied to the candle series; we recreate them when levels change.
  const priceLinesRef = useRef<IPriceLine[]>([]);
  // Tooltip element ref.
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
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
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

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: COLORS.volumeUp,
    });
    // Anchor the volume series to a separate overlay scale at the bottom 20%.
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

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
      const vol = volumeSeriesRef.current
        ? param.seriesData.get(volumeSeriesRef.current)
        : undefined;
      if (!data || typeof data !== "object" || !("open" in data)) {
        tt.style.display = "none";
        return;
      }

      const o = (data as { open: number }).open;
      const h = (data as { high: number }).high;
      const l = (data as { low: number }).low;
      const c = (data as { close: number }).close;
      const v =
        vol && typeof vol === "object" && "value" in vol
          ? (vol as { value: number }).value
          : undefined;

      const change = c - o;
      const changePct = (change / o) * 100;
      const sign = change >= 0 ? "+" : "";
      const color = change >= 0 ? COLORS.up : COLORS.down;

      const dateStr = formatTime(param.time as UTCTimestamp);
      const volStr = v !== undefined ? formatVolume(v) : "—";

      tt.innerHTML = `
        <div style="color:#9ca3af;margin-bottom:2px">${dateStr}</div>
        <div>O <span style="color:${color}">${fmt(o)}</span>  H <span style="color:${color}">${fmt(h)}</span></div>
        <div>L <span style="color:${color}">${fmt(l)}</span>  C <span style="color:${color}">${fmt(c)}</span></div>
        <div>Δ <span style="color:${color}">${sign}${fmt(change)} (${sign}${changePct.toFixed(2)}%)</span></div>
        <div style="color:#9ca3af">Vol ${volStr}</div>
      `;
      tt.style.display = "block";

      // Position tooltip; flip to the left side of the crosshair when near the right edge.
      const containerWidth = containerRef.current!.clientWidth;
      const ttWidth = tt.offsetWidth;
      let left = param.point.x + 14;
      if (left + ttWidth > containerWidth - 8) {
        left = param.point.x - ttWidth - 14;
      }
      const top = Math.max(8, Math.min(param.point.y - 30, containerRef.current!.clientHeight - 90));
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
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // -- Update candle/volume data ---------------------------------------------
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;
    if (candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const volData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume ?? 0,
      color: c.close >= c.open ? COLORS.volumeUp : COLORS.volumeDown,
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volData);

    // Watermark (symbol top-left) via a custom pane price-line label is overkill;
    // we draw the symbol label as a DOM element overlay instead (see page header).
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  // -- Update S/R price lines -----------------------------------------------
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove existing lines.
    for (const line of priceLinesRef.current) {
      candleSeriesRef.current.removePriceLine(line);
    }
    priceLinesRef.current = [];

    // Add new lines.
    srLevels.forEach((level, idx) => {
      if (!visibleLevels.has(idx)) return;
      const line = candleSeriesRef.current!.createPriceLine({
        price: level.price,
        color: level.type === "resistance" ? COLORS.resistance : COLORS.support,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.type === "resistance" ? "R" : "S"}${level.touches} (${level.strength})`,
      });
      priceLinesRef.current.push(line);
    });
  }, [srLevels, visibleLevels]);

  // Expose symbol as a watermark-like overlay via data attribute; the page
  // renders its own header so we just no-op here.
  void symbol;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(2) + "K";
  return v.toFixed(0);
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

// Time typing shim — lightweight-charts accepts unix seconds directly when
// the time scale has timeVisible: true. Re-exported to silence unused import.
export type { Time };
