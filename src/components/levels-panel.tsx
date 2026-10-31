"use client";

import type { SRLine } from "@/lib/support-resistance";

interface LevelsPanelProps {
  lines: SRLine[];
  lastClose: number;
  fileName: string;
  symbol: string;
}

/**
 * Simplified levels panel — shows ONLY the top-6 S/R values:
 *   Resistance I, Support I, Resistance II, Support II, Resistance III, Support III
 *
 * No detection settings, no toggles, no touch counts or strength scores.
 * The lines list arrives pre-sorted as [R I, S I, R II, S II, R III, S III]
 * (skipping any tier that wasn't detected).
 */
export function LevelsPanel({ lines, lastClose, fileName, symbol }: LevelsPanelProps) {
  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto bg-[#0c0d12] p-4 text-white">
      {/* Compact file summary */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Active Symbol
        </h2>
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-white/50">File</span>
            <span className="max-w-[180px] truncate font-mono text-white/90" title={fileName}>
              {fileName || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Symbol</span>
            <span className="font-mono text-white/90">{symbol || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Last Close</span>
            <span className="font-mono text-white">
              {lastClose > 0 ? fmt(lastClose) : "—"}
            </span>
          </div>
        </div>
      </section>

      {/* The 6 S/R levels — Resistance I, Support I, Resistance II, ... */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
          Support &amp; Resistance
        </h2>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/40">
            No levels detected for this data.
          </p>
        ) : (
          <div className="space-y-1.5">
            {lines.map((line, idx) => {
              const isResistance = line.type === "resistance";
              const distPct = lastClose > 0
                ? ((line.price - lastClose) / lastClose) * 100
                : 0;
              return (
                <div
                  key={`${line.label}-${idx}`}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    isResistance
                      ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                      : "border-red-500/30 bg-red-500/[0.06]"
                  }`}
                >
                  <span
                    className={`text-xs font-semibold ${
                      isResistance ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {line.fullLabel}
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-medium text-white">
                      {fmt(line.price)}
                    </span>
                    {lastClose > 0 && (
                      <span
                        className={`font-mono text-[10px] ${
                          isResistance ? "text-emerald-400/60" : "text-red-400/60"
                        }`}
                      >
                        {distPct >= 0 ? "+" : ""}
                        {distPct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-white/30">
        Showing only the 3 nearest resistances (green) and 3 nearest supports (red) to the
        current price. Tier I is the closest, III is the farthest.
      </p>
    </aside>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}
