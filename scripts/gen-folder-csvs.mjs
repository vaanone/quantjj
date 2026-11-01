// Generate 3 separate single-symbol CSV files to simulate a folder of CSVs.
import { writeFileSync } from 'fs';

const symbols = [
  { name: 'EURUSD_H1.csv', sym: 'EURUSD', startPrice: 1.085, vol: 0.003 },
  { name: 'GBPUSD_H1.csv', sym: 'GBPUSD', startPrice: 1.270, vol: 0.004 },
  { name: 'XAUUSD_H1.csv', sym: 'XAUUSD', startPrice: 2330, vol: 0.005 },
];

const startTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000);

for (const { name, sym, startPrice, vol } of symbols) {
  const rows = [];
  rows.push('Date,Open,High,Low,Close,Volume');
  let price = startPrice;
  for (let i = 0; i < 200; i++) {
    const t = startTime + i * 3600;
    const open = price;
    const regime = Math.sin(i / 30) * vol * 0.4;
    const shock = (Math.random() - 0.5) * vol;
    const close = open * (1 + regime + shock);
    const high = Math.max(open, close) + Math.abs(Math.random() - 0.5) * vol * 0.3;
    const low = Math.min(open, close) - Math.abs(Math.random() - 0.5) * vol * 0.3;
    const d = new Date(t * 1000);
    const dateStr = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
    const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    rows.push(`${dateStr} ${timeStr},${open.toFixed(sym === 'XAUUSD' ? 2 : 5)},${high.toFixed(sym === 'XAUUSD' ? 2 : 5)},${low.toFixed(sym === 'XAUUSD' ? 2 : 5)},${close.toFixed(sym === 'XAUUSD' ? 2 : 5)},${Math.floor(100 + Math.random() * 1000)}`);
    price = close;
  }
  writeFileSync(`/tmp/${name}`, rows.join('\n') + '\n');
  console.log(`Wrote ${rows.length - 1} candles to /tmp/${name}`);
}

function pad(n) { return String(n).padStart(2, '0'); }
