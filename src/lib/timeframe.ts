// Detects the candle timeframe (interval) from a sorted list of candles.
//
// Strategy:
//   1. Compute the median delta between consecutive candle timestamps.
//      Median (not mean) is robust to weekends/gaps in forex/stock data.
//   2. Snap the median to a canonical MT5-style timeframe label.

import type { Candle } from "./excel-parser";

export interface TimeframeInfo {
  seconds: number; // median candle interval in seconds
  label: string; // human-readable label, e.g. "H1", "M15", "D1"
  description: string; // longer label, e.g. "1 hour"
}

const TIMEFRAME_BUCKETS: Array<{ sec: number; label: string; description: string }> = [
  { sec: 1, label: "S1", description: "1 second" },
  { sec: 2, label: "S2", description: "2 seconds" },
  { sec: 5, label: "S5", description: "5 seconds" },
  { sec: 10, label: "S10", description: "10 seconds" },
  { sec: 15, label: "S15", description: "15 seconds" },
  { sec: 30, label: "S30", description: "30 seconds" },
  { sec: 60, label: "M1", description: "1 minute" },
  { sec: 120, label: "M2", description: "2 minutes" },
  { sec: 180, label: "M3", description: "3 minutes" },
  { sec: 300, label: "M5", description: "5 minutes" },
  { sec: 600, label: "M10", description: "10 minutes" },
  { sec: 900, label: "M15", description: "15 minutes" },
  { sec: 1800, label: "M30", description: "30 minutes" },
  { sec: 3600, label: "H1", description: "1 hour" },
  { sec: 7200, label: "H2", description: "2 hours" },
  { sec: 10800, label: "H3", description: "3 hours" },
  { sec: 14400, label: "H4", description: "4 hours" },
  { sec: 21600, label: "H6", description: "6 hours" },
  { sec: 28800, label: "H8", description: "8 hours" },
  { sec: 43200, label: "H12", description: "12 hours" },
  { sec: 86400, label: "D1", description: "1 day" },
  { sec: 604800, label: "W1", description: "1 week" },
  { sec: 2592000, label: "MN1", description: "1 month" },
];

export function detectTimeframe(candles: Candle[]): TimeframeInfo | null {
  if (candles.length < 2) return null;

  // Compute consecutive deltas.
  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return null;

  // Median is robust to gaps (weekends, holidays, illiquid hours).
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Snap to nearest canonical bucket (allow ±25% tolerance for clock drift).
  let best: TimeframeInfo | null = null;
  let bestDist = Infinity;
  for (const bucket of TIMEFRAME_BUCKETS) {
    const dist = Math.abs(median - bucket.sec);
    if (dist < bestDist) {
      bestDist = dist;
      best = bucket;
    }
  }
  // If the median is more than 25% away from the nearest bucket, the data
  // likely has an unusual interval — fall back to a "Xs" generic label.
  if (best && bestDist > median * 0.25) {
    return {
      seconds: median,
      label: `~${formatSeconds(median)}`,
      description: `${median} seconds (estimated)`,
    };
  }
  return best
    ? { seconds: best.sec, label: best.label, description: best.description }
    : { seconds: median, label: `~${formatSeconds(median)}`, description: `${median} seconds (estimated)` };
}

function formatSeconds(s: number): string {
  if (s >= 86400) return `${(s / 86400).toFixed(1)}d`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`;
  if (s >= 60) return `${(s / 60).toFixed(1)}m`;
  return `${s}s`;
}
