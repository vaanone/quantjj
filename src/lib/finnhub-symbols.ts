// Maps Vaan.One symbol names to Finnhub API symbol identifiers.
// Finnhub uses the OANDA: prefix for forex pairs on their free tier.

const FINNHUB_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "OANDA:XAU_USD",
  EURUSD: "OANDA:EUR_USD",
  GBPUSD: "OANDA:GBP_USD",
  USDCHF: "OANDA:USD_CHF",
  // Crypto (free WebSocket tier)
  BTCUSD: "BINANCE:BTCUSDT",
};

/**
 * Converts a Vaan.One symbol (e.g. "XAUUSD") to the Finnhub API symbol
 * (e.g. "OANDA:XAU_USD"). Returns null if the symbol is not supported.
 */
export function toFinnhubSymbol(symbol: string): string | null {
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return FINNHUB_SYMBOL_MAP[clean] ?? null;
}

/**
 * Checks if a symbol is supported for live streaming.
 */
export function isLiveSupported(symbol: string): boolean {
  return toFinnhubSymbol(symbol) !== null;
}
