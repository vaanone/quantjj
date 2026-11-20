// =============================================================================
// CSV data source — Amazon VPS (HTTP) primary, Google Drive (legacy) fallback.
//
// The frontend always calls /api/csv-files and /api/csv-file. This module
// picks the backend from env config:
//
//   CSV_BASE_URL   (e.g. https://vps.example.com/csv/)  → use the VPS.
//   If unset                                       → fall back to Google
//                                                    Drive so production
//                                                    keeps working until the
//                                                    VPS is configured.
//
// ---- VPS configuration (all optional except CSV_BASE_URL) ----
//   CSV_BASE_URL     Base URL of the directory that serves the CSV files.
//                     Trailing slash optional. The VPS must serve the files
//                     over HTTP(S); directory listing is optional (see list
//                     strategies below).
//   CSV_FILE_NAMES   Optional comma-separated list of exact file names. If
//                     set, listing is just these files — works with ANY static
//                     file host, no directory listing needed.
//   CSV_AUTH_TOKEN   Optional bearer token sent as `Authorization: Bearer …`.
//   CSV_BASIC_AUTH   Optional `user:pass` sent as `Authorization: Basic …`.
//
// ---- VPS listing strategies (tried in order when CSV_FILE_NAMES is unset) ----
//   1. `${CSV_BASE_URL}/index.json`  — a manifest:
//        [{ "name": "XAUUSD_…csv", "modifiedTime": "2026-11-18T…", "size": 12345 }]
//   2. HTML directory listing (nginx `autoindex on`, Apache `mod_autoindex`,
//      `python3 -m http.server`) — parse <a href="*.csv"> links.
//
// ---- modifiedTime ----
//   Used by the 30-second polling loop to detect updated files. We fetch it
//   via a HEAD request (`Last-Modified` header) per file when the listing
//   itself doesn't carry it. With only a handful of files this is cheap.
// =============================================================================

export interface CsvFile {
  id: string; // filename (VPS) or Drive file ID (Drive fallback)
  name: string;
  modifiedTime?: string | null;
}

const VPS_BASE = (process.env.CSV_BASE_URL || "").replace(/\/+$/, "");
const VPS_TOKEN = process.env.CSV_AUTH_TOKEN || "";
const VPS_BASIC = process.env.CSV_BASIC_AUTH || "";
const VPS_FILE_NAMES = process.env.CSV_FILE_NAMES || "";

const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY || "";
const DRIVE_FOLDER_ID = "1ksSNA1o68VteTu4SGHfjpmtgKGVgJ9HC";

/** True when the VPS source is configured (and therefore preferred). */
export function useVps(): boolean {
  return VPS_BASE.length > 0;
}

/** Auth headers for VPS requests, if configured. */
function vpsAuthHeaders(): Record<string, string> {
  if (VPS_TOKEN) return { Authorization: `Bearer ${VPS_TOKEN}` };
  if (VPS_BASIC) {
    return { Authorization: `Basic ${Buffer.from(VPS_BASIC).toString("base64")}` };
  }
  return {};
}

/** Fetch a VPS URL with auth headers and a timeout. */
async function vpsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...vpsAuthHeaders(), ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse an HTML directory listing for .csv file links. */
function parseAutoindexCsv(html: string): string[] {
  const names = new Set<string>();
  // Match href="something.csv" or href='something.csv'. The href is
  // URL-encoded by nginx/Apache/http.server (e.g. '#' → '%23').
  const re = /href=["']([^"'?]+\.csv)(?:\?[^"']*)?["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(m[1]);
      // Skip parent-dir / absolute-URL entries.
      if (decoded.startsWith("/") || decoded.includes("://")) continue;
      names.add(decoded);
    } catch {
      // ignore malformed entries
    }
  }
  return Array.from(names);
}

/** Convert an HTTP `Last-Modified` header value to an ISO timestamp. */
function lastModifiedToIso(res: Response): string | null {
  const lm = res.headers.get("last-modified");
  if (!lm) return null;
  const d = new Date(lm);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** HEAD each file in parallel to fill in modifiedTime via Last-Modified. */
async function fillModifiedTimes(files: CsvFile[]): Promise<CsvFile[]> {
  await Promise.all(
    files.map(async (f) => {
      if (f.modifiedTime) return;
      try {
        const res = await vpsFetch(`${VPS_BASE}/${encodeURIComponent(f.name)}`, {
          method: "HEAD",
        });
        f.modifiedTime = lastModifiedToIso(res);
      } catch {
        // leave null — polling still detects NEW files, just not silent edits
      }
    }),
  );
  return files;
}

// ---------------------------------------------------------------------------
// VPS listing
// ---------------------------------------------------------------------------
async function listVpsFiles(): Promise<{ files: CsvFile[]; error?: string }> {
  // Strategy 1 — explicit file list from env (works with any static host).
  if (VPS_FILE_NAMES.trim()) {
    const files = VPS_FILE_NAMES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ id: name, name, modifiedTime: null }));
    return { files: await fillModifiedTimes(files) };
  }

  // Strategy 2 — index.json manifest.
  try {
    const res = await vpsFetch(`${VPS_BASE}/index.json`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const arr: any[] = Array.isArray(data) ? data : data?.files;
      if (Array.isArray(arr)) {
        const files: CsvFile[] = arr
          .filter((e) => e && typeof e.name === "string" && /\.csv$/i.test(e.name))
          .map((e) => ({
            id: String(e.name),
            name: String(e.name),
            modifiedTime: e.modifiedTime ? String(e.modifiedTime) : null,
          }));
        return { files: await fillModifiedTimes(files) };
      }
    }
  } catch {
    // fall through to autoindex
  }

  // Strategy 3 — HTML directory listing (nginx/Apache/http.server autoindex).
  try {
    const res = await vpsFetch(`${VPS_BASE}/`, { headers: { Accept: "text/html" } });
    if (!res.ok) {
      return {
        files: [],
        error: `VPS listing fetch failed: HTTP ${res.status} for ${VPS_BASE}/`,
      };
    }
    const html = await res.text();
    const names = parseAutoindexCsv(html);
    if (names.length === 0) {
      return {
        files: [],
        error:
          `No .csv files found in the VPS directory listing at ${VPS_BASE}/. ` +
          `Either enable directory listing, place an index.json manifest there, ` +
          `or set CSV_FILE_NAMES.`,
      };
    }
    const files = names.map((name) => ({ id: name, name, modifiedTime: null }));
    return { files: await fillModifiedTimes(files) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { files: [], error: `VPS listing fetch failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// VPS file download — with a short in-memory cache (same idea as the old
// Drive cache) so bursts of page refreshes don't hammer the VPS.
// ---------------------------------------------------------------------------
const VPS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const vpsCache = new Map<string, { content: string; ts: number }>();

function vpsGetCached(name: string): string | null {
  const e = vpsCache.get(name);
  if (!e) return null;
  if (Date.now() - e.ts > VPS_CACHE_TTL_MS) return null;
  return e.content;
}

function looksLikeCsv(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase();
  if (
    head.includes("<html") ||
    head.includes("<!doctype") ||
    head.includes("<title") ||
    head.includes("<body")
  ) {
    return false;
  }
  const firstLine = text.split("\n")[0] || "";
  return firstLine.includes(",") && !firstLine.includes("<");
}

async function fetchVpsFile(name: string): Promise<{ content: string; status: "HIT" | "MISS" | "STALE" } | { error: string }> {
  // 1. Fresh cache hit.
  const cached = vpsGetCached(name);
  if (cached) return { content: cached, status: "HIT" };

  // 2. Fetch from VPS.
  const url = `${VPS_BASE}/${encodeURIComponent(name)}`;
  try {
    const res = await vpsFetch(url);
    if (!res.ok) {
      // 3. Stale cache fallback while the VPS is briefly unavailable.
      const stale = vpsCache.get(name)?.content;
      if (stale) return { content: stale, status: "STALE" };
      return { error: `VPS returned HTTP ${res.status} for ${name}` };
    }
    const text = await res.text();
    if (!looksLikeCsv(text)) {
      const stale = vpsCache.get(name)?.content;
      if (stale) return { content: stale, status: "STALE" };
      return { error: `VPS response for ${name} does not look like a CSV` };
    }
    vpsCache.set(name, { content: text, ts: Date.now() });
    return { content: text, status: "MISS" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const stale = vpsCache.get(name)?.content;
    if (stale) return { content: stale, status: "STALE" };
    return { error: `VPS fetch failed for ${name}: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Google Drive fallback (used only when CSV_BASE_URL is unset)
// ---------------------------------------------------------------------------
async function listDriveFiles(): Promise<{ files: CsvFile[]; error?: string }> {
  if (!DRIVE_API_KEY) {
    return {
      files: [],
      error: "CSV_BASE_URL is not set (VPS) and GOOGLE_DRIVE_API_KEY is not set (Drive). Configure one.",
    };
  }
  try {
    const q = encodeURIComponent(
      `'${DRIVE_FOLDER_ID}' in parents and trashed = false and ` +
        `(mimeType = 'text/csv' or mimeType = 'application/csv' or name contains '.csv')`,
    );
    const fields = encodeURIComponent("files(id, name, mimeType, modifiedTime)");
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}` +
      `&fields=${fields}&orderBy=name&pageSize=200&key=${DRIVE_API_KEY}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const t = await res.text();
      return { files: [], error: `Drive API error: ${res.status} ${t}` };
    }
    const data = await res.json();
    const files: CsvFile[] = (data.files || [])
      .filter((f: any) => String(f.name).toLowerCase().endsWith(".csv"))
      .map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime || null }));
    return { files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { files: [], error: `Failed to list Drive files: ${msg}` };
  }
}

const driveCache = new Map<string, { content: string; ts: number }>();
function driveGetCached(id: string): string | null {
  const e = driveCache.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > VPS_CACHE_TTL_MS) return null;
  return e.content;
}
async function driveFetchAlt(fileId: string): Promise<string | null> {
  if (!DRIVE_API_KEY) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`,
    );
    if (!res.ok) return null;
    const t = await res.text();
    return looksLikeCsv(t) ? t : null;
  } catch {
    return null;
  }
}
async function driveFetchDirect(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
      redirect: "follow",
    });
    if (!res.ok) return null;
    const t = await res.text();
    return looksLikeCsv(t) ? t : null;
  } catch {
    return null;
  }
}
async function fetchDriveFile(id: string): Promise<{ content: string; status: "HIT" | "MISS" | "STALE" } | { error: string }> {
  const cached = driveGetCached(id);
  if (cached) return { content: cached, status: "HIT" };
  let content = await driveFetchAlt(id);
  if (content === null) content = await driveFetchDirect(id);
  if (content === null) {
    const stale = driveCache.get(id)?.content;
    if (stale) return { content: stale, status: "STALE" };
    return { error: "Unable to download the file from Google Drive right now. Please retry in a few minutes." };
  }
  driveCache.set(id, { content, ts: Date.now() });
  return { content, status: "MISS" };
}

// ---------------------------------------------------------------------------
// Public API used by the route handlers
// ---------------------------------------------------------------------------
export async function listFiles(): Promise<{ files: CsvFile[]; error?: string }> {
  return useVps() ? listVpsFiles() : listDriveFiles();
}

export async function fetchFile(
  file: { id: string; name: string },
): Promise<{ content: string; status: "HIT" | "MISS" | "STALE" } | { error: string }> {
  return useVps() ? fetchVpsFile(file.name) : fetchDriveFile(file.id);
}
