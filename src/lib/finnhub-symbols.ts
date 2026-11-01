// Checks if a symbol is supported for live price streaming via Yahoo Finance.
const SUPPORTED_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDCHF"];

export function isLiveSupported(symbol: string): boolean {
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return SUPPORTED_SYMBOLS.includes(clean);
}
