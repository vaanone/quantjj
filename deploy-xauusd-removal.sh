#!/usr/bin/env bash
# =============================================================================
# deploy-xauusd-removal.sh — foolproof deploy of the XAUUSD removal.
#
# WHAT IT DOES: extracts the 7 pre-patched files from xauusd-removal-files.tar.gz
# over your repo, verifies the XAUUSD markers, commits (src/ only), and pushes.
# No `git apply` — the files are written directly, so there is no context-matching
# step that can silently fail.
#
# HOW TO USE:
#   1. Put BOTH this script AND xauusd-removal-files.tar.gz in the ROOT of your
#      quantjj repo (next to package.json).
#   2. Run:  bash deploy-xauusd-removal.sh
#   3. Tell the agent "deployed" so it verifies the live site.
# =============================================================================
set -u

TARBALL="xauusd-removal-files.tar.gz"

echo "=== pre-checks ==="
[ -f "$TARBALL" ] || { echo "FAIL: $TARBALL not found in $(pwd). Put it in the repo root."; exit 1; }
[ -d src ]        || { echo "FAIL: no src/ dir here. Run from the repo root (where package.json is)."; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "FAIL: not a git repo."; exit 1; }

echo "=== 1. switch to main + pull latest ==="
git checkout main
git pull --ff-only

echo ""
echo "=== 2. extract the 7 patched files over the repo ==="
tar xzf "$TARBALL" || { echo "FAIL: tar extraction failed."; exit 1; }
echo "extracted."

echo ""
echo "=== 3. files changed vs HEAD (visibility) ==="
git diff --stat -- src/

echo ""
echo "=== 4. verify XAUUSD markers (the gate — aborts if any fail) ==="
if grep -q 'XAUUSD has been retired' src/lib/csv-source.ts; then echo "  OK  csv-source.ts has the XAUUSD filter"; else echo "  FAIL csv-source.ts filter missing — aborting"; exit 1; fi
if grep -q 'XAUUSD' src/lib/finnhub-symbols.ts; then echo "  FAIL finnhub-symbols.ts still has XAUUSD — aborting"; exit 1; else echo "  OK  finnhub-symbols.ts has no XAUUSD"; fi
if grep -q 'GC=F' src/app/api/prices/route.ts; then echo "  FAIL prices/route.ts still has GC=F — aborting"; exit 1; else echo "  OK  prices/route.ts has no GC=F"; fi
if grep -q 'GC=F' src/app/api/live-price/route.ts; then echo "  FAIL live-price/route.ts still has GC=F — aborting"; exit 1; else echo "  OK  live-price/route.ts has no GC=F"; fi
if grep -q 'symbol?: string' src/components/trading-visual-card.tsx; then echo "  OK  trading-visual-card.tsx has the symbol prop"; else echo "  FAIL trading-visual-card.tsx missing symbol prop — aborting"; exit 1; fi
echo "all markers passed."

echo ""
echo "=== 5. stage src/ only + commit + push ==="
git add src/
if git diff --cached --quiet; then
  echo "  (no changes to commit — files already match HEAD. Pushing to sync.)"
else
  git commit -m "remove XAUUSD from csv listing, live prices, and hero card"
fi
git push

echo ""
echo "DONE. Tell the agent 'deployed' so it verifies the live site (0 XAUUSD in HTML, /api/prices drops XAUUSD)."
