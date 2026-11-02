"use client";

import { useEffect, useState } from "react";

interface SymbolPrice {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
}

/**
 * Scrolling price ticker for the landing page.
 * Shows all 4 symbols (XAUUSD, EURUSD, GBPUSD, USDCHF) with their
 * closing price and daily change % — scrolls continuously.
 *
 * Data is fetched from our /api/prices endpoint (Yahoo Finance proxy).
 */
export function PriceTicker() {
  const [symbols, setSymbols] = useState<SymbolPrice[]>([]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch("/api/prices");
        if (!res.ok) return;
        const data = await res.json();
        if (data.symbols && data.symbols.length > 0) {
          setSymbols(data.symbols);
        }
      } catch {
        // ignore
      }
    };

    fetchPrices();
    // Refresh every 30 seconds.
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  if (symbols.length === 0) return null;

  // Duplicate the list so the scroll loops seamlessly.
  const displayList = [...symbols, ...symbols];

  return (
    <div className="overflow-hidden border-y border-white/10 bg-[#0d0a00] py-3">
      <div className="flex w-max animate-ticker items-center gap-8">
        {displayList.map((s, i) => {
          const isPositive = s.changePct >= 0;
          const color = isPositive ? "text-emerald-400" : "text-red-400";
          const arrow = isPositive ? "▲" : "▼";

          return (
            <div key={i} className="flex items-center gap-3 whitespace-nowrap">
              <span className="font-mono text-sm font-bold text-white">
                {s.symbol}
              </span>
              <span className="font-mono text-sm text-white/60">
                {s.price >= 1000 ? s.price.toFixed(2) : s.price.toFixed(5)}
              </span>
              <span className={`font-mono text-xs font-semibold ${color}`}>
                {arrow} {Math.abs(s.changePct).toFixed(2)}%
              </span>
              <span className="text-white/20">|</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
