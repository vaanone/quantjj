// Test the multi-symbol MT5 file
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';

const buf = readFileSync('/tmp/mt5_multi_symbol.xlsx');
const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });

console.log('total rows:', rows.length);
console.log('first 4 rows:');
for (let i = 0; i < 4; i++) {
  console.log(JSON.stringify(rows[i]));
}
// Check row types
console.log('row 1 cell types:', rows[1].map(v => typeof v));
console.log('row 1 date val:', rows[1][1], typeof rows[1][1]);
console.log('row 1 time val:', rows[1][2], typeof rows[1][2]);



