// Generate default CSV data files with columns A through O:
//   A=Date, B=Open, C=High, D=Low, E=Close, F=Volume
//   G=(empty), H=(old support, ignored), I=(old support, ignored)
//   J=R1, K=S1, L=R2, M=S2, N=R3, O=S3  ← pre-computed S/R levels
//
// The S/R values in J–O are constant across all rows (levels don't change
// per candle). They are positioned around the typical price range of each
// symbol so resistance lines are above and support lines are below.

import { writeFileSync, mkdirSync } from 'fs';

const OUTPUT_DIR = '/home/z/my-project/public/data';
mkdirSync(OUTPUT_DIR, { recursive: true });

const symbols = [
  { file: 'EURUSD.csv', sym: 'EURUSD', startPrice: 1.0850, vol: 0.003, decimals: 5,
    levels: { R1: 1.0950, S1: 1.0750, R2: 1.1050, S2: 1.0650, R3: 1.1150, S3: 1.0550 } },
  { file: 'GBPUSD.csv', sym: 'GBPUSD', startPrice: 1.2700, vol: 0.004, decimals: 5,
    levels: { R1: 1.2850, S1: 1.2550, R2: 1.3000, S2: 1.2400, R3: 1.3150, S3: 1.2250 } },
  { file: 'USDJPY.csv', sym: 'USDJPY', startPrice: 149.50, vol: 0.004, decimals: 3,
    levels: { R1: 151.000, S1: 148.000, R2: 152.500, S2: 146.500, R3: 154.000, S3: 145.000 } },
  { file: 'XAUUSD.csv', sym: 'XAUUSD', startPrice: 2330.0, vol: 0.005, decimals: 2,
    levels: { R1: 2380.00, S1: 2280.00, R2: 2430.00, S2: 2230.00, R3: 2480.00, S3: 2180.00 } },
  { file: 'BTCUSD.csv', sym: 'BTCUSD', startPrice: 67000, vol: 0.012, decimals: 2,
    levels: { R1: 69000, S1: 65000, R2: 71000, S2: 63000, R3: 73000, S3: 61000 } },
];

const startTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000);

for (const { file, sym, startPrice, vol, decimals, levels } of symbols) {
  const rows = [];
  // Header row: A=Date, B=Open, C=High, D=Low, E=Close, F=Volume,
  // G=(blank), H=OldS1, I=OldS2, J=R1, K=S1, L=R2, M=S2, N=R3, O=S3
  rows.push('Date,Open,High,Low,Close,Volume,,OldS1,OldS2,R1,S1,R2,S2,R3,S3');

  let price = startPrice;
  let seed = sym.charCodeAt(0) * 1000 + sym.charCodeAt(1);
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

    // Columns: A B C D E F G H I J K L M N O
    //          Date Open High Low Close Vol (blank) OldS1 OldS2 R1 S1 R2 S2 R3 S3
    rows.push(
      `${dateStr} ${timeStr},` +
      `${open.toFixed(decimals)},${high.toFixed(decimals)},${low.toFixed(decimals)},${close.toFixed(decimals)},` +
      `${Math.floor(100 + rng() * 1000)},` +   // F: Volume
      `,` +                                     // G: blank
      `${(levels.S2 + 0.01).toFixed(decimals)},` + // H: old support (ignored)
      `${(levels.S3 + 0.01).toFixed(decimals)},` + // I: old support (ignored)
      `${levels.R1.toFixed(decimals)},` +      // J: R1
      `${levels.S1.toFixed(decimals)},` +      // K: S1
      `${levels.R2.toFixed(decimals)},` +      // L: R2
      `${levels.S2.toFixed(decimals)},` +      // M: S2
      `${levels.R3.toFixed(decimals)},` +      // N: R3
      `${levels.S3.toFixed(decimals)}`         // O: S3
    );
    price = close;
  }

  const path = `${OUTPUT_DIR}/${file}`;
  writeFileSync(path, rows.join('\n') + '\n');
  console.log(`Wrote ${rows.length - 1} candles to ${path} (15 columns A–O)`);
}

function pad(n) {
  return String(n).padStart(2, '0');
}
