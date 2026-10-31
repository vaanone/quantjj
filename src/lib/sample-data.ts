// Generates realistic-looking OHLC sample data for demoing the chart.
// Uses a geometric-Brownian-motion style random walk with intrabar noise.

import type { Candle } from "./excel-parser";

export interface SampleConfig {
  symbol: string;
  bars: number;
  intervalSeconds: number; // e.g. 3600 = H1, 86400 = D1
  startPrice: number;
  volatilityPct: number; // % of price as 1-stddev move per bar
  seed?: number;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform: uniform [0,1) -> standard normal
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateSampleData(config: SampleConfig): Candle[] {
  const { symbol, bars, intervalSeconds, startPrice, volatilityPct, seed = 42 } = config;
  void symbol;
  const rng = mulberry32(seed);
  const candles: Candle[] = [];

  // Anchor the most recent bar to "now" floored to interval.
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (bars - 1) * intervalSeconds;

  let price = startPrice;
  const vol = volatilityPct / 100;

  // Inject a slow drift cycle so S/R levels actually form (trend up, down, sideways).
  for (let i = 0; i < bars; i++) {
    const t = startTime + i * intervalSeconds;

    // Combine slow sinusoidal regime with random walk.
    const regime = Math.sin(i / 60) * vol * 0.4;
    const shock = gaussian(rng) * vol;
    const ret = regime + shock;

    const open = price;
    const close = open * (1 + ret);

    // Intrabar wick noise
    const wickUp = Math.abs(gaussian(rng)) * vol * open * 0.7;
    const wickDown = Math.abs(gaussian(rng)) * vol * open * 0.7;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;

    const volume = Math.round(500 + Math.abs(gaussian(rng)) * 1500 + Math.abs(ret) * 5000);

    candles.push({
      time: t,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });

    price = close;
  }

  return candles;
}

function round(p: number): number {
  return Math.round(p * 1e5) / 1e5;
}

// Sensible defaults for a forex-style H1 chart.
export const SAMPLE_PRESETS: SampleConfig[] = [
  { symbol: "EURUSD", bars: 600, intervalSeconds: 3600, startPrice: 1.085, volatilityPct: 0.25 },
  { symbol: "XAUUSD", bars: 600, intervalSeconds: 3600, startPrice: 2330, volatilityPct: 0.4 },
  { symbol: "BTCUSD", bars: 600, intervalSeconds: 3600, startPrice: 67000, volatilityPct: 1.2 },
];
