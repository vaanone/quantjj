import * as XLSX from 'xlsx';
import { writeFileSync } from 'fs';

// Generate MT5-style History Center export: tab-separated, with header row.
// Format: <TICKER> <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <VOL>
const ticker = 'GBPUSD';
const candles = [];
const startTime = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
let price = 1.27;
for (let i = 0; i < 200; i++) {
  const t = startTime + i * 3600;
  const open = price;
  const shock = (Math.random() - 0.5) * 0.003;
  const close = open * (1 + shock);
  const high = Math.max(open, close) + Math.abs(Math.random() - 0.5) * 0.001;
  const low = Math.min(open, close) - Math.abs(Math.random() - 0.5) * 0.001;
  candles.push({
    ticker,
    date: formatYMD(t),
    time: formatHMS(t),
    open: open.toFixed(5),
    high: high.toFixed(5),
    low: low.toFixed(5),
    close: close.toFixed(5),
    vol: Math.floor(100 + Math.random() * 1000),
  });
  price = close;
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

// Build a sheet with header row that matches MT5 History Center format
const ws = XLSX.utils.json_to_sheet(candles, {
  header: ['ticker', 'date', 'time', 'open', 'high', 'low', 'close', 'vol']
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'GBPUSD');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync('/tmp/mt5_sample_gbpusd.xlsx', buf);
console.log('Wrote', candles.length, 'candles to /tmp/mt5_sample_gbpusd.xlsx');
