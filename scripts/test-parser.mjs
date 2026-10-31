// Quick test of the excel-parser on the test CSV to debug the issue.
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';

const buf = readFileSync('/tmp/eurusd_30d_h1.csv');
const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });

console.log('total rows:', rows.length);
console.log('first 3 rows (with cellDates:true, raw:true):');
for (let i = 0; i < 3; i++) {
  console.log(JSON.stringify(rows[i]));
}
console.log('row 100:');
console.log(JSON.stringify(rows[100]));
console.log('row 0 cell 0 type:', typeof rows[0][0], rows[0][0] instanceof Date ? '(Date)' : '');
console.log('row 1 cell 0 type:', typeof rows[1][0], rows[1][0] instanceof Date ? '(Date)' : '');


