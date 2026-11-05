"use client";

import { useEffect, useState } from "react";

interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  timeUtc: string;
  timeIst: string;
  dateLabel: string;
  impactStars: number;
  impactLabel: "Low" | "Medium" | "High" | "Holiday";
  forecast: string;
  previous: string;
  isToday: boolean;
  isPast: boolean;
}

interface CalendarResponse {
  events: CalendarEvent[];
  todayIst: string;
  source: string;
  fetchedAt: string;
}

const COUNTRY_FLAG: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  AUD: "🇦🇺",
  CAD: "🇨🇦",
  CHF: "🇨🇭",
  CNY: "🇨🇳",
  NZD: "🇳🇿",
};

/**
 * Economic Calendar — Forex Factory style.
 *
 * Shows today's HIGH-impact (3-star) USD events and the next few upcoming
 * USD high-impact events. Data comes from our /api/economic-calendar route
 * which proxies the free Forex Factory fair-economy JSON feed.
 *
 * Style: dark NOC dashboard card with neon accents, horizontally scrollable
 * so it can sit right under the price ticker without taking much vertical
 * space.
 */
export function EconomicCalendar() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchEvents = async () => {
      try {
        const res = await fetch("/api/economic-calendar", { cache: "no-store" });
        if (!res.ok) return;
        const json: CalendarResponse = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEvents();
    // Refresh every 5 minutes — events don't change often and the upstream
    // is rate-limited.
    const interval = setInterval(fetchEvents, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Skeleton while loading
  if (loading) {
    return (
      <div className="border-y border-white/10 bg-[#0D141B] py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#75D380]/60">
            Economic Calendar
          </span>
          <div className="h-3 flex-1 animate-pulse rounded bg-white/5" />
        </div>
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="border-y border-white/10 bg-[#0D141B] py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#75D380]/60">
            Economic Calendar
          </span>
          <span className="font-mono text-xs text-white/40">
            No upcoming US high-impact events this week
          </span>
        </div>
      </div>
    );
  }

  const todayCount = events.filter((e) => e.isToday).length;

  return (
    <div className="border-y border-white/10 bg-[#0D141B]">
      {/* Header row — wraps to second line on mobile */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-y-1 px-4 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#75D380]">
            Economic Calendar
          </span>
          <span className="font-mono text-[10px] text-white/40">·</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            US 3 ★ High Impact
          </span>
        </div>
        <div className="flex items-center gap-2">
          {todayCount > 0 && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-red-400">
              {todayCount} TODAY
            </span>
          )}
          <span className="font-mono text-[10px] text-white/30">
            IST · Source: Forex Factory
          </span>
        </div>
      </div>

      {/* Event list — stacks vertically on mobile, horizontal scroll on sm+ */}
      <div className="overflow-x-auto px-4 pb-2.5 pt-2 sm:block">
        <div className="flex flex-col gap-2 sm:flex sm:w-max sm:min-w-full sm:flex-row sm:gap-2">
          {events.map((e) => {
            const flag = COUNTRY_FLAG[e.country] ?? "🏳";
            const impactColor =
              e.impactLabel === "High"
                ? "text-red-400"
                : e.impactLabel === "Medium"
                  ? "text-amber-400"
                  : "text-white/50";
            const stars = "★".repeat(Math.max(1, e.impactStars));

            return (
              <div
                key={e.id}
                className={`group relative flex flex-col gap-1 rounded-md border px-3 py-2 transition-colors sm:min-w-[230px] sm:max-w-[260px] ${
                  e.isToday
                    ? "border-red-500/40 bg-red-500/5"
                    : e.isPast
                      ? "border-white/5 bg-white/[0.02] opacity-60"
                      : "border-white/10 bg-white/[0.03] hover:border-[#75D380]/30 hover:bg-[#75D380]/[0.04]"
                }`}
              >
                {/* Top row: time + date + stars */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-[#60D2D5]">
                      {e.timeIst}
                    </span>
                    <span
                      className={`rounded px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide ${
                        e.dateLabel === "Today"
                          ? "bg-red-500/20 text-red-300"
                          : e.dateLabel === "Tomorrow"
                            ? "bg-[#75D380]/15 text-[#75D380]"
                            : "bg-white/5 text-white/50"
                      }`}
                    >
                      {e.dateLabel}
                    </span>
                  </div>
                  <span className={`font-mono text-[10px] leading-none ${impactColor}`}>
                    {stars}
                  </span>
                </div>

                {/* Title row */}
                <div className="flex items-start gap-1.5">
                  <span className="text-sm leading-none">{flag}</span>
                  <span className="text-xs font-semibold leading-tight text-white/90">
                    {e.title}
                  </span>
                </div>

                {/* Forecast / Previous */}
                <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px]">
                  <span className="text-white/40">
                    F:{" "}
                    <span className={e.forecast ? "text-[#75D380]" : "text-white/30"}>
                      {e.forecast || "—"}
                    </span>
                  </span>
                  <span className="text-white/40">
                    P:{" "}
                    <span className={e.previous ? "text-white/70" : "text-white/30"}>
                      {e.previous || "—"}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}

          {/* Trailing helper chip — hidden on mobile, full-width row instead */}
          <div className="flex min-w-[140px] items-center justify-center rounded-md border border-dashed border-white/10 px-3 py-2 sm:flex">
            <span className="font-mono text-[10px] text-white/30">
              {todayCount > 0
                ? `${todayCount} today · ${events.length - todayCount} upcoming`
                : `${events.length} upcoming`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
