// Generate default CSV data files for the public/data/ folder.
// These ship with the app so the dropdown is populated on first load.

import { writeFileSync, mkdirSync } from 'fs';

const OUTPUT_DIR = '/home/z/my-project/public/data';
mkdirSync(OUTPUT_DIR, { recursive: true });

const symbols = [
  { file: 'EURUSD.csv', sym: 'EURUSD', startPrice: 1.0850, vol: 0.003, decimals: 5 },
  { file: 'GBPUSD.csv', sym: 'GBPUSD', startPrice: 1.2700, vol: 0.004, decimals: 5 },
  { file: 'USDJPY.csv', sym: 'USDJPY', startPrice: 149.50, vol: 0.004, decimals: 3 },
  { file: 'XAUUSD.csv', sym: 'XAUUSD', startPrice: 2330.0, vol: 0.005, decimals: 2 },
  { file: 'BTCUSD.csv', sym: 'BTCUSD', startPrice: 67000, vol: 0.012, decimals: 2 },
];

// Each file: 300 H1 candles spanning ~12 days
const startTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000);

for (const { file, sym, startPrice, vol, decimals } of symbols) {
  const rows = ['Date,Open,High,Low,Close,Volume'];
  let price = startPrice;
  let seed = sym.charCodeAt(0) * 1000 + sym.charCodeAt(1); // deterministic per symbol
  // Simple seeded random
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let i = 0; i < 300; i++) {
    const t = startTime + i * 3600;
    const open = price;
    const regime = Math.sin(i / 40) * vol * 0.5;
    const shock = (rng() - 0.5) * vol;
    const close = open * (1 + regime + shock);
    const wickUp = rng() * vol * open * 0.3;
    const wickDn = rng() * vol * open * 0.3;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDn;
    const d = new Date(t * 1000);
    const dateStr = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
    const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    rows.push(
      `${dateStr} ${timeStr},${open.toFixed(decimals)},${high.toFixed(decimals)},${low.toFixed(decimals)},${close.toFixed(decimals)},${Math.floor(100 + rng() * 1000)}`
    );
    price = close;
  }

  const path = `${OUTPUT_DIR}/${file}`;
  writeFileSync(path, rows.join('\n') + '\n');
  console.log(`Wrote ${rows.length - 1} candles to ${path}`);
}

function pad(n) {
  return String(n).padStart(2, '0');
}
