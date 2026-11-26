"use client";

import { useEffect, useState, useCallback } from "react";
import { Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_SALT, ADMIN_PW_HASH } from "@/lib/admin-auth";

interface SRLevel {
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

const KNOWN_SYMBOLS = ["ADANIGREEN", "HINDALCO"];

// Password gate: the page stays locked until the correct password is entered.
// The password is checked against the same salted hash the server checks, so
// it never needs to be sent just to unlock — but it IS sent with every
// save/delete (x-admin-password header) and the server enforces it again.
const PW_SESSION_KEY = "sr-admin-pw";

async function hashPassword(pw: string): Promise<string> {
  const data = new TextEncoder().encode(ADMIN_SALT + pw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fmt(n: number | null): string {
  if (n === null || n === undefined || !n) return "—";
  return n >= 100 ? n.toFixed(2) : n.toFixed(5);
}

function todayISO(): string {
  // Use IST (Asia/Kolkata) so "today" matches the user's trading day.
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export default function AdminPage() {
  const [date, setDate] = useState(todayISO());
  const [symbol, setSymbol] = useState("ADANIGREEN");
  const [s1, setS1] = useState("");
  const [r1, setR1] = useState("");
  const [s2, setS2] = useState("");
  const [r2, setR2] = useState("");
  const [s3, setS3] = useState("");
  const [r3, setR3] = useState("");
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<SRLevel[]>([]);
  const [loading, setLoading] = useState(true);

  // Password gate state.
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Auto-unlock if a verified password from this browser session is stored.
  useEffect(() => {
    const saved = sessionStorage.getItem(PW_SESSION_KEY);
    if (!saved) return;
    hashPassword(saved)
      .then((h) => {
        if (h === ADMIN_PW_HASH) {
          setPw(saved);
          setUnlocked(true);
        } else {
          sessionStorage.removeItem(PW_SESSION_KEY);
        }
      })
      .catch(() => sessionStorage.removeItem(PW_SESSION_KEY));
  }, []);

  function lock() {
    sessionStorage.removeItem(PW_SESSION_KEY);
    setPw("");
    setPwError("");
    setUnlocked(false);
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setPwError("");
    try {
      const h = await hashPassword(pw);
      if (h === ADMIN_PW_HASH) {
        sessionStorage.setItem(PW_SESSION_KEY, pw);
        setUnlocked(true);
      } else {
        setPwError("Incorrect password — try again.");
      }
    } catch {
      setPwError("Password check failed in this browser.");
    } finally {
      setUnlocking(false);
    }
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sr?_=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data)) setEntries(data);
      else if (data?.error) toast.error(`Load failed: ${data.error}`);
    } catch (e) {
      toast.error("Could not load existing levels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !symbol) {
      toast.error("Date and symbol are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/sr", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": pw },
        body: JSON.stringify({
          date,
          symbol,
          support1: s1,
          resistance1: r1,
          support2: s2,
          resistance2: r2,
          support3: s3,
          resistance3: r3,
        }),
      });
      if (res.status === 401) {
        lock();
        toast.error("Password rejected — please unlock again.");
        return;
      }
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Saved ${symbol} for ${date}`);
        setS1(""); setR1(""); setS2(""); setR2(""); setS3(""); setR3("");
        await fetchEntries();
      } else {
        toast.error(`Save failed: ${data.error || res.status}`);
      }
    } catch {
      toast.error("Network error — could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: SRLevel) {
    if (!confirm(`Delete ${entry.symbol} (${entry.date})?`)) return;
    try {
      const res = await fetch(`/api/sr?id=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
        headers: { "x-admin-password": pw },
      });
      if (res.status === 401) {
        lock();
        toast.error("Password rejected — please unlock again.");
        return;
      }
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Deleted.");
        await fetchEntries();
      } else {
        toast.error(`Delete failed: ${data.error || res.status}`);
      }
    } catch {
      toast.error("Network error — could not delete.");
    }
  }

  // Prefill the form when clicking an existing entry (to edit it).
  // Levels that were never entered (null) become empty inputs.
  function editEntry(entry: SRLevel) {
    setDate(entry.date);
    setSymbol(entry.symbol);
    setS1(entry.support1 == null ? "" : String(entry.support1));
    setR1(entry.resistance1 == null ? "" : String(entry.resistance1));
    setS2(entry.support2 == null ? "" : String(entry.support2));
    setR2(entry.resistance2 == null ? "" : String(entry.resistance2));
    setS3(entry.support3 == null ? "" : String(entry.support3));
    setR3(entry.resistance3 == null ? "" : String(entry.resistance3));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-[#070D12] text-white">
      {/* NAV */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0D141B]/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Vaan.One" className="h-9 w-9 rounded-md object-contain" />
            <div>
              <h1 className="text-base font-bold leading-tight">Vaan.One Admin</h1>
              <p className="text-[11px] leading-tight text-white/70">Support &amp; Resistance Levels</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unlocked && (
              <button
                onClick={lock}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Lock
              </button>
            )}
            <a
              href="/"
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
            >
              ← View Site
            </a>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-10 pb-24">
        {!unlocked ? (
          /* PASSWORD GATE */
          <div className="mx-auto max-w-sm pt-10">
            <form
              onSubmit={handleUnlock}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#75D380]/30 bg-[#75D380]/10">
                <Lock className="h-5 w-5 text-[#75D380]" aria-hidden="true" />
              </div>
              <h2 className="mb-1 text-xl font-bold">Admin Access</h2>
              <p className="mb-5 text-sm text-white/60">
                Enter the admin password to manage the levels.
              </p>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                placeholder="Password"
                className="mb-3 w-full rounded-md border border-white/15 bg-[#0D141B] px-3 py-2 text-center text-sm text-white outline-none focus:border-[#75D380]"
              />
              {pwError && <p className="mb-3 text-sm text-red-400">{pwError}</p>}
              <button
                type="submit"
                disabled={unlocking || !pw}
                className="w-full rounded-md bg-[#75D380] px-4 py-2.5 text-sm font-semibold text-[#070D12] transition-colors hover:bg-[#85E390] disabled:opacity-50"
              >
                {unlocking ? "Checking…" : "Unlock"}
              </button>
            </form>
          </div>
        ) : (
          <>
        {/* FORM */}
        <section className="mb-12">
          <h2 className="mb-1 text-2xl font-bold">Enter Levels</h2>
          <p className="mb-6 text-sm text-white/60">
            Fill in the date and symbol, then the three Support / Resistance pairs. Levels can be
            left blank and filled in later — saving updates the live site immediately.
          </p>

          <form
            onSubmit={handleSave}
            className="space-y-5 rounded-xl border border-white/10 bg-white/[0.02] p-6"
          >
            {/* Date + Symbol */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/60">
                  Date
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full rounded-md border border-white/15 bg-[#0D141B] px-3 py-2 text-sm text-white outline-none focus:border-[#75D380]"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/60">
                  Symbol
                </span>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  list="symbol-suggestions"
                  required
                  className="w-full rounded-md border border-white/15 bg-[#0D141B] px-3 py-2 font-mono text-sm font-bold text-[#75D380] outline-none focus:border-[#75D380]"
                />
                <datalist id="symbol-suggestions">
                  {KNOWN_SYMBOLS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
            </div>

            {/* S/R grid: 3 rows of (Support, Resistance) */}
            {[
              { label: "I", sVal: s1, setS: setS1, rVal: r1, setR: setR1 },
              { label: "II", sVal: s2, setS: setS2, rVal: r2, setR: setR2 },
              { label: "III", sVal: s3, setS: setS3, rVal: r3, setR: setR3 },
            ].map((row) => (
              <div key={row.label} className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#75D380]">
                    Support {row.label}
                  </span>
                  <input
                    type="number"
                    step="0.00001"
                    inputMode="decimal"
                    value={row.sVal}
                    onChange={(e) => row.setS(e.target.value)}
                    placeholder="e.g. 1048.50"
                    className="w-full rounded-md border border-white/15 bg-[#0D141B] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#75D380]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-red-400">
                    Resistance {row.label}
                  </span>
                  <input
                    type="number"
                    step="0.00001"
                    inputMode="decimal"
                    value={row.rVal}
                    onChange={(e) => row.setR(e.target.value)}
                    placeholder="e.g. 1075.00"
                    className="w-full rounded-md border border-white/15 bg-[#0D141B] px-3 py-2 font-mono text-sm text-white outline-none focus:border-red-400"
                  />
                </label>
              </div>
            ))}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-[#75D380] px-4 py-2.5 text-sm font-semibold text-[#070D12] transition-colors hover:bg-[#85E390] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Levels"}
            </button>
          </form>
        </section>

        {/* EXISTING ENTRIES */}
        <section>
          <h2 className="mb-4 text-xl font-bold">Saved Levels</h2>
          {loading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              No levels yet. Add the first one above.
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-[#75D380]">
                        {entry.symbol}
                      </span>
                      <span className="text-xs text-white/50">{entry.date}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editEntry(entry)}
                        className="rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(entry)}
                        className="rounded border border-red-500/30 bg-red-600/10 px-2.5 py-1 text-xs text-red-400 hover:bg-red-600/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { l: "I", s: entry.support1, r: entry.resistance1 },
                      { l: "II", s: entry.support2, r: entry.resistance2 },
                      { l: "III", s: entry.support3, r: entry.resistance3 },
                    ].map((row) => (
                      <div
                        key={row.l}
                        className="rounded border border-white/5 bg-[#0D141B] px-3 py-2 text-center"
                      >
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">
                          Level {row.l}
                        </div>
                        <div className="text-[11px] text-[#75D380]">
                          S: <span className="font-mono">{fmt(row.s)}</span>
                        </div>
                        <div className="text-[11px] text-red-400">
                          R: <span className="font-mono">{fmt(row.r)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0D141B]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-x-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vaan.One" className="h-4 w-4 rounded object-contain" />
            <span className="font-mono text-[10px] text-white/50">Vaan.One</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="mailto:valan@outlook.com" aria-label="Email" className="text-white/50 hover:text-[#75D380]">
              <Mail className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="https://t.me/vaan_one"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="text-white/50 hover:text-[#75D380]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M23.91 3.79L20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.35-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
