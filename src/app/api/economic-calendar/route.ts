import { NextResponse } from "next/server";

/**
 * Economic Calendar — FREE feed.
 *
 * Source: Forex Factory's public fair-economy JSON feed
 *   https://nfs.faireconomy.media/ff_calendar_thisweek.json
 *
 * This is the same JSON the official Forex Factory news widget uses.
 * It is free, requires no API key, and is updated continuously.
 *
 * We fetch server-side because:
 *   1. The endpoint rate-limits requests without a proper Referer header.
 *   2. CORS is not enabled, so the browser cannot call it directly.
 *
 * The route returns today's HIGH-impact (3-star) USD events plus a small
 * look-ahead of upcoming USD high-impact events so the panel never looks
 * empty if today's calendar is light.
 */

export const dynamic = "force-dynamic";
export const revalidate = 300; // cache for 5 minutes

interface FFEvent {
  title: string;
  country: string;
  date: string; // ISO 8601, e.g. "2026-11-05T13:30:00-05:00"
  impact: "Low" | "Medium" | "High" | "Holiday" | "Non-Economic" | string;
  forecast: string;
  previous: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  // ISO string of the event time (UTC)
  timeUtc: string;
  // Local IST time string, e.g. "02:30 PM"
  timeIst: string;
  // IST date label e.g. "Today", "Tomorrow", "Nov 06"
  dateLabel: string;
  // 0=Low 1=Medium 2=High 3=Holiday
  impactStars: number;
  impactLabel: "Low" | "Medium" | "High" | "Holiday";
  forecast: string;
  previous: string;
  isToday: boolean;
  isPast: boolean;
}

const IMPACT_RANK: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
  Holiday: 0,
  "Non-Economic": 0,
};

/** IST offset = +5:30. We hard-code this because the sandbox may not
 *  ship full TZ data, and we never need DST handling for IST (it has none). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIstParts(iso: string) {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1, // 1-12
    day: ist.getUTCDate(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
  };
}

function formatIstTime(iso: string): string {
  const { hours, minutes } = toIstParts(iso);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mm = minutes.toString().padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

function dateLabel(
  iso: string,
  todayIstParts: { year: number; month: number; day: number },
): string {
  const e = toIstParts(iso);
  if (
    e.year === todayIstParts.year &&
    e.month === todayIstParts.month &&
    e.day === todayIstParts.day
  ) {
    return "Today";
  }
  // Tomorrow
  const t = new Date(
    Date.UTC(todayIstParts.year, todayIstParts.month - 1, todayIstParts.day),
  );
  t.setUTCDate(t.getUTCDate() + 1);
  if (
    e.year === t.getUTCFullYear() &&
    e.month === t.getUTCMonth() + 1 &&
    e.day === t.getUTCDate()
  ) {
    return "Tomorrow";
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[e.month - 1]} ${e.day.toString().padStart(2, "0")}`;
}

export async function GET() {
  try {
    const res = await fetch(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Referer: "https://www.forexfactory.com/",
          Accept: "application/json,text/plain,*/*",
        },
        next: { revalidate: 300 },
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { events: [], error: `Upstream ${res.status}`, source: "forex-factory" },
        { status: 200 },
      );
    }

    const raw: FFEvent[] = await res.json();
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { events: [], error: "Bad payload", source: "forex-factory" },
        { status: 200 },
      );
    }

    // Today's date in IST (server runs in UTC; we shift by +5:30).
    const nowUtc = Date.now();
    const nowIst = new Date(nowUtc + IST_OFFSET_MS);
    const todayIstParts = {
      year: nowIst.getUTCFullYear(),
      month: nowIst.getUTCMonth() + 1,
      day: nowIst.getUTCDate(),
    };

    // Start of "today" in IST, expressed as a UTC ms timestamp.
    const todayStartUtcMs =
      Date.UTC(todayIstParts.year, todayIstParts.month - 1, todayIstParts.day) -
      IST_OFFSET_MS;
    // End = +36 hours so we still show "today" events that happen late IST.
    const todayEndUtcMs = todayStartUtcMs + 36 * 60 * 60 * 1000;

    const events: (CalendarEvent & { _timeMs: number })[] = raw
      .filter((e) => e && e.date && e.country && e.impact)
      .map((e) => {
        const timeMs = new Date(e.date).getTime();
        const isToday = timeMs >= todayStartUtcMs && timeMs < todayEndUtcMs;
        const impactLabel: CalendarEvent["impactLabel"] = (
          ["High", "Medium", "Low", "Holiday"].includes(e.impact)
            ? (e.impact as "High" | "Medium" | "Low" | "Holiday")
            : "Low"
        );
        return {
          id: `${e.country}-${e.date}-${e.title}`.replace(/\s+/g, "_"),
          title: e.title,
          country: e.country,
          timeUtc: e.date,
          timeIst: formatIstTime(e.date),
          dateLabel: dateLabel(e.date, todayIstParts),
          impactStars: IMPACT_RANK[e.impact] ?? 0,
          impactLabel,
          forecast: e.forecast ?? "",
          previous: e.previous ?? "",
          isToday,
          isPast: timeMs < nowUtc,
          _timeMs: timeMs,
        };
      });

    // Strategy:
    //   - If today has high-impact USD events, show all of them plus the next
    //     5 upcoming USD high-impact events.
    //   - Otherwise show the next 8 upcoming USD high-impact events.
    const usdHighToday = events.filter(
      (e) => e.country === "USD" && e.impactLabel === "High" && e.isToday,
    );

    let selected: (CalendarEvent & { _timeMs: number })[];

    if (usdHighToday.length > 0) {
      const upcoming = events
        .filter(
          (e) =>
            e.country === "USD" &&
            e.impactLabel === "High" &&
            !e.isToday &&
            e._timeMs >= nowUtc,
        )
        .sort((a, b) => a._timeMs - b._timeMs)
        .slice(0, 5);
      selected = [...usdHighToday, ...upcoming];
    } else {
      selected = events
        .filter(
          (e) =>
            e.country === "USD" &&
            e.impactLabel === "High" &&
            e._timeMs >= nowUtc,
        )
        .sort((a, b) => a._timeMs - b._timeMs)
        .slice(0, 8);
    }

    // Sort the final list by event time, then strip the internal _timeMs field.
    const cleaned: CalendarEvent[] = selected
      .sort((a, b) => a._timeMs - b._timeMs)
      .map(({ _timeMs, ...publicFields }) => publicFields);

    return NextResponse.json(
      {
        events: cleaned,
        todayIst: `${todayIstParts.year}-${todayIstParts.month
          .toString()
          .padStart(2, "0")}-${todayIstParts.day.toString().padStart(2, "0")}`,
        source: "forex-factory",
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { events: [], error: String(err), source: "forex-factory" },
      { status: 200 },
    );
  }
}
