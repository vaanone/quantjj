"use client";

/**
 * Animated trading visualization card — eye-catching mini dashboard
 * with floating candlesticks, glowing price line, S/R levels,
 * particle effects, and live-style animations.
 */
export function TradingVisualCard() {
  // Generate animated candlestick data
  const candles = [
    { h: 60, up: true }, { h: 45, up: false }, { h: 75, up: true },
    { h: 50, up: false }, { h: 85, up: true }, { h: 55, up: false },
    { h: 90, up: true }, { h: 65, up: false }, { h: 70, up: true },
    { h: 40, up: false }, { h: 80, up: true }, { h: 50, up: false },
    { h: 95, up: true }, { h: 60, up: false }, { h: 100, up: true },
  ];

  return (
    <div className="shimmer-border relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#0d0a00] via-[#100c00] to-[#0a0800] backdrop-blur-sm">
      {/* Glowing animated background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-pulse-glow absolute left-1/4 top-1/4 h-32 w-32 rounded-full bg-amber-500/8 blur-[60px]" />
        <div className="animate-float-slow absolute right-1/4 bottom-1/4 h-40 w-40 rounded-full bg-red-600/5 blur-[70px]" />
      </div>

      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-amber-500/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Vaan.One" className="h-6 w-6 rounded object-contain" />
          <div>
            <span className="font-mono text-sm font-bold text-white">XAUUSD</span>
            <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400">LIVE CHART</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-sm font-bold text-amber-400">2,400.50</span>
        </div>
      </div>

      {/* Chart body */}
      <div className="relative h-44 px-4 py-3">
        {/* S/R level lines */}
        <div className="absolute left-4 right-4 top-6 flex items-center gap-2">
          <span className="font-mono text-[8px] font-bold text-emerald-400">R</span>
          <div className="h-px flex-1" style={{ borderTop: "1px dashed #22c55e60" }} />
          <span className="font-mono text-[8px] text-emerald-400/50">2,410</span>
        </div>
        <div className="absolute left-4 right-4 bottom-8 flex items-center gap-2">
          <span className="font-mono text-[8px] font-bold text-red-400">S</span>
          <div className="h-px flex-1" style={{ borderTop: "1px dashed #ef444460" }} />
          <span className="font-mono text-[8px] text-red-400/50">2,390</span>
        </div>

        {/* Animated candlestick bars */}
        <div className="absolute bottom-3 left-4 right-4 flex h-32 items-end justify-between gap-1">
          {candles.map((c, i) => (
            <div key={i} className="relative flex h-full flex-1 items-end justify-center">
              {/* Wick */}
              <div
                className="absolute w-px bg-white/20"
                style={{
                  height: `${c.h + 15}%`,
                  bottom: 0,
                }}
              />
              {/* Body */}
              <div
                className="animate-bar-rise w-full rounded-sm"
                style={{
                  height: `${c.h}%`,
                  backgroundColor: c.up ? "#22c55e" : "#ef4444",
                  boxShadow: c.up
                    ? "0 0 8px rgba(34,197,94,0.4)"
                    : "0 0 8px rgba(239,68,68,0.4)",
                  animationDelay: `${i * 0.08}s`,
                  opacity: 0.85,
                }}
              />
            </div>
          ))}
        </div>

        {/* Glowing price line overlay */}
        <svg className="absolute bottom-3 left-4 right-4 h-32 w-auto" preserveAspectRatio="none" viewBox="0 0 300 120">
          <defs>
            <linearGradient id="glowLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0" />
              <stop offset="50%" stopColor="#d4af37" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="1" />
            </linearGradient>
            <filter id="goldGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d="M0,80 Q30,70 60,65 T120,50 T180,45 T240,30 T300,20"
            fill="none"
            stroke="url(#glowLine)"
            strokeWidth="2"
            filter="url(#goldGlow)"
            className="animate-draw-line"
          />
        </svg>

        {/* Floating particles */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="animate-float-slow absolute rounded-full bg-amber-400/20"
            style={{
              width: `${3 + Math.random() * 4}px`,
              height: `${3 + Math.random() * 4}px`,
              left: `${15 + i * 14}%`,
              top: `${20 + Math.random() * 50}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${4 + Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="relative flex items-center justify-between border-t border-amber-500/10 px-5 py-3">
        <div className="flex gap-5">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-white/50">Resistance</span>
            <span className="font-mono text-[10px] font-bold text-emerald-400">2,410</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="text-[10px] text-white/50">Support</span>
            <span className="font-mono text-[10px] font-bold text-red-400">2,390</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/30">M15</span>
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400">
            PIVOT
          </span>
        </div>
      </div>
    </div>
  );
}
