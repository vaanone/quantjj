// Trace what parseDateTimeParts returns for an Excel serial date.
const dateStr = '46296';
const timeStr = undefined;

let combined = '';
if (dateStr) combined += dateStr.trim();
if (timeStr) { combined += ' '; combined += timeStr.trim(); }

console.log('combined:', JSON.stringify(combined));

const ymdhms = combined.match(/^(\d{4})(\d{2})(\d{2})\s?(\d{2})(\d{2})(\d{2})$/);
console.log('ymdhms match:', ymdhms);

const ymd = combined.match(/^(\d{4})(\d{2})(\d{2})$/);
console.log('ymd match:', ymd);

const dotted = combined.match(/^(\d{4})[./-](\d{2})[./-](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
console.log('dotted match:', dotted);

const fallback = Date.parse(combined);
console.log('Date.parse("46296"):', fallback, 'isNaN:', isNaN(fallback));

// What if we interpret 46296 as an Excel serial date?
// Excel epoch: Dec 30, 1899 (with the 1900 leap year bug)
// Unix epoch: Jan 1, 1970
// Days between: 25569
const excelSerial = 46296;
const unixMs = (excelSerial - 25569) * 86400 * 1000;
const d = new Date(unixMs);
console.log('Excel serial 46296 as date:', d.toISOString(), 'year:', d.getUTCFullYear());
