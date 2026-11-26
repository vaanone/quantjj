import { NextResponse } from "next/server";
import {
  SRLevel,
  checkAdminPassword,
  makeId,
  readWithSha,
  sortLevels,
  writeWithSha,
} from "@/lib/sr-store";

// Daily auto-reset of the S/R levels (Vercel Cron — see vercel.json,
// 19:30 UTC = 1:00 AM IST). "Reset" means every level becomes 0, which the
// homepage and admin treat as "pending" (—) until new levels are entered.
//
// Two modes:
//  - CRON (plain GET/POST, no ?force): for every known symbol, make sure an
//    entry for TODAY (IST) exists, creating it with all levels at 0 when the
//    latest entry is from an earlier day. Existing entries are never touched,
//    so levels the user already entered for today stay intact.
//  - MANUAL (?force=1 + admin password): "reset now" — zero the latest entry
//    in place when it is dated today (or in the future); otherwise roll to a
//    fresh all-0 entry for today. Older dated entries stay as history.
//
// Auth: Vercel Cron sends "Authorization: Bearer $CRON_SECRET" once that env
// var is set in the Vercel project. We accept that or the admin password.
// When CRON_SECRET is NOT configured, unauthenticated cron-mode calls are
// allowed (that mode is idempotent and cannot destroy entered levels), so
// the scheduled job works out of the box; force mode always requires either
// the secret or the admin password.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVEL_KEYS = [
  "support1",
  "resistance1",
  "support2",
  "resistance2",
  "support3",
  "resistance3",
] as const;

// "Today" in the user's trading timezone (IST), as YYYY-MM-DD.
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function zeroEntry(date: string, symbol: string): SRLevel {
  return {
    id: makeId(date, symbol),
    date,
    symbol,
    support1: 0,
    resistance1: 0,
    support2: 0,
    resistance2: 0,
    support3: 0,
    resistance3: 0,
  };
}

function isAuthorized(request: Request, force: boolean): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (checkAdminPassword(request.headers.get("x-admin-password"))) return true;
  // No secret configured → let the scheduled cron-mode call through (it only
  // creates missing all-0 entries for today; it never overwrites anything).
  if (!secret && !force) return true;
  return false;
}

async function runReset(force: boolean) {
  const today = istToday();
  const { levels, sha } = await readWithSha();

  // Latest entry per symbol (highest date).
  const latestPerSymbol = new Map<string, SRLevel>();
  for (const l of levels) {
    const cur = latestPerSymbol.get(l.symbol);
    if (!cur || l.date > cur.date) latestPerSymbol.set(l.symbol, l);
  }

  const created: string[] = [];
  const zeroed: string[] = [];
  for (const symbol of Array.from(latestPerSymbol.keys()).sort()) {
    const latest = latestPerSymbol.get(symbol)!;
    if (latest.date < today) {
      // No entry for today yet → start a fresh all-0 one (history stays).
      levels.push(zeroEntry(today, symbol));
      created.push(symbol);
    } else if (force && LEVEL_KEYS.some((k) => latest[k] !== 0)) {
      // Manual reset: wipe the current (today's or newer) levels to 0.
      for (const k of LEVEL_KEYS) latest[k] = 0;
      zeroed.push(symbol);
    }
  }

  if (created.length > 0 || zeroed.length > 0) {
    sortLevels(levels);
    await writeWithSha(
      levels,
      sha,
      force
        ? `Manual reset: all S/R levels to 0 (${today})`
        : `Daily reset: new-day 0 levels (${today})`,
    );
  }

  return {
    ok: true,
    mode: force ? "manual" : "cron",
    date: today,
    symbols: latestPerSymbol.size,
    created,
    zeroed,
    committed: created.length + zeroed.length > 0,
  };
}

async function handle(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    if (!isAuthorized(request, force)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runReset(force));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
