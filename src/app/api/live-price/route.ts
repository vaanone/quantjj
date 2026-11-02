import { NextResponse } from "next/server";

// Yahoo Finance → Vaan.One symbol mapping.
const YAHOO_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "GC=F",      // Gold futures (closest to spot gold on Yahoo)
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDCHF: "USDCHF=X",
};

/**
 * Fetches the latest price for a symbol from Yahoo Finance.
 * Server-side proxy to avoid CORS issues.
 *
 * Query params:
 *   symbol — Vaan.One symbol (e.g. "XAUUSD", "EURUSD")
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json({ error: "Missing parameter: symbol" }, { status: 400 });
  }

  const yahooSymbol = YAHOO_SYMBOL_MAP[symbol.toUpperCase().replace(/[^A-Z]/g, "")];
  if (!yahooSymbol) {
    return NextResponse.json({ error: `Unsupported symbol: ${symbol}` }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: "No data from Yahoo" }, { status: 404 });
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return NextResponse.json({
      symbol,
      yahooSymbol,
      price,
      prevClose,
      change,
      changePct,
      timestamp: meta.regularMarketTime * 1000,
      marketState: meta.marketState ?? "REGULAR",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed: ${msg}` }, { status: 500 });
  }
}
