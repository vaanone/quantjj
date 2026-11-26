import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { ADMIN_SALT, ADMIN_PW_HASH } from "@/lib/admin-auth";

// Storage: the S/R levels are kept as data/sr-levels.json in the repo itself.
// - READ (GET): public, no password — the homepage shows the same data.
//   If GITHUB_TOKEN is set we use the Contents API for a guaranteed fresh copy
//   (raw.githubusercontent.com CDN-caches for ~5 min), otherwise the raw file.
// - WRITE (POST/DELETE): requires the admin password (checked against a
//   salted SHA-256 hash — the password itself is never stored in the repo) and
//   uses the GitHub Contents API, which requires a Personal Access Token
//   stored in the GITHUB_TOKEN env var (set once in the Vercel project
//   settings). Each save commits the updated JSON to main.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = "vaanone/quantjj";
const BRANCH = "main";
const FILE_PATH = "data/sr-levels.json";
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE_PATH}`;
const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

export interface SRLevel {
  id: string;
  date: string;
  symbol: string;
  support1: number | null;
  resistance1: number | null;
  support2: number | null;
  resistance2: number | null;
  support3: number | null;
  resistance3: number | null;
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

function apiHeaders(auth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "quantjj-sr-api",
  };
  if (auth) {
    const t = token();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

// Verify the admin password sent in the "x-admin-password" header.
function checkAdminPassword(pw: string | null): boolean {
  if (!pw) return false;
  const hash = createHash("sha256").update(ADMIN_SALT + pw).digest("hex");
  const a = Buffer.from(hash, "utf8");
  const b = Buffer.from(ADMIN_PW_HASH, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// GET: return the current levels array.
export async function GET() {
  try {
    const t = token();
    let jsonText: string;
    if (t) {
      // Fresh read via the Contents API (no CDN cache).
      const res = await fetch(API_URL, { headers: apiHeaders(true), cache: "no-store" });
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

// Read the current file content + its git SHA (needed to update via Contents API).
async function readWithSha(): Promise<{ levels: SRLevel[]; sha: string | null }> {
  const t = token();
  if (!t) throw new Error("GITHUB_TOKEN is not configured — set it in Vercel project env vars to enable saving.");
  const res = await fetch(API_URL, { headers: apiHeaders(true), cache: "no-store" });
  if (res.status === 404) return { levels: [], sha: null }; // file doesn't exist yet
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const data = await res.json();
  const b64 = String(data.content || "").replace(/\n/g, "");
  const text = Buffer.from(b64, "base64").toString("utf8");
  let levels: SRLevel[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) levels = parsed;
  } catch {
    levels = [];
  }
  return { levels, sha: data.sha || null };
}

// Commit the updated JSON to the repo via the Contents API (PUT).
async function writeWithSha(levels: SRLevel[], sha: string | null, message: string): Promise<void> {
  const t = token();
  if (!t) throw new Error("GITHUB_TOKEN is not configured.");
  const content = Buffer.from(JSON.stringify(levels, null, 2), "utf8").toString("base64");
  const body: Record<string, string> = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(API_URL, {
    method: "PUT",
    headers: { ...apiHeaders(true), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub write failed (${res.status}): ${txt.slice(0, 200)}`);
  }
}

function makeId(date: string, symbol: string): string {
  return `${date}-${symbol.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

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
    // Newest date first; within a date, alphabetical by symbol.
    levels.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.symbol.localeCompare(b.symbol),
    );
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
