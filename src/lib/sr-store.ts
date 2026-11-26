// Shared storage layer for the S/R levels (data/sr-levels.json in the repo
// itself, read and written through the GitHub Contents API).
//
// Used by /api/sr (the public read + admin write API) and /api/cron/reset
// (the daily 1 AM IST auto-reset) so both paths read and write the exact
// same way.

import { createHash, timingSafeEqual } from "crypto";
import { ADMIN_SALT, ADMIN_PW_HASH } from "./admin-auth";

const REPO = "vaanone/quantjj";
const BRANCH = "main";
const FILE_PATH = "data/sr-levels.json";

export const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE_PATH}`;
export const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

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

export function getGithubToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "quantjj-sr-api",
  };
  const t = getGithubToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// Verify the admin password sent in the "x-admin-password" header.
export function checkAdminPassword(pw: string | null): boolean {
  if (!pw) return false;
  const hash = createHash("sha256").update(ADMIN_SALT + pw).digest("hex");
  const a = Buffer.from(hash, "utf8");
  const b = Buffer.from(ADMIN_PW_HASH, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeId(date: string, symbol: string): string {
  return `${date}-${symbol.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

// Keep the array ordered: newest date first; within a date, alphabetical by
// symbol. (The admin list and the raw GET both rely on this order.)
export function sortLevels(levels: SRLevel[]): void {
  levels.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.symbol.localeCompare(b.symbol),
  );
}

// Read the current file content + its git SHA (needed to update via the
// Contents API). Requires GITHUB_TOKEN.
export async function readWithSha(): Promise<{ levels: SRLevel[]; sha: string | null }> {
  const t = getGithubToken();
  if (!t) {
    throw new Error(
      "GITHUB_TOKEN is not configured — set it in Vercel project env vars to enable saving.",
    );
  }
  const res = await fetch(API_URL, { headers: apiHeaders(), cache: "no-store" });
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
export async function writeWithSha(
  levels: SRLevel[],
  sha: string | null,
  message: string,
): Promise<void> {
  const t = getGithubToken();
  if (!t) throw new Error("GITHUB_TOKEN is not configured.");
  const content = Buffer.from(JSON.stringify(levels, null, 2), "utf8").toString("base64");
  const body: Record<string, string> = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(API_URL, {
    method: "PUT",
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub write failed (${res.status}): ${txt.slice(0, 200)}`);
  }
}
