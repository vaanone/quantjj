"use client";

import { TrendingUp, TrendingDown, Activity, ArrowLeftRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { SRLevel } from "@/lib/support-resistance";
import type { Candle } from "@/lib/excel-parser";

interface SRPanelProps {
  levels: SRLevel[];
  visible: Set<number>;
  onToggle: (idx: number) => void;
  onToggleAll: (on: boolean) => void;
  // Detection settings
  sensitivity: number; // 0-100, mapped to leftBars/rightBars
  tolerancePct: number; // 0.05-0.5
  onSensitivityChange: (v: number) => void;
  onToleranceChange: (v: number) => void;
  candles: Candle[];
  fileName: string;
}

export function SRPanel({
  levels,
  visible,
  onToggle,
  onToggleAll,
  sensitivity,
  tolerancePct,
  onSensitivityChange,
  onToleranceChange,
  candles,
  fileName,
}: SRPanelProps) {
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;

  const supports = levels.filter((l) => l.type === "support");
  const resistances = levels.filter((l) => l.type === "resistance");
  const allOn = levels.length > 0 && visible.size === levels.length;

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto bg-[#0c0d12] p-4 text-white">
      {/* File summary */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
            Data Source
          </h2>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-white/50">File</span>
            <span className="max-w-[180px] truncate font-mono text-white/90" title={fileName}>
              {fileName || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Candles</span>
            <span className="font-mono text-white/90">{candles.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Last Close</span>
            <span className="font-mono text-emerald-400">
              {lastClose > 0 ? fmt(lastClose) : "—"}
            </span>
          </div>
        </div>
      </section>

      {/* Detection settings */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/60">
          <Activity className="h-3.5 w-3.5" />
          S/R Detection
        </h2>

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-[11px] text-white/70">Sensitivity (pivot window)</Label>
              <span className="font-mono text-[11px] text-white/60">
                {sensitivityToBars(sensitivity)} bars
              </span>
            </div>
            <Slider
              value={[sensitivity]}
              onValueChange={(v) => onSensitivityChange(v[0])}
              min={10}
              max={90}
              step={5}
            />
            <p className="mt-1 text-[10px] text-white/40">
              Higher = fewer, stronger levels. Lower = more, weaker levels.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-[11px] text-white/70">Cluster Tolerance</Label>
              <span className="font-mono text-[11px] text-white/60">
                {tolerancePct.toFixed(2)}%
              </span>
            </div>
            <Slider
              value={[tolerancePct * 100]}
              onValueChange={(v) => onToleranceChange(v[0] / 100)}
              min={5}
              max={50}
              step={1}
            />
            <p className="mt-1 text-[10px] text-white/40">
              How close two pivots must be to merge into one level.
            </p>
          </div>
        </div>
      </section>

      {/* Levels list */}
      <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/60">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Levels ({levels.length})
          </h2>
          {levels.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleAll(!allOn)}
              className="h-6 px-2 text-[10px] text-white/60 hover:text-white"
            >
              {allOn ? "Hide all" : "Show all"}
            </Button>
          )}
        </div>

        {/* Resistances first (above current price) */}
        <LevelGroup
          label="Resistance (above)"
          icon={<TrendingUp className="h-3 w-3" />}
          color="text-amber-400"
          levels={resistances}
          fullLevels={levels}
          visible={visible}
          lastClose={lastClose}
          onToggle={onToggle}
        />

        <div className="my-2 h-px bg-white/5" />

        {/* Supports (below current price) */}
        <LevelGroup
          label="Support (below)"
          icon={<TrendingDown className="h-3 w-3" />}
          color="text-emerald-400"
          levels={supports}
          fullLevels={levels}
          visible={visible}
          lastClose={lastClose}
          onToggle={onToggle}
        />

        {levels.length === 0 && (
          <p className="py-6 text-center text-xs text-white/40">
            No levels detected. Try lowering sensitivity or upload more data.
          </p>
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-white/30">
        Levels are detected via swing-pivot fractals (left/right window) and clustered by price
        tolerance. Strength combines touch count, recency, and whether the level has acted as both
        support and resistance.
      </p>
    </aside>
  );
}

interface LevelGroupProps {
  label: string;
  icon: React.ReactNode;
  color: string;
  levels: SRLevel[];
  fullLevels: SRLevel[];
  visible: Set<number>;
  lastClose: number;
  onToggle: (idx: number) => void;
}

function LevelGroup({
  label,
  icon,
  color,
  levels,
  fullLevels,
  visible,
  lastClose,
  onToggle,
}: LevelGroupProps) {
  if (levels.length === 0) {
    return (
      <div>
        <p className={`mb-1 text-[10px] font-medium uppercase ${color}`}>{label}</p>
        <p className="py-2 text-center text-[10px] text-white/30">none</p>
      </div>
    );
  }
  return (
    <div>
      <p className={`mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase ${color}`}>
        {icon}
        {label}
      </p>
      <div className="space-y-1">
        {levels.map((level) => {
          const idx = fullLevels.indexOf(level);
          const isVisible = visible.has(idx);
          const distPct = lastClose
            ? ((level.price - lastClose) / lastClose) * 100
            : 0;
          return (
            <div
              key={`${idx}-${level.price}`}
              className={`
                flex items-center justify-between gap-2 rounded-md border px-2 py-1.5
                transition-colors
                ${isVisible
                  ? level.type === "resistance"
                    ? "border-amber-500/30 bg-amber-500/[0.06]"
                    : "border-emerald-500/30 bg-emerald-500/[0.06]"
                  : "border-white/5 bg-white/[0.01]"}
              `}
            >
              <div className="flex flex-col">
                <span className="font-mono text-[12px] font-medium text-white">
                  {fmt(level.price)}
                </span>
                <span className="text-[10px] text-white/40">
                  {level.touches} touch{level.touches !== 1 ? "es" : ""} · strength{" "}
                  {level.strength}
                  {level.flipped && " · flipped"}
                  {lastClose > 0 && (
                    <>
                      {" · "}
                      <span
                        className={
                          level.type === "resistance" ? "text-amber-400/70" : "text-emerald-400/70"
                        }
                      >
                        {distPct >= 0 ? "+" : ""}
                        {distPct.toFixed(2)}%
                      </span>
                    </>
                  )}
                </span>
              </div>
              <Switch checked={isVisible} onCheckedChange={() => onToggle(idx)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sensitivityToBars(s: number): number {
  // Map 10..90 to 10..1 (higher sensitivity = smaller window = more pivots).
  return Math.max(1, Math.round(10 - (s / 100) * 9));
}

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}
