import { readFileSync } from 'fs';
import { parseBuffer } from '/home/z/my-project/src/lib/excel-parser.ts';

const buf = readFileSync('/tmp/XAUUSD_H1.csv');
const result = parseBuffer(buf.buffer, 'XAUUSD_H1.csv');

console.log('candles:', result.candles.length);
console.log('symbol:', result.symbol);
console.log('symbols:', result.symbols);
console.log('warnings:', result.warnings);
if (result.candles.length > 0) {
  console.log('first:', JSON.stringify(result.candles[0]));
  console.log('last:', JSON.stringify(result.candles[result.candles.length - 1]));
  const prices = result.candles.map(c => c.close);
  console.log('price range:', Math.min(...prices), '-', Math.max(...prices));
}
