import { NextResponse } from "next/server";

// API key — stored in environment variable for security. Optional now: if the
// API is rate-limited, we fall back to the public direct-download URL which
// does not need a key.
const API_KEY = process.env.GOOGLE_DRIVE_API_KEY || "";

// In-memory cache of downloaded CSV content, keyed by Drive file ID.
//
// Why: every chart load / page refresh used to hit the Google Drive API
// once per file. Under repeated loads Google returns a 403 "Sorry...
// unusual traffic" page (per-IP / per-file download quota), which left the
// chart blank. Caching for a few minutes means we only call Drive once per
// file per TTL window, so the quota is never exhausted. The TTL is short
// enough to pick up the daily 5:30 AM IST pivot refresh, long enough to
// survive a burst of page refreshes.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, { content: string; ts: number }>();

function getCached(fileId: string): string | null {
  const entry = cache.get(fileId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.content;
}

function setCached(fileId: string, content: string) {
  cache.set(fileId, { content, ts: Date.now() });
}

// A valid response is CSV text, NOT Google's "Sorry... unusual traffic"
// HTML interstitial or the virus-scan warning page (which the direct
// download URL can return for large / flagged files).
function looksLikeCsv(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype") || head.includes("<title") || head.includes("sorry")) {
    return false;
  }
  const firstLine = text.split("\n")[0] || "";
  return firstLine.includes(",") && !firstLine.includes("<");
}

// Method 1 — Drive API v3 files.get with alt=media (the supported way,
// requires an API key). Returns null on any failure so the caller can try
// the fallback.
async function fetchViaDriveApi(fileId: string): Promise<string | null> {
  if (!API_KEY) return null;
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return looksLikeCsv(text) ? text : null;
  } catch {
    return null;
  }
}

// Method 2 — direct download URL for publicly-shared files. Uses a
// different quota / access pool than the Drive API and needs no API key,
// so it works as a fallback when the API returns 403 "unusual traffic".
// (Files here are small CSVs, so no virus-scan interstitial.)
async function fetchViaDirectDownload(fileId: string): Promise<string | null> {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const text = await res.text();
    return looksLikeCsv(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a specific CSV file from Google Drive by its file ID.
 *
 * Query params:
 *   id — the Google Drive file ID (required)
 *   name — the file name (optional, used for display)
 *
 * Strategy: serve from in-memory cache → Drive API → direct download URL
 * → stale cache → 503. This keeps the chart working even when Google
 * temporarily blocks one of the access paths.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");
  const fileName = searchParams.get("name") || "unknown.csv";

  if (!fileId) {
    return NextResponse.json(
      { error: "Missing required parameter: id" },
      { status: 400 },
    );
  }

  const csvHeaders = (cacheStatus: string) => ({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `inline; filename="${fileName}"`,
    // no-store for the browser, but our server cache handles repeated loads.
    "Cache-Control": "no-store",
    "X-Drive-Cache": cacheStatus,
  });

  // 1. Fresh cache hit — fastest, no Drive call at all.
  const cached = getCached(fileId);
  if (cached) {
    return new NextResponse(cached, { status: 200, headers: csvHeaders("HIT") });
  }

  // 2. Drive API (with API key) — the supported method.
  let content = await fetchViaDriveApi(fileId);

  // 3. Fallback — direct download URL (different quota pool, no key needed).
  if (content === null) {
    content = await fetchViaDirectDownload(fileId);
  }

  // 4. Last resort — serve a stale cached copy so the chart stays usable
  //    while Drive is temporarily unavailable.
  if (content === null) {
    const stale = cache.get(fileId)?.content;
    if (stale) {
      return new NextResponse(stale, { status: 200, headers: csvHeaders("STALE") });
    }
    return NextResponse.json(
      {
        error:
          "Unable to download the file from Google Drive right now (both the Drive API and the direct download URL were blocked). A cached copy is not available either — please retry in a few minutes.",
      },
      { status: 503 },
    );
  }

  setCached(fileId, content);
  return new NextResponse(content, { status: 200, headers: csvHeaders("MISS") });
}
