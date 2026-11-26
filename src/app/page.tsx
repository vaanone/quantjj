"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriceTicker } from "@/components/price-ticker";
import { EconomicCalendar } from "@/components/economic-calendar";

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

function fmt(n: number | null): string {
  if (n === null || n === undefined || !n) return "—";
  return n >= 100 ? n.toFixed(2) : n.toFixed(5);
}

export default function Home() {
  const [levels, setLevels] = useState<SRLevel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sr?_=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) setLevels(data);
      })
      .catch(() => {
        /* network error — leave empty, the empty state shows */
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Latest entry per symbol (most recent date).
  const latestPerSymbol = (() => {
    const map = new Map<string, SRLevel>();
    for (const l of levels) {
      const existing = map.get(l.symbol);
      if (!existing || l.date > existing.date) map.set(l.symbol, l);
    }
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  })();

  return (
    <div className="min-h-screen bg-[#070D12] text-white pb-16">
      {/* ====== NAV ====== */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0D141B]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Vaan.One" className="h-10 w-10 rounded-md object-contain" />
            <div>
              <h1 className="text-base font-bold leading-tight">Vaan.One</h1>
              <p className="text-[11px] leading-tight text-white/70">Vaan Pivot - A JJ TechHub Product</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a href="#levels" className="hidden text-sm text-white/60 hover:text-white sm:block">Levels</a>
            <a href="#faq" className="hidden text-sm text-white/60 hover:text-white sm:block">FAQ</a>
            <a
              href="/admin"
              className="rounded-md border border-[#75D380]/30 bg-[#75D380]/10 px-3 py-1.5 text-sm font-medium text-[#75D380] transition-colors hover:bg-[#75D380]/20"
            >
              Admin
            </a>
          </div>
        </div>
      </nav>

      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden px-6 py-4 text-center">
        {/* Animated background */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="animate-grid-drift absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
          <div className="animate-float-slow absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#75D380]/8 blur-[80px]" />
          <div className="animate-float-medium absolute -right-20 top-40 h-96 w-96 rounded-full bg-red-600/5 blur-[100px]" />
          <div className="animate-pulse-glow absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#75D380]/5 blur-[90px]" />
        </div>

        <div className="relative mx-auto max-w-4xl">
          {/* Scrolling price ticker */}
          <div className="mb-4">
            <PriceTicker />
          </div>

          {/* Economic calendar */}
          <div className="mb-6">
            <EconomicCalendar />
          </div>

          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#75D380]/20 bg-[#75D380]/5 px-4 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#75D380] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#75D380]" />
            </span>
            <span className="text-xs uppercase tracking-wider text-[#75D380]">Live Levels Updated Daily</span>
          </div>

          <h2 className="text-5xl font-bold tracking-tight sm:text-7xl">
            <span className="bg-gradient-to-r from-red-500 via-[#75D380] to-[#60D2D5] bg-clip-text text-transparent">
              Vaan Pivot
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-xl font-medium text-[#75D380] sm:text-2xl">
            Know Your Levels. Trade with Confidence.
          </p>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-white/60 sm:text-lg">
            Vaan Pivot Levels are daily Support and Resistance price levels (I, II, III) for
            ADANIGREEN and HINDALCO. Updated every morning at 5:30 AM IST.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#levels">
              <Button className="bg-[#75D380] px-10 py-4 text-base font-semibold text-[#070D12] hover:bg-[#85E390]">
                View Today&apos;s Levels →
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ====== SUPPORT & RESISTANCE LEVELS ====== */}
      <section id="levels" className="relative border-t border-white/5 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-[#75D380]">01 — Levels</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Today&apos;s Support &amp; Resistance</h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/60">
              Three Support levels (green) and three Resistance levels (red) per symbol, refreshed daily.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#75D380]" />
            </div>
          ) : latestPerSymbol.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-xl border border-white/10 bg-white/[0.02] p-10 text-center">
              <p className="text-base text-white/70">No levels published yet.</p>
              <p className="mt-2 text-sm text-white/50">
                Levels are entered via the Admin page and appear here instantly.
              </p>
              <a
                href="/admin"
                className="mt-6 inline-block rounded-md bg-[#75D380] px-6 py-2.5 text-sm font-semibold text-[#070D12] hover:bg-[#85E390]"
              >
                Go to Admin →
              </a>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {latestPerSymbol.map((entry) => (
                <SRCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-[#75D380]/15 bg-[#75D380]/[0.03] p-6">
            <p className="text-sm leading-relaxed text-white/50">
              <span className="font-semibold text-[#75D380]">Disclaimer:</span> Vaan.One Levels are
              provided for educational and informational purposes only. These levels are manually
              calculated and updated daily. Accuracy is not guaranteed. They are not investment advice
              or trading recommendations. Always do your own research and manage your risk.
            </p>
          </div>
        </div>
      </section>

      {/* ====== FAQ ====== */}
      <section id="faq" className="border-t border-white/5 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-[#75D380]">FAQ</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Frequently Asked Questions</h3>
          </div>
          <div className="space-y-3">
            <FaqItem
              q="What are Vaan Pivot Levels?"
              a="Vaan Pivot Levels are daily support and resistance price levels calculated using a customized pivot methodology. They identify potential intraday reversal zones for instruments like ADANIGREEN and HINDALCO."
            />
            <FaqItem
              q="When are the levels updated?"
              a="Levels are manually updated every morning at 5:30 AM IST (Indian Standard Time), before the major trading sessions open."
            />
            <FaqItem
              q="How accurate are the levels?"
              a="We claim up to 80% accuracy. However, accuracy is not guaranteed — these levels are for educational and informational purposes only and should not be considered investment advice."
            />
            <FaqItem
              q="Is there a cost to use Vaan Pivot?"
              a="Currently FREE! You can access all available levels at no cost for now."
            />
            <FaqItem
              q="Which trading symbols are available?"
              a="ADANIGREEN (Adani Green Energy) and HINDALCO (Hindalco Industries) — both traded on the NSE (National Stock Exchange of India)."
            />
            <FaqItem
              q="How do I see today's levels?"
              a="The Support & Resistance levels are shown directly on the home page, with three Support and three Resistance levels (I, II, III) per symbol."
            />
            <FaqItem
              q="Are these levels trading recommendations?"
              a="No. Vaan Pivot Levels are provided for educational and informational purposes only. They are not investment advice or trading recommendations. Always do your own research and manage your risk."
            />
            <FaqItem
              q="How can I contact you?"
              a="Email us at valan@outlook.com for any questions, feedback, or collaboration inquiries."
            />
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0D141B]/95 backdrop-blur-md"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vaan.One" className="h-4 w-4 rounded object-contain" />
            <span className="font-mono text-[10px] text-white/50">Vaan.One</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="mailto:valan@outlook.com"
              aria-label="Email valan@outlook.com"
              className="text-white/50 transition-colors hover:text-[#75D380]"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="https://t.me/vaan_one"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram channel"
              className="text-white/50 transition-colors hover:text-[#75D380]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M23.91 3.79L20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.35-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73z" />
              </svg>
            </a>
          </div>
          <p className="hidden text-[9px] leading-tight text-white/60 md:block">
            Disclaimer: This website is for educational purposes only. Trade at your own risk.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ============================================================ S/R CARD
function SRCard({ entry }: { entry: SRLevel }) {
  // An entry whose levels were never filled in yet (all null).
  const pending =
    entry.support1 == null &&
    entry.resistance1 == null &&
    entry.support2 == null &&
    entry.resistance2 == null &&
    entry.support3 == null &&
    entry.resistance3 == null;
  return (
    <div className="animate-fade-in-up rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-[#75D380]/30">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/10 pb-3">
        <span className="font-mono text-lg font-bold text-[#75D380]">{entry.symbol}</span>
        <div className="flex items-center gap-2">
          {pending && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
              levels pending
            </span>
          )}
          <span className="text-xs text-white/50">{entry.date}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {/* Resistances (top — red) */}
        <SRRow label="Resistance III" value={entry.resistance3} tone="resistance" />
        <SRRow label="Resistance II" value={entry.resistance2} tone="resistance" />
        <SRRow label="Resistance I" value={entry.resistance1} tone="resistance" />
        {/* Divider */}
        <div className="my-2 flex items-center gap-2">
          <div className="h-px flex-1 bg-white/10" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            {entry.symbol}
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        {/* Supports (bottom — green) */}
        <SRRow label="Support I" value={entry.support1} tone="support" />
        <SRRow label="Support II" value={entry.support2} tone="support" />
        <SRRow label="Support III" value={entry.support3} tone="support" />
      </div>
    </div>
  );
}

function SRRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "support" | "resistance";
}) {
  const isSupport = tone === "support";
  const color = isSupport ? "text-[#75D380]" : "text-red-400";
  const dot = isSupport ? "bg-[#75D380]" : "bg-red-400";
  return (
    <div className="flex items-center justify-between rounded-md bg-[#0D141B] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-xs text-white/60">{label}</span>
      </div>
      <span className={`font-mono text-sm font-semibold ${color}`}>{fmt(value)}</span>
    </div>
  );
}

// ============================================================ FAQ ITEM
function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20">
      <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-white/80 [&::-webkit-details-marker]:hidden">
        {q}
        <span className="ml-4 shrink-0 text-[#75D380] transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-white/60">{a}</p>
    </details>
  );
}
