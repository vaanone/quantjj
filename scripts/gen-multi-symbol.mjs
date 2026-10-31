// Generate a multi-symbol MT5 History Center format .xlsx file.
// Contains 3 symbols (EURUSD, GBPUSD, USDJPY) with ~100 H1 candles each,
// interleaved as MT5 exports them.

import * as XLSX from 'xlsx';
import { writeFileSync } from 'fs';

const symbols = ['EURUSD', 'GBPUSD', 'USDJPY'];
const startPrices = { EURUSD: 1.085, GBPUSD: 1.270, USDJPY: 149.50 };
const candles = [];

// Each symbol gets 100 H1 candles starting from 2026-10-01 00:00
const startTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000);

for (const sym of symbols) {
  let price = startPrices[sym];
  const vol = sym === 'USDJPY' ? 0.5 : 0.003;
  for (let i = 0; i < 100; i++) {
    const t = startTime + i * 3600;
    const open = price;
    const regime = Math.sin(i / 15) * vol * 0.5;
    const shock = (Math.random() - 0.5) * vol;
    const close = open * (1 + regime + shock);
    const high = Math.max(open, close) + Math.abs(Math.random() - 0.5) * vol * 0.3;
    const low = Math.min(open, close) - Math.abs(Math.random() - 0.5) * vol * 0.3;
    candles.push({
      ticker: sym,
      date: formatYMD(t),
      time: formatHMS(t),
      open: open.toFixed(sym === 'USDJPY' ? 3 : 5),
      high: high.toFixed(sym === 'USDJPY' ? 3 : 5),
      low: low.toFixed(sym === 'USDJPY' ? 3 : 5),
      close: close.toFixed(sym === 'USDJPY' ? 3 : 5),
      vol: Math.floor(100 + Math.random() * 1000),
    });
    price = close;
  }
}

function formatYMD(unixSec) {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function formatHMS(unixSec) {
  const d = new Date(unixSec * 1000);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

const ws = XLSX.utils.json_to_sheet(candles, {
  header: ['ticker', 'date', 'time', 'open', 'high', 'low', 'close', 'vol']
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Symbols');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync('/tmp/mt5_multi_symbol.xlsx', buf);
console.log(`Wrote ${candles.length} candles across ${symbols.length} symbols to /tmp/mt5_multi_symbol.xlsx`);
console.log('Symbols:', symbols.join(', '));
