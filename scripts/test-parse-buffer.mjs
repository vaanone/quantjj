// Test the actual parseBuffer function on the multi-symbol file
import { readFileSync } from 'fs';
import { parseBuffer } from '/home/z/my-project/src/lib/excel-parser.ts';

const buf = readFileSync('/tmp/mt5_multi_symbol.xlsx');
const result = parseBuffer(buf.buffer, 'mt5_multi_symbol.xlsx');

console.log('candles.length:', result.candles.length);
console.log('symbol:', result.symbol);
console.log('symbols:', result.symbols);
console.log('detectedColumns:', result.detectedColumns);
console.log('warnings:', result.warnings);

if (result.candles.length > 0) {
  console.log('first candle:', JSON.stringify(result.candles[0]));
  console.log('last candle:', JSON.stringify(result.candles[result.candles.length - 1]));
  
  // Count per symbol
  const counts = {};
  for (const c of result.candles) {
    const s = c.symbol || '(none)';
    counts[s] = (counts[s] || 0) + 1;
  }
  console.log('per symbol:', counts);
}
