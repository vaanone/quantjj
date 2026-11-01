// Generates a longer MT5-style H1 CSV file spanning ~30 days so we can verify
// that the chart shows the FULL loaded history (not just last 10 days).

const ticker = 'EURUSD';
const rows = [];
// 30 days of H1 candles = 30 * 24 = 720 bars
const startTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000); // 2026-10-01
let price = 1.085;
for (let i = 0; i < 720; i++) {
  const t = startTime + i * 3600;
  const open = price;
  // Sinusoidal regime + noise so S/R levels actually form
  const regime = Math.sin(i / 50) * 0.002;
  const shock = (Math.random() - 0.5) * 0.004;
  const close = open * (1 + regime + shock);
  const high = Math.max(open, close) + Math.abs(Math.random() - 0.5) * 0.0015;
  const low = Math.min(open, close) - Math.abs(Math.random() - 0.5) * 0.0015;
  const d = new Date(t * 1000);
  const dateStr = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  rows.push(`${dateStr} ${timeStr},${open.toFixed(5)},${high.toFixed(5)},${low.toFixed(5)},${close.toFixed(5)},${Math.floor(100 + Math.random() * 1000)}`);
  price = close;
}

function pad(n) { return String(n).padStart(2, '0'); }

const csv = 'Date,Open,High,Low,Close,Volume\n' + rows.join('\n') + '\n';
const fs = await import('fs');
fs.writeFileSync('/tmp/eurusd_30d_h1.csv', csv);
console.log(`Wrote ${rows.length} candles to /tmp/eurusd_30d_h1.csv (spans 2026-10-01 onward)`);
