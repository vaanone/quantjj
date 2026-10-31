// Excel/CSV parser for MT5 (MetaTrader 5) exported OHLC data.
//
// Supports the most common MT5 export shapes:
//   1. MT5 History Center tab-separated export (with <TICKER> column):
//        <TICKER>\t<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<VOL>
//        EURUSD   20230101   000000   1.06610   1.06680   1.06580   1.06630   0
//   2. MT5 "Save as CSV" with header row:
//        Date,Open,High,Low,Close,Volume
//        2023.01.01 00:00,1.0661,1.0668,1.0658,1.0663,0
//   3. Plain CSV with Time column instead of Date+Time:
//        Time,Open,High,Low,Close,Volume
//        2023-01-01 00:00:00,1.0661,1.0668,1.0658,1.0663,0
//
// Returns normalized candles suitable for lightweight-charts:
//   { time: number (UNIX seconds), open, high, low, close, volume? }

import * as XLSX from "xlsx";

export interface Candle {
  time: number; // UNIX seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ParseResult {
  candles: Candle[];
  symbol: string;
  detectedColumns: string[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "<date>", "daten", "day"],
  time: ["time", "<time>", "timestamp", "datetime"],
  open: ["open", "<open>", "o"],
  high: ["high", "<high>", "h"],
  low: ["low", "<low>", "l"],
  close: ["close", "<close>", "c"],
  volume: ["vol", "volume", "<vol>", "v", "tickvol", "<tickvol>"],
  ticker: ["ticker", "<ticker>", "symbol"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

function matchAlias(header: string): string | null {
  const h = normalizeHeader(header);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(h)) return canonical;
  }
  return null;
}

// Parse MT5 date+time formats: "20230101", "000000", "2023.01.01 00:00",
// "2023-01-01 00:00:00", "2023/01/01", etc.
function parseDateTimeParts(dateStr?: string, timeStr?: string): number | null {
  if (!dateStr && !timeStr) return null;

  // Combine into a single string.
  let combined = "";
  if (dateStr) combined += dateStr.trim();
  if (timeStr) {
    if (combined) combined += " ";
    combined += timeStr.trim();
  }

  // Try YYYYMMDD HHMMSS  (MT5 History Center export: "20230101" + "000000")
  const ymdhms = combined.match(/^(\d{4})(\d{2})(\d{2})\s?(\d{2})(\d{2})(\d{2})$/);
  if (ymdhms) {
    const [, y, mo, d, h, mi, s] = ymdhms;
    const dt = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    if (!isNaN(dt)) return Math.floor(dt / 1000);
  }

  // Try YYYYMMDD only (no time)
  const ymd = combined.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) {
    const [, y, mo, d] = ymd;
    const dt = Date.UTC(+y, +mo - 1, +d, 0, 0, 0);
    if (!isNaN(dt)) return Math.floor(dt / 1000);
  }

  // Try YYYY.MM.DD HH:MM(:SS)
  const dotted = combined.match(
    /^(\d{4})[./-](\d{2})[./-](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/,
  );
  if (dotted) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = dotted;
    const dt = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    if (!isNaN(dt)) return Math.floor(dt / 1000);
  }

  // Fallback: Date.parse handles ISO-8601 and many locale formats.
  const fallback = Date.parse(combined);
  if (!isNaN(fallback)) return Math.floor(fallback / 1000);

  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[, ]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

interface ColumnMap {
  date?: number;
  time?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ticker?: number;
}

function detectColumns(headers: string[]): ColumnMap | null {
  const map: ColumnMap = {
    open: -1,
    high: -1,
    low: -1,
    close: -1,
  };

  headers.forEach((h, i) => {
    const canonical = matchAlias(h);
    if (!canonical) return;
    if (canonical === "date" && map.date === undefined) map.date = i;
    else if (canonical === "time" && map.time === undefined && map.date === undefined) {
      // Only use "time" column when there is no separate "date" column.
      map.time = i;
    } else if (canonical === "time" && map.date !== undefined && map.time === undefined) {
      // separate date+time columns
      map.time = i;
    } else if (canonical === "open" && map.open === -1) map.open = i;
    else if (canonical === "high" && map.high === -1) map.high = i;
    else if (canonical === "low" && map.low === -1) map.low = i;
    else if (canonical === "close" && map.close === -1) map.close = i;
    else if (canonical === "volume" && map.volume === undefined) map.volume = i;
    else if (canonical === "ticker" && map.ticker === undefined) map.ticker = i;
  });

  if (map.open < 0 || map.high < 0 || map.low < 0 || map.close < 0) return null;
  return map;
}

// Detect the MT5 History Center shape: header row may be missing, but the
// first row looks like "<TICKER> <DATE:8digits> <TIME:6digits> <O> <H> <L> <C> <V>".
function detectNoHeaderRow(row: unknown[]): ColumnMap | null {
  if (row.length < 5) return null;

  // Find positions of date-like (8 digits) and time-like (6 digits) strings.
  let dateIdx = -1;
  let timeIdx = -1;
  for (let i = 0; i < row.length; i++) {
    const v = String(row[i] ?? "").trim();
    if (dateIdx === -1 && /^\d{8}$/.test(v)) dateIdx = i;
    else if (timeIdx === -1 && /^\d{6}$/.test(v)) timeIdx = i;
  }

  if (dateIdx === -1) return null;

  // 4 numeric columns after the time column (or after date if no time).
  const start = timeIdx > dateIdx ? timeIdx + 1 : dateIdx + 1;
  const numerics: number[] = [];
  for (let i = start; i < row.length; i++) {
    if (toNumber(row[i]) !== null) numerics.push(i);
  }

  if (numerics.length < 4) return null;

  return {
    date: dateIdx,
    time: timeIdx === -1 ? undefined : timeIdx,
    open: numerics[0],
    high: numerics[1],
    low: numerics[2],
    close: numerics[3],
    volume: numerics[4],
    ticker: dateIdx > 0 ? 0 : undefined,
  };
}

function isHeaderRow(row: unknown[]): boolean {
  // A row counts as header if at least one cell matches an OHLC alias
  // AND that cell isn't numeric.
  for (const cell of row) {
    const s = String(cell ?? "").trim().toLowerCase();
    if (!s) continue;
    if (toNumber(cell) !== null) continue;
    if (matchAlias(s)) return true;
  }
  return false;
}

export async function parseFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  return parseBuffer(buffer, file.name);
}

export function parseBuffer(buffer: ArrayBuffer, filename: string): ParseResult {
  // Read with `cellDates: true` so any date-looking cell is returned as a JS
  // Date object instead of an Excel serial number. This is critical because
  // MT5 CSV exports like "2026.10.01 00:00" otherwise get auto-parsed by XLSX
  // into Excel serial numbers (e.g. 46296.04...) which my string-based date
  // regexes can't handle — and the fallback `Date.parse("46296")` would
  // silently produce year 46296 instead of erroring.
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // array_of_arrays: each row is an array; first row is row 0.
  // `raw: true` returns the underlying cell value (number, string, or Date
  // when `cellDates: true`). For date-looking cells, XLSX returns a JS Date
  // object — which we convert directly to unix seconds in the row loop below.
  // For numeric cells (OHLC, volume), XLSX returns a number — which `toNumber`
  // handles. For string cells (ticker, plain-text dates that XLSX didn't
  // auto-detect as dates), XLSX returns the raw string.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    return { candles: [], symbol: "", detectedColumns: [], warnings: ["Empty file"] };
  }

  const warnings: string[] = [];
  let columnMap: ColumnMap | null = null;
  let headerStart = 0;

  // Try to detect a header row by scanning the first 5 rows.
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (isHeaderRow(rows[i])) {
      columnMap = detectColumns(rows[i].map(String));
      headerStart = i + 1;
      break;
    }
  }

  // If no header, fall back to MT5 History Center no-header detection.
  if (!columnMap) {
    columnMap = detectNoHeaderRow(rows[0]);
    headerStart = 0;
  }

  if (!columnMap) {
    return {
      candles: [],
      symbol: "",
      detectedColumns: [],
      warnings: [
        "Could not detect OHLC columns. Expected headers like Date,Open,High,Low,Close[,Volume] or MT5 tab-separated export.",
      ],
    };
  }

  const detectedColumns: string[] = [];
  if (columnMap.ticker !== undefined) detectedColumns[columnMap.ticker] = "ticker";
  if (columnMap.date !== undefined) detectedColumns[columnMap.date] = "date";
  if (columnMap.time !== undefined) detectedColumns[columnMap.time] = "time";
  detectedColumns[columnMap.open] = "open";
  detectedColumns[columnMap.high] = "high";
  detectedColumns[columnMap.low] = "low";
  detectedColumns[columnMap.close] = "close";
  if (columnMap.volume !== undefined) detectedColumns[columnMap.volume] = "volume";

  const candles: Candle[] = [];
  let symbol = "";

  for (let i = headerStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // With `cellDates: true` + `raw: false`, date cells arrive as JS Date
    // objects. Convert directly to unix seconds to avoid the string-parsing
    // path (which can't handle Excel serial numbers and would silently
    // produce wrong dates).
    let time: number | null = null;
    const rawDateVal = columnMap.date !== undefined ? row[columnMap.date] : undefined;
    const rawTimeVal = columnMap.time !== undefined ? row[columnMap.time] : undefined;

    if (rawDateVal instanceof Date) {
      // Date object from a date-formatted cell — use directly.
      time = Math.floor(rawDateVal.getTime() / 1000);
    } else if (rawTimeVal instanceof Date) {
      // Some exports put the full timestamp in the "time" column.
      time = Math.floor(rawTimeVal.getTime() / 1000);
    } else {
      // String path: parse "2026.10.01" + "00:00" etc.
      const dateStr = rawDateVal !== undefined ? String(rawDateVal ?? "") : undefined;
      const timeStr = rawTimeVal !== undefined ? String(rawTimeVal ?? "") : undefined;
      time = parseDateTimeParts(dateStr, timeStr);
    }

    if (time === null) continue;

    const open = toNumber(row[columnMap.open]);
    const high = toNumber(row[columnMap.high]);
    const low = toNumber(row[columnMap.low]);
    const close = toNumber(row[columnMap.close]);
    const volume = columnMap.volume !== undefined ? toNumber(row[columnMap.volume]) : null;

    if (open === null || high === null || low === null || close === null) continue;

    if (!symbol && columnMap.ticker !== undefined) {
      const t = String(row[columnMap.ticker] ?? "").trim();
      if (t) symbol = t;
    }

    candles.push({
      time,
      open,
      high,
      low,
      close,
      ...(volume !== null && volume > 0 ? { volume } : undefined),
    });
  }

  if (candles.length === 0) {
    warnings.push("No valid OHLC rows found after parsing.");
  }

  // Sort ascending by time and dedupe (MT5 exports can sometimes have duplicates).
  candles.sort((a, b) => a.time - b.time);
  const dedup: Candle[] = [];
  for (const c of candles) {
    const last = dedup[dedup.length - 1];
    if (last && last.time === c.time) {
      dedup[dedup.length - 1] = c; // overwrite with later row
    } else {
      dedup.push(c);
    }
  }

  // Try to infer symbol from filename when no ticker column.
  if (!symbol) {
    const base = filename.replace(/\.(xlsx|xls|csv|tsv|txt)$/i, "");
    symbol = base.slice(0, 20);
  }

  return {
    candles: dedup,
    symbol,
    detectedColumns: detectedColumns.filter(Boolean),
    warnings,
  };
}
