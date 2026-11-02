import { NextResponse } from "next/server";

const YAHOO_SYMBOLS: Record<string, string> = {
  XAUUSD: "GC=F",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDCHF: "USDCHF=X",
};

/**
 * Fetches prices for ALL supported symbols in one request.
 * Returns an array of { symbol, price, change, changePct }.
 */
export async function GET() {
  const results = [];

  for (const [symbol, yahooSymbol] of Object.entries(YAHOO_SYMBOLS)) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2d`,
        { headers: { "User-Agent": "Mozilla/5.0" } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      results.push({ symbol, price, change, changePct });
    } catch {
      // skip failed symbol
    }
  }

  return NextResponse.json({ symbols: results });
}
