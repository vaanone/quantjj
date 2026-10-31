// Support & Resistance detection.
//
// Algorithm (industry-standard swing-pivot + clustering approach):
//
//  1.  SWING PIVOT DETECTION (fractal method):
//      A swing high is a candle whose high is greater than the highs of `leftBars`
//      candles to its left AND `rightBars` candles to its right.
//      A swing low is the symmetric opposite. These are the natural S/R "touch"
//      candidates because price reacted there.
//
//  2.  CLUSTERING:
//      Pivot prices that are within `tolerancePct` of each other are merged into
//      a single level (the volume-weighted average of the touches). This handles
//      the case where a real level is touched several times at slightly different
//      prices over time.
//
//  3.  SCORING:
//      Each cluster gets a strength score = number of touches + bonus for
//      recency + bonus for being touched by both highs and lows (a true level
//      that flips from support to resistance or vice versa).
//
//  4.  FILTERING:
//      Only levels with at least `minTouches` touches (or very strong recency)
//      are returned. Sorted by strength descending.

import type { Candle } from "./excel-parser";

export type SRType = "support" | "resistance";

export interface SRLevel {
  price: number;
  type: SRType;
  touches: number;
  strength: number; // 0-100 normalized
  touchTimes: number[];
  // Whether this level is currently above (resistance) or below (support) the
  // latest close. A level that was resistance but price broke above it becomes
  // "flipped" support — this is reflected in `type`.
  flipped: boolean;
}

export interface SROptions {
  leftBars?: number;
  rightBars?: number;
  tolerancePct?: number;
  minTouches?: number;
  maxLevels?: number;
}

const DEFAULTS: Required<SROptions> = {
  leftBars: 5,
  rightBars: 5,
  tolerancePct: 0.15, // 0.15% — clusters pivots within 0.15% of each other
  minTouches: 2,
  maxLevels: 12,
};

interface Pivot {
  price: number;
  time: number;
  type: SRType;
  index: number;
}

function findPivots(
  candles: Candle[],
  leftBars: number,
  rightBars: number,
): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < leftBars + rightBars + 1) return pivots;

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const candle = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].high >= candle.high) isHigh = false;
      if (candles[j].low <= candle.low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      pivots.push({ price: candle.high, time: candle.time, type: "resistance", index: i });
    }
    if (isLow) {
      pivots.push({ price: candle.low, time: candle.time, type: "support", index: i });
    }
  }

  return pivots;
}

function clusterPivots(pivots: Pivot[], tolerancePct: number): Pivot[][] {
  // Sort by price ascending so neighbors are physically close.
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  let current: Pivot[] = [];

  for (const p of sorted) {
    if (current.length === 0) {
      current.push(p);
      continue;
    }
    const refPrice = current.reduce((sum, x) => sum + x.price, 0) / current.length;
    const deviation = Math.abs(p.price - refPrice) / refPrice;
    if (deviation <= tolerancePct / 100) {
      current.push(p);
    } else {
      clusters.push(current);
      current = [p];
    }
  }
  if (current.length > 0) clusters.push(current);

  return clusters;
}

function buildLevel(
  cluster: Pivot[],
  lastClose: number,
  totalPivots: number,
): SRLevel | null {
  if (cluster.length === 0) return null;

  const price =
    cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
  const touches = cluster.length;
  const touchTimes = cluster.map((p) => p.time).sort((a, b) => a - b);

  // Most recent touch — recency bonus for touches in the last 25% of the data.
  const maxTime = touchTimes[touchTimes.length - 1];
  const minTime = touchTimes[0];
  const span = Math.max(maxTime - minTime, 1);
  const recencyRatio = (maxTime - minTime) / span;

  // Mixed-type bonus: cluster touches both highs and lows = stronger level.
  const hasHigh = cluster.some((p) => p.type === "resistance");
  const hasLow = cluster.some((p) => p.type === "support");
  const mixedBonus = hasHigh && hasLow ? 1.5 : 1;

  // Strength: touches matter most, recency adds a tail, mixed type boosts.
  const touchScore = Math.min(touches / 5, 1); // 5 touches = full
  const strengthRaw =
    touchScore * 60 + recencyRatio * 20 + (mixedBonus - 1) * 20;

  const strength = Math.min(100, Math.round(strengthRaw));

  // Final type: relative to current price. Above close = resistance, below = support.
  const flipped = hasHigh && hasLow; // touched as both → role may have flipped
  const type: SRType = price >= lastClose ? "resistance" : "support";

  return { price, type, touches, strength, touchTimes, flipped };
}

export function detectSupportResistance(
  candles: Candle[],
  options: SROptions = {},
): SRLevel[] {
  if (candles.length < 10) return [];
  const opts = { ...DEFAULTS, ...options };
  const lastClose = candles[candles.length - 1].close;

  const pivots = findPivots(candles, opts.leftBars, opts.rightBars);
  if (pivots.length === 0) return [];

  const clusters = clusterPivots(pivots, opts.tolerancePct);

  const levels: SRLevel[] = clusters
    .map((c) => buildLevel(c, lastClose, pivots.length))
    .filter((l): l is SRLevel => l !== null)
    .filter((l) => l.touches >= opts.minTouches);

  // Sort: strength desc, then by closeness to current price.
  levels.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    const distA = Math.abs(a.price - lastClose);
    const distB = Math.abs(b.price - lastClose);
    return distA - distB;
  });

  return levels.slice(0, opts.maxLevels);
}
