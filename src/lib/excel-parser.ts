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
  symbol?: string; // per-candle ticker (when the file has a <TICKER> column)
}

/** A pre-computed S/R level read from a specific column in the CSV/Excel file.
 *  The user populates columns J–O with constant price values; we read the
 *  first non-empty numeric value from each and draw it as a horizontal line. */
export interface UserLevel {
  name: string;   // header name (e.g. "R1") or Excel letter (e.g. "J")
  price: number;
  column: string; // Excel column letter: "J", "K", "L", "M", "N", "O"
}

export interface ParseResult {
  candles: Candle[];
  symbol: string;        // primary / first symbol found (for backward compat)
  symbols: string[];     // all unique tickers found in the file (sorted)
  detectedColumns: string[];
  warnings: string[];
  userLevels: UserLevel[]; // pre-computed S/R levels from columns J–O
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

// Converts a raw cell value (which XLSX may return as a number) into a
// properly-padded string for date/time regex matching.
//
// XLSX with `raw: true` auto-converts numeric-looking strings:
//   "20261001" → number 20261001  (String → "20261001" — already 8 digits, OK)
//   "000000"   → number 0         (String → "0" — needs padding to "000000")
//   "000500"   → number 500       (String → "500" — needs padding to "000500")
//
// We detect whether the value looks like an MT5 date (8 digits) or time
// (6 digits) and pad accordingly. Non-numeric strings pass through unchanged.
function formatNumericDateTime(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    const s = String(Math.abs(Math.trunc(value)));
    // MT5 date format is YYYYMMDD (8 digits); time is HHMMSS (6 digits).
    if (s.length <= 6) return s.padStart(6, "0"); // time
    return s.padStart(8, "0"); // date
  }
  return String(value).trim();
}

// Columns H through O (Excel letters) → 0-indexed positions.
// The user puts pre-computed S/R price values in these columns.
const USER_LEVEL_COLUMNS: { letter: string; index: number }[] = [
  { letter: "H", index: 7 },
  { letter: "I", index: 8 },
  { letter: "J", index: 9 },
  { letter: "K", index: 10 },
  { letter: "L", index: 11 },
  { letter: "M", index: 12 },
  { letter: "N", index: 13 },
  { letter: "O", index: 14 },
];

/**
 * Extract pre-computed S/R levels from columns H–O.
 *
 * IMPORTANT: Only scans rows belonging to TODAY (the most recent CSV
 * calendar day in the file). If today's rows don't have S/R values
 * yet (user hasn't updated them), returns an EMPTY array — so no
 * lines are drawn on the chart until the user populates today's row
 * with new S/R values.
 *
 * This matches the user's workflow: every morning they update the
 * CSV with the day's new pivot levels. Until they do, yesterday's
 * levels should NOT appear on today's candles.
 *
 * @param rows         All data rows (raw 2D array from XLSX/CSV).
 * @param headerStart  Index of the first data row.
 * @param todayRowIdxs Set of row indices belonging to today's CSV day.
 *                     If null, scans ALL rows (backward compat).
 *                     If empty Set, scans nothing → no levels → no lines.
 */
function extractUserLevels(
  rows: unknown[][],
  headerStart: number,
  todayRowIdxs: Set<number> | null = null,
): UserLevel[] {
  const levels: UserLevel[] = [];
  if (rows.length === 0) return levels;

  // Determine which row indices to scan.
  // - todayRowIdxs === null  → scan ALL rows (backward compat).
  // - todayRowIdxs.size === 0 → scan NOTHING (today has no S/R values yet).
  // - todayRowIdxs.size > 0 → scan only today's rows.
  const scanIndices: number[] = [];
  if (todayRowIdxs === null) {
    for (let i = headerStart; i < rows.length; i++) scanIndices.push(i);
  } else {
    for (const i of todayRowIdxs) {
      if (i >= headerStart && i < rows.length) scanIndices.push(i);
    }
  }

  for (const { letter, index } of USER_LEVEL_COLUMNS) {
    // Skip if no scan-eligible row has this many columns.
    const hasColumn = scanIndices.some(
      (i) => Array.isArray(rows[i]) && rows[i].length > index,
    );
    if (!hasColumn) continue;

    // Try to get a header name from the header row.
    let name = letter;
    if (headerStart > 0) {
      const headerRow = rows[headerStart - 1];
      if (headerRow && headerRow[index] != null) {
        const headerVal = String(headerRow[index]).trim();
        if (headerVal !== "" && toNumber(headerVal) === null) {
          name = headerVal;
        }
      }
    }

    // Scan ONLY today's rows (or all rows if no date filter) for the
    // first non-empty numeric value.
    let price: number | null = null;
    for (const i of scanIndices) {
      const row = rows[i];
      if (!row || row.length <= index) continue;
      const val = toNumber(row[index]);
      if (val !== null && val > 0) {
        price = val;
        break;
      }
    }

    if (price !== null) {
      levels.push({ name, price, column: letter });
    }
  }

  return levels;
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
    return { candles: [], symbol: "", symbols: [], detectedColumns: [], warnings: ["Empty file"], userLevels: [] };
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
      symbols: [],
      detectedColumns: [],
      warnings: [
        "Could not detect OHLC columns. Expected headers like Date,Open,High,Low,Close[,Volume] or MT5 tab-separated export.",
      ],
      userLevels: [],
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
  // Parallel array tracking each candle's row index + CSV day key.
  // Used after the loop to build a set of "today's rows" for S/R
  // extraction — so levels are only drawn from today's data, not
  // yesterday's stale values.
  const candleRowInfo: { rowIndex: number; dayKey: number }[] = [];
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
      // When XLSX reads with `raw: true`, numeric-looking strings like
      // "20261001" come back as numbers (20261001) and "000000" as 0. We
      // pad them back to their canonical widths so the regexes match.
      const dateStr = formatNumericDateTime(rawDateVal);
      const timeStr = formatNumericDateTime(rawTimeVal);
      time = parseDateTimeParts(dateStr, timeStr);
    }

    if (time === null) continue;

    const open = toNumber(row[columnMap.open]);
    const high = toNumber(row[columnMap.high]);
    const low = toNumber(row[columnMap.low]);
    const close = toNumber(row[columnMap.close]);
    const volume = columnMap.volume !== undefined ? toNumber(row[columnMap.volume]) : null;

    if (open === null || high === null || low === null || close === null) continue;

    // Per-row symbol: tag each candle with its own ticker so the UI can
    // filter by symbol when the file contains multiple instruments.
    let rowSymbol = "";
    if (columnMap.ticker !== undefined) {
      rowSymbol = String(row[columnMap.ticker] ?? "").trim();
    }
    if (!symbol && rowSymbol) symbol = rowSymbol; // first symbol = primary

    candles.push({
      time,
      open,
      high,
      low,
      close,
      ...(volume !== null && volume > 0 ? { volume } : undefined),
      ...(rowSymbol ? { symbol: rowSymbol } : undefined),
    });

    // Track this candle's row index + CSV day key so we can later
    // build a set of "today's rows" for S/R level extraction.
    const d = new Date(time * 1000);
    const dk = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    candleRowInfo.push({ rowIndex: i, dayKey: dk });
  }

  // Collect all unique symbols (sorted) for the symbol-switcher dropdown.
  const symbolSet = new Set<string>();
  for (const c of candles) {
    if (c.symbol) symbolSet.add(c.symbol);
  }
  const symbols = Array.from(symbolSet).sort();

  if (candles.length === 0) {
    warnings.push("No valid OHLC rows found after parsing.");
  }

  // Sort by (symbol, time) and dedupe. When the file contains multiple
  // symbols, they share the same timestamps (e.g. all have an H1 candle at
  // 00:00). Deduping on time alone would discard all but the last symbol's
  // candle for each timestamp. We dedupe on (symbol, time) instead so each
  // symbol keeps its own candle at each timestamp. Duplicates within the same
  // symbol (genuine repeats in MT5 exports) are still collapsed.
  candles.sort((a, b) => {
    const sa = a.symbol ?? "";
    const sb = b.symbol ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.time - b.time;
  });
  const dedup: Candle[] = [];
  for (const c of candles) {
    const last = dedup[dedup.length - 1];
    const lastSym = last?.symbol ?? "";
    const curSym = c.symbol ?? "";
    if (last && last.time === c.time && lastSym === curSym) {
      dedup[dedup.length - 1] = c; // overwrite duplicate within same symbol
    } else {
      dedup.push(c);
    }
  }

  // Try to infer symbol from filename when no ticker column.
  // Strip common MT5 timeframe suffixes so "EURUSD_H1.csv" → "EURUSD".
  if (!symbol) {
    const base = filename.replace(/\.(xlsx|xls|csv|tsv|txt)$/i, "");
    symbol = base
      .replace(/[_\-\s](H1|H2|H3|H4|H6|H8|H12|D1|W1|MN|MN1|M1|M2|M3|M5|M10|M15|M30|S1|S5|S10|S15|S30)$/i, "")
      .slice(0, 20);
  }

  // If there was no ticker column, `symbols` is empty — synthesize a single
  // entry from the inferred symbol so the UI's symbol dropdown still has a
  // value to display.
  const finalSymbols = symbols.length > 0 ? symbols : [symbol];

  // Extract pre-computed S/R levels from columns H–O.
  //
  // IMPORTANT: Only extract levels from TODAY's rows (the most recent
  // CSV calendar day in the file). If today's rows don't have S/R
  // values yet (user hasn't updated them), no levels are returned and
  // NO lines are drawn on the chart. This prevents yesterday's stale
  // levels from appearing on today's candles.
  let todayRowIdxs: Set<number> | null = null;
  if (dedup.length > 0) {
    const lastCandle = dedup[dedup.length - 1];
    const d = new Date(lastCandle.time * 1000);
    const todayDayKey =
      d.getUTCFullYear() * 10000 +
      (d.getUTCMonth() + 1) * 100 +
      d.getUTCDate();
    todayRowIdxs = new Set<number>();
    for (const info of candleRowInfo) {
      if (info.dayKey === todayDayKey) todayRowIdxs.add(info.rowIndex);
    }
  }
  const userLevels = extractUserLevels(rows, headerStart, todayRowIdxs);

  return {
    candles: dedup,
    symbol,
    symbols: finalSymbols,
    detectedColumns: detectedColumns.filter(Boolean),
    warnings,
    userLevels,
  };
}
