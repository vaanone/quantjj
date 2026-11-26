import { NextResponse } from "next/server";
import {
  API_URL,
  RAW_URL,
  SRLevel,
  checkAdminPassword,
  getGithubToken,
  makeId,
  readWithSha,
  sortLevels,
  writeWithSha,
} from "@/lib/sr-store";

// Storage: the S/R levels are kept as data/sr-levels.json in the repo itself
// (shared layer in src/lib/sr-store.ts, also used by the daily reset cron).
// - READ (GET): public, no password — the homepage shows the same data.
//   If GITHUB_TOKEN is set we use the Contents API for a guaranteed fresh copy
//   (raw.githubusercontent.com CDN-caches for ~5 min), otherwise the raw file.
// - WRITE (POST/DELETE): requires the admin password (checked against a
//   salted SHA-256 hash — the password itself is never stored in the repo) and
//   commits the updated JSON to main via the Contents API.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse a level value: missing/empty → null (level not set yet), otherwise a
// finite number. Anything unparseable is treated as not set.
function toOptNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanEntry(input: Record<string, unknown>): SRLevel {
  const date = String(input.date ?? "");
  const symbol = String(input.symbol ?? "").toUpperCase().trim();
  const id = String(input.id ?? "") || makeId(date, symbol);
  return {
    id,
    date,
    symbol,
    support1: toOptNum(input.support1),
    resistance1: toOptNum(input.resistance1),
    support2: toOptNum(input.support2),
    resistance2: toOptNum(input.resistance2),
    support3: toOptNum(input.support3),
    resistance3: toOptNum(input.resistance3),
  };
}

// GET: return the current levels array.
export async function GET() {
  try {
    const t = getGithubToken();
    let jsonText: string;
    if (t) {
      // Fresh read via the Contents API (no CDN cache).
      const res = await fetch(API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "quantjj-sr-api",
          Authorization: `Bearer ${t}`,
        },
        cache: "no-store",
      });
      if (res.status === 404) return NextResponse.json([]);
      if (!res.ok) return NextResponse.json({ error: `GitHub read ${res.status}` }, { status: 502 });
      const data = await res.json();
      const b64 = String(data.content || "").replace(/\n/g, "");
      jsonText = Buffer.from(b64, "base64").toString("utf8");
    } else {
      // Public raw read (may be CDN-cached up to ~5 min after a save).
      const res = await fetch(`${RAW_URL}?_=${Date.now()}`, { cache: "no-store" });
      if (res.status === 404) return NextResponse.json([]);
      if (!res.ok) return NextResponse.json({ error: `raw fetch ${res.status}` }, { status: 502 });
      jsonText = await res.text();
    }
    let levels: SRLevel[] = [];
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) levels = parsed;
    } catch {
      levels = [];
    }
    return NextResponse.json(levels, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST: upsert an entry (add or update by date + symbol). Requires password.
export async function POST(request: Request) {
  try {
    if (!checkAdminPassword(request.headers.get("x-admin-password"))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const entry = cleanEntry(body as Record<string, unknown>);
    if (!entry.date || !entry.symbol) {
      return NextResponse.json({ error: "date and symbol are required" }, { status: 400 });
    }
    const { levels, sha } = await readWithSha();
    const idx = levels.findIndex(
      (l) => l.id === entry.id || (l.date === entry.date && l.symbol === entry.symbol),
    );
    if (idx >= 0) levels[idx] = entry;
    else levels.push(entry);
    sortLevels(levels);
    await writeWithSha(levels, sha, `Update S/R levels: ${entry.symbol} ${entry.date}`);
    return NextResponse.json({ ok: true, entry, count: levels.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE: remove an entry by id, or by date+symbol. Requires password.
export async function DELETE(request: Request) {
  try {
    if (!checkAdminPassword(request.headers.get("x-admin-password"))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id") || "";
    const date = searchParams.get("date") || "";
    const symbol = (searchParams.get("symbol") || "").toUpperCase();
    if (!id && date && symbol) id = makeId(date, symbol);
    if (!id) {
      return NextResponse.json({ error: "id (or date + symbol) is required" }, { status: 400 });
    }
    const { levels, sha } = await readWithSha();
    const next = levels.filter(
      (l) => l.id !== id && !(l.date === date && l.symbol === symbol),
    );
    if (next.length === levels.length) {
      return NextResponse.json({ ok: false, error: "entry not found" }, { status: 404 });
    }
    await writeWithSha(next, sha, `Delete S/R level ${id}`);
    return NextResponse.json({ ok: true, count: next.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
