// Default data files that ship with the app in /public/data/.
// On first load, these are fetched and parsed so the dropdown is pre-populated
// without the user needing to upload anything.

import { parseBuffer, type ParseResult } from "./excel-parser";

export const DEFAULT_DATA_DIR = "/data";

export const DEFAULT_FILES: string[] = [
  "EURUSD.csv",
  "GBPUSD.csv",
  "USDJPY.csv",
  "XAUUSD.csv",
  "BTCUSD.csv",
];

/**
 * Fetch and parse all default data files.
 * Returns successfully parsed results; failed files are silently skipped
 * (logged to console) so the app still works if a file is missing.
 */
export async function loadDefaultFiles(): Promise<
  { result: ParseResult; fileName: string }[]
> {
  const results: { result: ParseResult; fileName: string }[] = [];

  await Promise.all(
    DEFAULT_FILES.map(async (fileName) => {
      try {
        const res = await fetch(`${DEFAULT_DATA_DIR}/${fileName}`);
        if (!res.ok) {
          console.warn(`Default file not found: ${fileName} (${res.status})`);
          return;
        }
        const buffer = await res.arrayBuffer();
        const result = parseBuffer(buffer, fileName);
        if (result.candles.length > 0) {
          results.push({ result, fileName });
        }
      } catch (err) {
        console.warn(`Failed to load default file ${fileName}:`, err);
      }
    }),
  );

  // Sort by symbol name for a clean dropdown order.
  results.sort((a, b) =>
    (a.result.symbol || a.fileName).localeCompare(b.result.symbol || b.fileName),
  );

  return results;
}
