"use client";

import type { Candle } from "@/lib/excel-parser";

interface XauusdChartCardProps {
  candles: Candle[];
}

/**
 * XAUUSD price chart card — shows a gold line chart using the
 * actual close prices from the CSV file (from Google Drive).
 * Same visual style as the equity curve card but with real data.
 */
export function XauusdChartCard({ candles }: XauusdChartCardProps) {
  if (candles.length === 0) return null;

  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  const firstPrice = closes[0];
  const changePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isPositive = changePct >= 0;

  // Build SVG line chart from close prices.
  const w = 400;
  const h = 140;
  const minVal = Math.min(...closes);
  const maxVal = Math.max(...closes);
  const range = maxVal - minVal || 1;
  const stepX = w / (closes.length - 1);

  const pathD = closes
    .map((p, i) => {
      const x = i * stepX;
      const y = h - ((p - minVal) / range) * h * 0.85 - h * 0.075;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  const lineColor = "#d4af37"; // gold

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
        <span className="font-mono text-xs font-bold text-amber-400">
          {lastPrice >= 1000 ? lastPrice.toFixed(2) : lastPrice.toFixed(5)}
        </span>
      </div>
      {/* Price line chart SVG */}
      <div className="relative p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          {/* Gradient fill under line */}
          <defs>
            <linearGradient id="xauGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#xauGrad)" />
          {/* Line — draws upward from left to right */}
          <path
            d={pathD}
            fill="none"
            stroke={lineColor}
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
            <span className="text-[9px] uppercase text-white/30">Last Price</span>
            <p className={`font-mono text-xs font-bold ${isPositive ? "text-amber-400" : "text-red-400"}`}>
              {lastPrice >= 1000 ? lastPrice.toFixed(2) : lastPrice.toFixed(5)}
            </p>
          </div>
          <div>
            <span className="text-[9px] uppercase text-white/30">Change</span>
            <p className={`font-mono text-xs font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? "+" : ""}{changePct.toFixed(2)}%
            </p>
          </div>
        </div>
        <div>
          <span className="text-[9px] uppercase text-white/30">Candles</span>
          <p className="font-mono text-xs font-bold text-white/60">{candles.length}</p>
        </div>
      </div>
    </div>
  );
}
