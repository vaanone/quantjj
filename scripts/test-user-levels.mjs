import { readFileSync } from 'fs';
import { parseBuffer } from '/home/z/my-project/src/lib/excel-parser.ts';

for (const file of ['EURUSD.csv', 'XAUUSD.csv', 'BTCUSD.csv']) {
  const buf = readFileSync(`/home/z/my-project/public/data/${file}`);
  const result = parseBuffer(buf.buffer, file);
  console.log(`\n=== ${file} ===`);
  console.log('candles:', result.candles.length);
  console.log('symbol:', result.symbol);
  console.log('userLevels:', JSON.stringify(result.userLevels, null, 2));
}
