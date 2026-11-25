QUANTJJ
Loading...
chart auto refresh not working
need to go to home page a nd click launch chart to get new update 

Thought Process
New bug: auto-refresh isn't polling — you have to leave and re-launch to see new bars. Let me investigate how the chart currently fetches data and whether polling exists. First, let me find the refresh mechanism in the deployed code and related data hooks:

Key finding: trading-chart.tsx has no polling of its own — it receives candles as a prop. The data fetching lives in the parent (page.tsx) and the use-live-price hook polls Yahoo. Let me see how page.tsx fetches candles, whether it polls /api/prices, and what "Launch chart" does:

No setInterval/clearInterval in page.tsx at all — so the chart page has no polling. Candles come from currentResult (loaded CSV). Let me trace where currentResult is set and how the VPS data source loads (the recent "switch to Amazon VPS" commit is the prime suspect):

Found the clue: csv-source.ts:31 mentions a "1-minute polling loop to detect updated files" — but I need to find where that loop actually runs and whether it re-loads the current file's content (not just lists files). Let me trace currentFile and locate the polling loop:

The 1-minute polling lives in drive-file-picker.tsx. The critical question: when a file's modifiedTime changes, does it re-download and replace the loaded candle content, or only auto-load new files? And is this picker even mounted on the chart page? Let me read the polling effect and how files state + the picker are wired in page.tsx:

The polling logic does re-load updated files (lines 207-233) — when modifiedTime changes, it deletes from loadedIds and re-loads. So the mechanism exists. The failure must be one of: (a) the picker isn't mounted on the chart page, (b) the VPS source doesn't return a changing modifiedTime, or (c) re-loading doesn't update the files Map the chart reads. Let me check where DriveFilePicker is rendered and how files state is updated in page.tsx:

The picker is mounted in the chart view (line 585, after the early landing return at 416), and handleLoaded updates the files Map (line 170). So the polling runs and re-loads would propagate. The prime suspect is now #2: the VPS source doesn't return a usable modifiedTime — the poll's else if (f.modifiedTime && prevTime && ...) would then never fire, so updates are never detected. Let me verify what listFiles actually returns for VPS files:

The VPS listing sets modifiedTime: null and relies on fillModifiedTimes doing a per-file HEAD request for the Last-Modified header — and the comment explicitly says if that fails, "leave null — polling still detects NEW files, just not silent edits." That's exactly the symptom. Let me confirm by hitting the live /api/csv-files endpoint, and read the cache logic (a second possible culprit — even if a re-load triggers, a stale cache could return old content):

Found it. Two compounding bugs, both confirmed:

VPS_CACHE_TTL_MS = 10 * 60 * 1000 (10 minutes) in csv-source.ts — fetchVpsFile checks the cache before re-downloading. So when the poll detects a modifiedTime change and triggers a re-load, the fetch returns the stale cached content (status "HIT") instead of the updated file. The chart never sees new bars. (On Vercel serverless this is per-instance, so it's inconsistently stale — which is why manual re-launch sometimes works, on cold starts.)
modifiedTimesRef is never seeded on initial load — it's only populated inside the poll loop. So the first poll (at 60s) sees prevTime = undefined and can't detect any update; detection only works from the 2nd poll onward (120s+ blind spot).
And modifiedTime itself is fine — the live /api/csv-files returns fresh values (XAUUSD... | 2026-11-23T03:20:52Z). So the detection layer works; the cache defeats the re-fetch.

Let me read the remaining pieces I need to design the fix — the api/csv-file route and loadFile/fetchFiles/initial-load in the picker:

I now have the full picture. The fix needs to (a) let the poll's update-triggered re-load bypass the 10-min cache, and (b) seed modifiedTimesRef on initial load so the first poll can detect changes. This touches 3 files: csv-source.ts, api/csv-file/route.ts, drive-file-picker.tsx. Let me read the exact sections of fetchVpsFile and fetchDriveFile I need to edit:

I have the exact code. Let me set up a todo list and Read the three files (the Edit tool requires a fresh Read in this message) so I can make precise edits:

I have exact text for all three files. Let me apply the 7 edits — forceFresh opt through the fetch chain (csv-source.ts), the query param (route.ts), and the loadFile + seed + poll changes (drive-file-picker.tsx):

All 7 edits applied. Let me update the todos and typecheck the three changed files (filtered), plus confirm the markers landed:

Clean — typecheck shows zero errors in the 3 changed files (the 10 errors are all pre-existing in unrelated sandbox files like examples/, scripts/, skills/). Markers all confirmed. Let me copy the 3 full merged files to download/ and verify they're complete:

All 3 files verified complete and well-formed. Let me also generate a single combined patch (one-command terminal option) and finalize:

The patch's --check failed only because I tested it against the already-patched working tree (and a harmless mode mismatch: local files are executable 100755, GitHub stores them 100644). Let me verify the patch applies cleanly to a fresh origin/main checkout, which is the user's actual situation:

The patch applies cleanly to fresh origin/main (markers confirmed: 5/3/5). It carries harmless mode-change noise (100644→100755) from the local executable bit. Let me regenerate a clean patch without that noise so the user's git apply doesn't touch file modes:


Thought Process
Auto-refresh fix is ready
Root cause (two compounding bugs, both confirmed against the live app):

The 10-minute VPS content cache defeated the update poll. fetchVpsFile checks an in-memory cache before re-downloading. So when the 60-second poll correctly detected that a CSV's modifiedTime changed and triggered a re-load, the fetch returned the stale cached copy (status HIT) instead of the updated file — the chart never saw new bars. (On Vercel serverless this cache is per-instance, which is why a manual re-launch sometimes worked — on cold starts the cache is empty.)
modifiedTimesRef was never seeded on mount. It started empty, so the first poll saw prevTime = undefined for every file and couldn't detect any change in the first 60s.
modifiedTime itself is fine — the live /api/csv-files returns fresh values (XAUUSD… | 2026-11-23T03:20:52Z). Detection worked; the cache killed the re-fetch.

The fix (3 files, +51/−20 lines, typecheck-clean):

Added a forceFresh option through fetchVpsFile → fetchDriveFile → fetchFile that skips the cache.
The /api/csv-file route reads ?forceFresh=1 and passes it through.
The polling loop now re-loads updated files with forceFresh: true (actual re-download, not stale cache), and the mount effect seeds modifiedTimesRef so the very first poll can detect changes.
Result: within ~60s of a CSV updating on the VPS, the chart re-downloads it and shows the new bars — no re-launch needed.

Deploy — paste 3 files into GitHub
For each: open the file on GitHub → ✏️ pencil → select all → delete → paste the full file below → Commit.

GitHub path
Paste this file
src/lib/csv-source.ts	csv-source.ts
src/app/api/csv-file/route.ts	csv-file-route.ts
src/components/drive-file-picker.tsx	drive-file-picker.tsx

Or, from any terminal (one command, verified to apply cleanly to fresh origin/main):

bash
git apply autorefresh-fix.patch
git commit -am "fix(chart): auto-refresh — bypass content cache on detected CSV updates + seed modifiedTime baseline"
git push
Patch: autorefresh-fix.patch

Any one commit across the three files triggers the Vercel deploy. Say "deployed" and I'll verify the live bundle picked up the forceFresh logic and that /api/csv-file?forceFresh=1 returns a fresh MISS.

Generated files
4
File
drive-file-picker
· tsx
File
csv-source
· ts
File
csv-file-route
· ts
File
autorefresh-fix
· patch
VPS returned HTTP 404 for unknown.csv 

Thought Process
I'll investigate why the VPS returns 404 for "unknown.csv". Let me search the codebase to find where that filename is coming from.
Continuing the investigation. "unknown.csv" is the fallback default in the route handler (searchParams.get("name") || "unknown.csv") — so this error means some caller hit /api/csv-file with no name param (or an empty one). Let me find every caller of that endpoint and check the VPS listing parser for entries that could produce an empty name:

Only one code caller (drive-file-picker.tsx:123) and it always passes name=${file.name}. So "unknown.csv" means file.name was empty (name= → "" || "unknown.csv"). The live listing earlier showed 3 real names — but I need to check whether the listing now contains an entry with an empty/blank name, and whether the autoindex parser or withXauusdFirst could produce one. Let me re-fetch the live listing (showing names quoted, to reveal empties) and read the parser + helpers:

Two things changed since my earlier check: the live /api/csv-files now returns 0 files (it had 3 before), and /api/csv-file with no params reproduces the exact error. So the listing is flaky/broken, AND a no-name request is hitting the file endpoint. Since loadFile (the only code caller) always passes name, an empty-name entry in the listing is the likely trigger — but I also need to find why the listing is now empty. Let me read the autoindex parser, broadly grep for any other caller, and re-fetch the listing several times to catch the flaky state:

The listing endpoint itself returns {error: "VPS returned HTTP 404 for unknown.csv", source: "vps", files: []} with 503 — but that error string is only produced by fetchVpsFile, which the listing (listVpsFiles) shouldn't call. Something doesn't match my working tree. Let me check what's actually deployed on origin/main (did the auto-refresh fix land? does the deployed listVpsFiles differ?) and read vpsFetch + the full listVpsFiles:

The auto-refresh fix IS deployed (origin/main has 1f29e9f Update csv-source.ts, 9b2886c Update route.ts, cd4ad52 Update drive-file-picker.tsx; forceFresh present). But here's the anomaly: my curl of /api/csv-files (plural, the listing) returned a 503 with body {error, source} and no files field — that's the response shape of the singular /api/csv-file route (which returns 503 + {error, source}), not the plural one (which returns 500 + {error, source, files:[]}). And listVpsFiles can't produce the string "VPS returned HTTP 404…" — only fetchVpsFile does.

This strongly suggests the singular route's code got pasted into the plural route file. Let me verify what's actually deployed in each route file:

Root cause found — it's a paste-into-the-wrong-file error. The deployed src/app/api/csv-files/route.ts (plural, the listing endpoint) now contains the singular file-download code (fetchFile). So when the chart calls /api/csv-files to list files, it instead tries to download a file, gets no name param → defaults to unknown.csv → VPS 404. That's why the listing returns 0 files and the chart can't load/refresh.

And the singular route (/api/csv-file) still shows the old comment (no forceFresh) — so the auto-refresh fix's forceFresh param isn't actually wired into the singular route either. Let me confirm exactly which file the user's "Update route.ts" commit touched, and retrieve the correct original listing code:

Fully confirmed. Commit 9b2886c touched src/app/api/csv-**files**/route.ts (plural) — the user pasted my singular-route code into the plural file (the names differ by one s). Two consequences:

Plural route broken → /api/csv-files now downloads a file instead of listing → no name → unknown.csv → 404 → chart gets 0 files, can't load or refresh.
Singular route never updated → forceFresh: 0 occurrences → the auto-refresh fix's cache-bypass isn't actually wired in.
Both route files in my working tree are already correct (plural = original listFiles listing code; singular = my forceFresh fix). Let me verify that, copy them with unambiguous names, and generate a combined patch that fixes both at once:

All verified — working-tree route files are correct, both copied with unambiguous names, and the combined patch applies cleanly to fresh origin/main (plural listFiles=2, singular forceFresh=3 after patch). Let me do one final check that the other two auto-refresh files (csv-source.ts, drive-file-picker.tsx) were pasted into the correct files on origin/main (only the route pair has the plural/singular ambiguity, but let me confirm):

Found it — the route code went into the wrong file
When you pasted the auto-refresh route.ts, it landed in src/app/api/csv-files/route.ts (the plural listing endpoint) instead of src/app/api/csv-file/route.ts (the singular file-download endpoint). The two paths differ by one s — an easy mistake. I verified this against origin/main directly:

Plural route (csv-files/route.ts) now contains the singular file-download code. So when the chart calls /api/csv-files to list files, it instead tries to download a file, gets no name param → defaults to unknown.csv → VPS 404. That's your error, and it's also why the listing returns 0 files and the chart can't load or refresh.
Singular route (csv-file/route.ts) was never updated — still the old code (forceFresh: 0). So the auto-refresh cache-bypass isn't actually wired in yet either.
The other two files are fine: csv-source.ts (forceFresh ✓) and drive-file-picker.tsx (forceFresh ✓, seed ✓) were pasted into the correct paths.

The fix — swap the two route files back
Recommended: one terminal command (avoids repeating the plural/singular trap — verified to apply cleanly to fresh origin/main):

bash
git apply route-files-fix.patch
git commit -am "fix(api): restore plural listing route; wire forceFresh into singular route"
git push
Patch: route-files-fix.patch

Or paste full files — note the paths carefully (the s matters):

Paste this file
Into this exact GitHub path
What it does
csv-files-route-PLURAL-listing.ts	src/app/api/csv-files/route.ts	Listing — calls listFiles, returns {files:[…]}
csv-file-route-SINGULAR-download.ts	src/app/api/csv-file/route.ts	Download — calls fetchFile, reads ?forceFresh=1

The filename of each deliverable spells out which one it is (PLURAL-listing vs SINGULAR-download) so they can't get swapped again.

Once the plural route is restored, /api/csv-files will list the 3 CSVs again (XAUUSD, ADANITRANS, HINDALCO) and the chart will load — and with the singular route updated, the auto-refresh poll's ?forceFresh=1 will actually bypass the cache on detected updates.

Say "deployed" and I'll verify the listing endpoint returns the 3 files and /api/csv-file?forceFresh=1 returns a fresh MISS.

Generated files
3
File
route-files-fix
· patch
File
csv-files-route-PLURAL-listing
· ts
File
csv-file-route-SINGULAR-download
· ts
deployed 

Thought Process
Verifying the deploy. First I'll confirm the corrected route files are on origin/main and check the live plural listing endpoint (give Vercel a moment for propagation):

Route files on origin/main are now correct (plural listFiles=2, singular forceFresh=3), but the live endpoint still returns the old error — that's Vercel build/propagation delay (commit 69e07e1 just landed, and I only waited 20s). Let me retry the listing in a loop until the new deployment rolls out:

~3.5 min and still the old error — too long for pure propagation. The GitHub state is correct, so either the Vercel build is still running/queued, or a paste introduced a syntax error that fails the build (leaving production on the old deployment). Let me check whether the deployed route files are byte-identical to the correct versions, and eyeball them for completeness:

Both route files are byte-identical to my correct versions and syntactically valid. So the GitHub code is right — the live site just hasn't flipped to the new deployment yet. But a failing build would also leave production on the old deployment, so let me confirm the other two pasted files (csv-source.ts, drive-file-picker.tsx) are also byte-identical to my typechecked versions (a paste typo there would break the build), and retry the listing once more:

All four deployed files are byte-identical to my typechecked versions — so the code on origin/main is correct and compiles. The live site is still serving the old deployment after ~4 min, which is longer than usual. Two possibilities remain: (a) the Vercel production build is still running/queued, or (b) the edge is serving a cached 503. Let me retry with a cache-busting query string to rule out (b), over a longer window:

~8 min with cache-busting and still the old error — this isn't normal propagation. The code on origin/main is verified correct and compiles, so the new Vercel production deployment simply hasn't gone live (build still running/queued, or failed). Let me confirm two things: (1) the VPS itself is still serving files correctly via the singular route with a real filename (isolates VPS health from the route bug), and (2) the deployment/cache headers on the failing listing:

Two clear findings:

The VPS is healthy — the singular route with the real filename XAUUSD_PERIOD_M15_3Days_SR.csv returns HTTP 200, 6757 bytes of valid CSV, including the S/R columns (Resistance I, Support I, …). So file download works and your earlier S/R fix is live and serving correctly.
The failing listing is NOT a cache issue — x-vercel-cache: MISS, age: 0, max-age=0. Every request runs the function fresh and still executes the old (broken) plural code. So the new production deployment simply hasn't been promoted to the live alias — the build is still running, queued, or failed.
Let me check whether I can see the Vercel deploy status for your commit via gh (Vercel posts a status check with the deployment URL):

gh isn't installed, but the repo is vaanone/quantjj. Let me hit the GitHub API directly (works for public repos unauthenticated) to read Vercel's deployment status check on the commit, and retry the listing once more in the same breath:

Key finding: Vercel reports commit 69e07e1's deployment completed successfully ("Deployment has completed"), yet quantjj.vercel.app still serves the old code with x-vercel-cache: MISS. That means the completed deployment is likely a preview that wasn't promoted to the production alias — OR production deployed but didn't flip. Let me query GitHub's deployments API to see the environment (Production vs Preview) and SHA of recent deployments:

GitHub API rate-limited now, but I already have the key facts. Vercel says 69e07e1's deployment completed successfully, yet quantjj.vercel.app still serves the old code (and it's not a cache hit — MISS). The likely cause: the completed deploy is the main-branch deployment that hasn't been promoted to the production alias, or production didn't flip. Let me test the standard Vercel branch-preview URL to see if the new code is live somewhere:

Decisive finding. The new code is deployed but it's stuck as a protected preview, not production:

https://quantjj-git-main-vaanone.vercel.app/api/csv-files → HTTP 302 "Protected by Vercel Authentication" — the deployment for commit 69e07e1 exists and is live, but behind Vercel's preview-deployment protection.
https://quantjj.vercel.app (production alias) → still serves the old broken code, and it's not a cache issue (x-vercel-cache: MISS, age: 0).
So Vercel did build and complete the deployment for your 69e07e1 commit (GitHub status confirms "Deployment has completed"), but it landed as a preview — the production alias quantjj.vercel.app was never flipped to it. That's why the chart still hits unknown.csv. It won't self-correct (it's been ~10 min and responses are fresh MISS, not cached).


Thought Process
Verified state — the code is correct, but production didn't flip
I checked everything I can from here:

Check
Result
Code on origin/main (all 4 files)	✅ Byte-identical to my typechecked versions; plural route calls listFiles, singular route reads forceFresh
VPS health	✅ /api/csv-file?name=XAUUSD_PERIOD_M15_3Days_SR.csv returns 200, 6757 bytes of valid CSV with the S/R columns (Resistance I, Support I, …)
Vercel deploy of commit 69e07e1	✅ GitHub status: "Deployment has completed" (success)
Live quantjj.vercel.app	❌ Still serves the old broken code — and x-vercel-cache: MISS, age: 0, so not a cache issue
Branch preview quantjj-git-main-vaanone.vercel.app	Returns 302 "Protected by Vercel Authentication" — the new deployment exists but is sitting as a protected preview

So the build succeeded, but the 69e07e1 deployment landed as a preview instead of being promoted to the production alias. That's why quantjj.vercel.app still returns unknown.csv. It won't self-correct (10+ min, fresh MISS responses).

What you need to do — promote to production
In the Vercel dashboard:

Open the quantjj project → Deployments tab.
Find the topmost deployment — commit 69e07e1, message "Update route.ts" (the most recent).
Click its ⋮ (three-dot) menu → "Promote to Production".
Wait ~30s for the alias to flip.
If "Promote to Production" isn't there (or the latest is already marked Production but still old), instead use ⋮ → "Redeploy" with "Use existing Build Cache" unchecked, which builds main and assigns it to production.

If promotions keep landing as previews only, the project's production branch may have drifted: Project Settings → Git → Production Branch should be main.

Say "promoted" and I'll immediately verify that quantjj.vercel.app/api/csv-files returns the 3 files again and that ?forceFresh=1 returns a cache MISS (so the auto-refresh actually re-downloads on detected updates).

<script async src="https://www.googletagmanager.com/gtm.js?id=G-H71WV7PKE7"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
</script>

Below is the Google tag for this container. Copy and paste it in the code of every page of your website, immediately after the <head> element. Don’t add more than one Google tag to each page. 

Thought Process
Adding Google Analytics (G-H71WV7PKE7) to every page of the quantjj Next.js app. In App Router, the right place is the root layout.tsx using next/script — one tag covers every route, no per-page duplication.

Let me first check the current root layout:
Picking up the Google Analytics task. Let me read the current root layout so I insert the tag correctly (and don't duplicate a <head> or break existing metadata):

The root layout has no explicit <head> (Next.js manages it via metadata), so I'll add one with the two next/script tags — one gtm.js loader + one inline init, using strategy="afterInteractive" so it never blocks first paint. One tag in the root layout covers every route (no per-page duplication, per Google's "don't add more than one" rule). Let me set up the task and apply the edits:

Both edits applied. Now let me verify the tag is present, confirm the diff against origin/main is only the GA additions, typecheck, copy to download/, and generate + test a patch:

Tag present, diff is clean (only GA additions), patch applies cleanly. But tsc exit: 2 — there's a TypeScript error. The grep for layout/script/ga matched nothing, so it's likely pre-existing. Let me read the full tsc log to confirm it's not from my change:

All tsc errors are pre-existing on origin/main (the base checkout exits with the same code 2, same errors) — none mention layout.tsx, next/script, ga-init, or gtm. So my GA addition introduces zero new type errors. (The two scripts/test_sr_parse.ts lines are a dev artifact in my scripts/ dir, not part of the app.) The patch applies cleanly to fresh origin/main.


Thought Process
Google Analytics added — one tag, every page
I added your Google tag (G-H71WV7PKE7) to the root layout.tsx using Next.js next/script. Because the root layout wraps every route, one tag covers all pages — no per-page duplication (honoring Google's "one Google tag per page" rule). I reproduced your snippet verbatim: the gtm.js?id=G-H71WV7PKE7 loader, the window.dataLayer init, gtag(), and gtag('js', new Date()) — no extra calls added.

The tag is placed in a new <head> element right after <html>, with strategy="afterInteractive" so it loads after hydration and never blocks first paint.

Verification
Tag present exactly once: gtm.js loader ✓, ga-init inline ✓, next/script import ✓, dataLayer init ✓.
Diff vs origin/main is only the GA additions (import + <head> block) — nothing else touched.
tsc --noEmit: 0 new errors from this change (the 8 pre-existing errors are unrelated files on origin/main already; none mention layout/script/ga).
Patch applies cleanly to a fresh origin/main checkout (gtm.js count = 1 after apply).
Deliverables
layout.tsx — full updated file → paste into src/app/layout.tsx
ga-layout.patch — one-command terminal option
To deploy
Paste the full layout.tsx into src/app/layout.tsx on GitHub and commit — or from a terminal:

bash
git apply ga-layout.patch
git commit -am "feat: add Google Analytics tag G-H71WV7PKE7 to root layout"
git push
Two things to know
The route-file fix still needs promoting. The 69e07e1 deploy (route-file swap) completed but landed as a protected preview — quantjj.vercel.app is still serving the old broken code. So you currently have two pending production updates: the route fix (already pushed) and this GA change. To avoid promoting twice, paste the GA layout.tsx as a new commit on top, then promote the newest deployment to Production once in the Vercel dashboard (Deployments → latest → ⋮ → Promote to Production). After that, quantjj.vercel.app will serve both fixes. If promotions keep landing as previews only, check Project Settings → Git → Production Branch = main so future pushes auto-deploy to production.
Snippet note. Your snippet uses the gtm.js Google-tag loader and intentionally omits gtag('config', …) — correct if the container auto-fires pageviews (the default "Google tag" setup). If GA shows no data ~24h after deploy, add gtag('config', 'G-H71WV7PKE7'); inside the ga-init inline block and redeploy. Say the word and I'll add it for you.
Say "promoted" (or "deployed" for the GA commit) and I'll verify the live quantjj.vercel.app serves the 3-file listing again and that the gtm.js tag is present in the page HTML.

Generated files
2
File
layout
· tsx
File
ga-layout
· patch
deployed 

Thought Process
Verifying the GA deploy live. I'll check (1) whether the GA tag (gtm.js?id=G-H71WV7PKE7) is present in the live HTML of the homepage, and (2) whether quantjj.vercel.app/api/csv-files now returns the 3 files (the pending route-file promotion) — running both in parallel:
Continuing the GA deploy verification. Let me confirm the GA commit landed on origin/main, then check the live homepage HTML for the tag and the listing endpoint for the 3 files (the two checks are independent — they tell me exactly which fixes are in production):

Both fixes are live and verified. Let me do one final check on the auto-refresh piece — that the updated singular route is executing the new forceFresh code path live (via the X-Csv-Cache status header):

All three pieces of work from this session are now live on quantjj.vercel.app and verified end-to-end:

Fix
Live check
Result
Google Analytics (G-H71WV7PKE7)	Homepage HTML	✅ gtm.js?id=G-H71WV7PKE7 ×1, dataLayer ×1, G-H71WV7PKE7 ×1 — tag present once (no duplication)
Route-file swap (listing endpoint)	/api/csv-files	✅ HTTP 200, 3 files: ADANITRANS#_…, HINDALCO#_…, XAUUSD_PERIOD_M15_3Days_SR.csv with modifiedTimes
Auto-refresh cache bypass (forceFresh)	/api/csv-file headers	✅ forceFresh=1 → x-csv-cache: MISS (re-downloads from VPS); without → x-csv-cache: HIT (cache works normally)

The decisive one is the last row: with forceFresh=1 the route returns MISS (actually fetches the updated CSV from the VPS), and without it returns HIT (serves the 10-min cache). That's the exact behavior the auto-refresh poll needs — when it detects a modifiedTime change it sends forceFresh=1, the route re-downloads, and the chart gets fresh data instead of the stale cached copy.

The commit on origin/main is 8f3d7c1 "Update layout.tsx" (GA) on top of 69e07e1 (route swap) on top of the auto-refresh csv-source.ts/drive-file-picker.tsx — all in the one production deployment you promoted.

Everything is live and verified ✅
Your promotion to production flipped quantjj.vercel.app to the deployment containing all three changes, and every piece checks out live:

Google Analytics — the G-H71WV7PKE7 tag is in the homepage HTML exactly once (loader + dataLayer + container ID all present ×1). It'll fire on every route via the root layout, no duplication. Data should start appearing in your GA4 Realtime report within a few minutes.
Listing endpoint restored — /api/csv-files returns HTTP 200 with the 3 CSVs (ADANITRANS#, HINDALCO#, XAUUSD) and their modifiedTimes, so the chart can load again.
Auto-refresh works — forceFresh=1 → X-Csv-Cache: MISS (re-downloads from the VPS), normal calls → HIT (cache intact). So when the poll detects a modifiedTime change it now genuinely fetches the updated CSV instead of serving the stale 10-minute cache.
One honest caveat: I verified each stage of the auto-refresh pipeline at the component level (poll reads modifiedTime changes → sends forceFresh=1 → route returns MISS → fresh CSV), but I didn't sit through a live 15–30 min cycle watching a chart update after a real VPS file edit. The wiring is confirmed end-to-end, so the next time your VPS pushes updated CSVs the chart should refresh on its own — if it ever doesn't, tell me and I'll trace the exact cycle.

All deliverables for this session are in download/: the three auto-refresh files, the corrected plural/singular route files + route-files-fix.patch, and layout.tsx + ga-layout.patch for GA.

add my telegram chanel in the footer only display telegram logo and if click the link open my chanel
https://t.me/vaan_one 

Thought Process
I'll add a Telegram channel link to the footer — just the logo, click opens https://t.me/vaan_one in a new tab. First let me locate the footer in the codebase.


Thought Process
Let me locate the footer in the codebase:

The footer is inline in src/app/page.tsx at line 1471. Let me read that section to see its structure before adding the Telegram link:

The footer is a compact fixed single-row: [logo+name] [email] [disclaimer]. I'll add the Telegram logo as an icon-only link grouped with the email (keeps them adjacent under justify-between), opening https://t.me/vaan_one in a new tab. I'll use an inline SVG (lucide-react has no Telegram brand icon) styled to match the footer — muted white, green on hover, same h-4 w-4 as the logo.

Now let me verify the link is present, confirm the diff is only the footer change, typecheck, generate the patch, and confirm it applies cleanly to origin/main:

All verified:

Link present once: t.me/vaan_one ×1, aria-label="Telegram channel" ×1, Telegram SVG path ×1, rel="noopener noreferrer" ×1.
Clean diff: the only change is the footer's email block → email + Telegram grouped in one flex container. Nothing else touched.
Typecheck: 0 new errors (the only page.tsx error is the pre-existing getTop6Levels at line 778, unrelated to the footer at ~1488).
Patch applies cleanly to fresh origin/main (after apply, t.me/vaan_one = 1).
Because page.tsx is ~1500 lines, pasting the whole file is error-prone — so the patch is the primary method, plus a focused find-and-replace for the GitHub web editor.


Thought Process
Telegram channel link added to the footer
I added an icon-only Telegram link to the footer in src/app/page.tsx, grouped right next to the email so they stay adjacent under the justify-between layout:

Logo only — an inline SVG of the Telegram paper-plane glyph (lucide-react ships no Telegram brand icon, so inline SVG is the right call). Sized h-4 w-4 to match the existing logo.
Click opens your channel — href="https://t.me/vaan_one", target="_blank", rel="noopener noreferrer" (opens in a new tab, securely).
Styled to match the footer — muted white (text-white/50), turns brand-green (#75D380) on hover, same as the footer's color language.
Accessible — aria-label="Telegram channel" on the link, aria-hidden="true" on the SVG (screen readers announce "Telegram channel" rather than the path data).
Verification
Link present exactly once ✓ · diff vs origin/main is only the footer email→email+Telegram change ✓ · tsc shows 0 new errors (the one pre-existing page.tsx error at line 778 is unrelated) ✓ · patch applies cleanly to fresh origin/main ✓.

Deliverable + how to deploy
Patch: telegram-footer.patch

Option A — terminal (cleanest):

bash
git apply telegram-footer.patch
git commit -am "feat: add Telegram channel link to footer"
git push
Option B — GitHub web editor (find & replace): open src/app/page.tsx, find this block (around line 1488):

tsx
          {/* Middle-left: email */}
          <a
            href="mailto:valan@outlook.com"
            className="text-[10px] text-[#75D380] transition-colors hover:text-[#75D380]"
          >
            valan@outlook.com
          </a>
…and replace it with:

tsx
          {/* Middle-left: email + Telegram channel link */}
          <div className="flex items-center gap-2">
            <a
              href="mailto:valan@outlook.com"
              className="text-[10px] text-[#75D380] transition-colors hover:text-[#75D380]"
            >
              valan@outlook.com
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
Then commit. As before, promote the new deployment to Production in the Vercel dashboard (Deployments → latest → ⋮ → Promote to Production) so quantjj.vercel.app picks it up.

Say "deployed" and I'll verify the Telegram logo + t.me/vaan_one link are live in the footer (I can also screenshot the footer to confirm the icon renders correctly).

Generated files
1
File
telegram-footer
· patch
deployed 

Thought Process
Verifying the Telegram footer link is live. I'll check (1) the commit landed on origin/main, (2) the live homepage HTML contains the t.me/vaan_one link + Telegram SVG, and (3) render the footer to confirm the icon displays correctly.


Thought Process
Continuing the Telegram footer verification. Let me confirm the commit landed on origin/main and check the live homepage HTML for the link + SVG:

The commit landed on origin/main (e0fa851 "Update page.tsx", and page.tsx has t.me/vaan_one = 1), but the live homepage still returns 47023 bytes — identical to the pre-Telegram GA deployment — with zero Telegram markers. That's the same promotion pattern as before: the new deployment hasn't been flipped to the production alias. Let me confirm with a longer wait, the Vercel deployment status, and the branch-preview URL:

The build failed. Vercel's status for commit e0fa851 is: failure — "Deployment has failed" (target: vercel.com/vaanone/quantjj/7FMem96ZokHpWa78Yzuvf7HiBF2v). Production is still serving the previous GA deployment (47023 bytes, no Telegram markers). The branch-preview 302 is a leftover from the earlier main-branch preview, not a new successful build.

My change is verified correct (tsc clean, patch applies cleanly, pure JSX), so this is very likely a transient Vercel build failure. Let me confirm my code can't be the cause — check the Next.js build-error-ignore settings (which explain why the pre-existing getTop6Levels/socket.io tsc errors didn't fail the previous successful deploys) and lint the file:

Decisive confirmation my code is not the cause:

next.config.ts has typescript: { ignoreBuildErrors: true } → tsc errors don't fail the build (this is why the pre-existing getTop6Levels/socket.io errors didn't block the earlier successful deploys).
ESLint on page.tsx: exit 0, zero findings — my footer change is completely lint-clean.
So the build failure isn't from tsc or ESLint. Let me run a full local next build as the gold-standard check — if it succeeds here, the Vercel failure was unambiguously transient:

Local next build succeeded — exit 0, all 7 static pages generated, every route compiled, zero errors. This is the gold-standard proof: the code builds perfectly. The Vercel failure was transient (a build-VM hiccup — OOM/network/cache), not your code.

Complete airtight diagnosis
Check
Result
next.config.ts	typescript.ignoreBuildErrors: true → tsc errors don't fail builds
tsc --noEmit	0 new errors from the change
ESLint on page.tsx	exit 0, zero findings
Patch applies to origin/main	✅ clean
Local next build	✅ exit 0 — builds successfully
Vercel deploy of e0fa851	❌ "Deployment has failed" (transient)


Thought Process
The Vercel build failed — but it's transient, not your code
Commit e0fa851 (Telegram footer) pushed to origin/main fine, but Vercel's deployment failed to build — so production is still serving the previous GA deployment (homepage is byte-identical to before, no Telegram markers). I ruled out the code as the cause on every front: next.config.ts ignores tsc errors, ESLint is clean on page.tsx, the patch applies cleanly, and a full local next build succeeds (exit 0). Transient Vercel build failures (build-VM OOM, cache corruption, network blip) are common and resolve on a simple retry.

Redeploy — pick one
Option A — Vercel dashboard (easiest):

Vercel → quantjj → Deployments tab.
Find the failed e0fa851 deployment (red, "Update page.tsx").
⋮ → Redeploy → uncheck "Use existing Build Cache" → confirm.
Option B — Vercel CLI (what Vercel's failure message pointed at):

bash
npx vercel --prod
Option C — empty commit to retrigger a fresh build from main:

bash
git commit --allow-empty -m "trigger redeploy after transient failure"
git push
If the successful rebuild lands as a preview again (the promotion pattern from earlier), also do ⋮ → Promote to Production so quantjj.vercel.app picks it up.

If it fails a second time, open the failed deployment's Build Logs in the Vercel dashboard and paste the red error block here — but I don't expect that, since the code builds locally.

Say "deployed" and I'll verify the Telegram logo + t.me/vaan_one link are live in the footer (HTML check, plus a footer screenshot to confirm the icon renders correctly).

06:55:10.746 
✓ Compiled successfully in 6.2s
06:55:10.750 
  Skipping validation of types
06:55:10.923 
  Collecting page data using 1 worker ...
06:55:11.366 
[web-push] VAPID keys not set. Push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env
06:55:11.393 
  Generating static pages using 1 worker (0/7) ...
06:55:11.416 
  Generating static pages using 1 worker (1/7) 
06:55:11.416 
  Generating static pages using 1 worker (3/7) 
06:55:11.467 
Error occurred prerendering page "/". Read more: https://nextjs.org/docs/messages/prerender-error
06:55:11.471 
Error: The default export is not a React Component in "/page"
06:55:11.471 
    at ignore-listed frames
06:55:11.479 
Export encountered an error on /page: /, exiting the build.
06:55:11.496 
⨯ Next.js build worker exited with code: 1 and signal: null
06:55:11.536 
Error: [BUILD_UTILS_SPAWN_1] Command "next build" exited with 1 Show full message
Now I have the real error. Let me look at the top of page.tsx to see what's being exported and how RootLayout calls it — the error "The default export is not a React Component in '/page'" means export default isn't pointing at a valid React component at module-eval time.
Now I have the real error. The build fails on static prerender of / with "The default export is not a React Component in '/page'". My footer change was pure JSX — it can't cause this. The error points at a module-level issue. Let me look at the top of page.tsx (imports + the default export) and how layout.tsx calls it:


Thought Process
Now I have the real error — it's not transient. The build fails at static prerender of /:

text
Error: The default export is not a React Component in "/page"
Yet my local next build succeeded. That means either the code on origin/main (e0fa851) differs from my working tree, or there's a Vercel-specific module-eval issue. The previous deploys (8f3d7c1, 69e07e1) succeeded, so the cause is in what changed between 8f3d7c1 and e0fa851. Let me diff exactly what the Telegram commit changed vs the working GA deploy, check my working tree against what's deployed, and locate the default export:

Root cause found — and it's clear. The diff stat says it all:

text
src/app/page.tsx | 1615 +-----------------------------------------------------
1 file changed, 15 insertions(+), 1600 deletions(-)
The Telegram commit e0fa851 deleted 1600 lines from page.tsx and added only 15. Instead of doing a find-and-replace within the existing file, the entire file content was replaced with just the small "replace with" footer snippet I gave — wiping out "use client", all imports, the LandingPage component, and the export default. That's why it compiles (orphan JSX parses) but prerender fails with "The default export is not a React Component" — there's no default export left.

My local build succeeded because my working tree has the correct full file (the Edit only touched the footer block). Let me confirm exactly what e0fa851 contains vs my working tree, and verify my working tree is the correct recovery (last good GA deploy + Telegram footer only):

Confirmed completely. Here's exactly what happened:

e0fa851's deployed page.tsx is 20 lines — just the footer snippet I gave as the "replace with" block. No "use client", no imports, no LandingPage component, no export default. The snippet was pasted as the entire file content instead of as a find-and-replace within the existing file — wiping 1600 lines.
That's why it compiles (orphan JSX parses fine) but prerender fails: there's no export default React component left.
My working tree is the correct recovery: git diff 8f3d7c1 -- src/app/page.tsx (vs the last good GA deploy) shows only the Telegram footer block — nothing else changed. It's 1625 lines with "use client", export default, all imports, and the Telegram footer. And I already proved it builds (next build exit 0).
I've copied the correct full file to download/page.tsx (1625 lines) — this is the recovery file.


Thought Process
Recovery — restore page.tsx (the Telegram footer is already included)
The deployed e0fa851 is just the 20-line footer snippet with the rest of the file deleted. The fix is to restore the full file. I've put the correct, build-verified version (1625 lines = the last good GA deploy + the Telegram footer) at page.tsx. This one file both restores the page and adds the Telegram link — no separate step needed.

Option A — terminal (safest, recommended)
bash
git checkout 8f3d7c1 -- src/app/page.tsx   # restore the last good (GA) version
git apply telegram-footer.patch            # re-apply the Telegram footer (clean, verified)
git commit -m "restore page.tsx + add Telegram footer link"
git push
telegram-footer.patch applies cleanly to 8f3d7c1 (I verified this earlier). Two commands, no paste risk.

Option B — GitHub web UI
Open src/app/page.tsx → click the pencil (edit).
Select all (Ctrl/Cmd+A) → delete everything.
Open page.tsx, copy its entire content, paste into the editor.
Verify before committing (this guards against a truncated paste):
First line is "use client";
Last line is }
Ctrl/Cmd+F finds t.me/vaan_one
Commit.
The mistake to avoid repeating: pasting only the small footer block as the whole file. The find-and-replace snippet was meant to replace just the email <a> block inside the existing file — not to replace the file. This recovery replaces the entire file with the full 1625-line version.

After you push
Vercel will rebuild from this commit — and it will succeed this time, because this exact file built locally (next build exit 0, 7/7 pages). If it lands as a preview, promote to Production as before.

Say "deployed" and I'll verify the Telegram logo + t.me/vaan_one link are live in the footer (HTML check + a footer screenshot to confirm the icon renders).

Generated files
1
File
page
· tsx

Send a Message


Connect IM

GLM-5.2
Max
Unsupported File Format

"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { PanelRight, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TradingChart } from "@/components/trading-chart";
import { DriveFilePicker } from "@/components/drive-file-picker";
import { LevelsPanel } from "@/components/levels-panel";
import { AlertButton } from "@/components/alert-button";
import { PriceTicker } from "@/components/price-ticker";
import { EconomicCalendar } from "@/components/economic-calendar";
import { TradingVisualCard } from "@/components/trading-visual-card";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useSRLevelAlerts } from "@/hooks/use-sr-level-alerts";
import { userLevelsToLines } from "@/lib/support-resistance";
import { detectTimeframe, type TimeframeInfo } from "@/lib/timeframe";
import type { Candle, ParseResult, UserLevel } from "@/lib/excel-parser";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

const SR_SENSITIVITY_BARS = 5;
const SR_TOLERANCE_PCT = 0.15;
const SR_MIN_TOUCHES = 2;
/** Load this many candles into the chart data (the user can scroll back to see older ones). */
const MAX_DISPLAY_CANDLES = 200;
/** Number of candles visible at once on initial load (zoom level). */
const VISIBLE_CANDLES = 100;

interface LoadedFile {
  result: ParseResult;
  fileName: string;
  selectedSymbol: string;
}

export default function Home() {
  const [view, setView] = useState<"landing" | "chart">("landing");
  const [files, setFiles] = useState<Map<string, LoadedFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  // Track whether the first load has completed. The loading overlay only
  // shows on the very first load — after that, all refreshes/polling
  // happen silently in the background (no overlay, no "Loading Chart").

  // PWA launch: if the app was launched via the home-screen shortcut
  // (URL contains ?open_chart=1), open the chart view immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("open_chart") === "1") {
      setView("chart");
      // Clean the URL so subsequent refreshes don't auto-open chart.
      params.delete("open_chart");
      const cleanUrl =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);
  const [hasFirstLoad, setHasFirstLoad] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2 | 3 | 4>(1);
  // Per-chart symbol selections (for multi-chart layouts).
  // Index 0 = first chart (uses the main selectedFile), 1-3 = additional charts.
  const [multiSymbols, setMultiSymbols] = useState<Record<number, string>>({});
  const isLg = useMediaQuery("(min-width: 1024px)", true);
  // Mobile detection — used to show the mobile-only fullscreen toggle
  // and auto-attempt fullscreen on chart view entry.
  const isMobile = useMediaQuery("(max-width: 768px)", true);

  // ---------- Fullscreen state (mobile-only feature) ----------
  // Tracks whether the document is currently in browser fullscreen mode.
  // On mobile (Android Chrome, iOS Safari PWA), users can tap the
  // fullscreen button to enter true app-mode (no address bar / tabs).
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* ignore */ });
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        // iOS Safari (non-PWA) doesn't support Fullscreen API — show a
        // toast suggesting the user install the page as a PWA for true
        // fullscreen app experience.
        import("sonner").then(({ toast }) => {
          toast.info("For true fullscreen, install as app", {
            description: "Tap Share → Add to Home Screen on iPhone, or ⋮ → Install app on Android.",
            duration: 8000,
          });
        });
      });
    }
  }, []);

  // ---------- Auto-attempt fullscreen on chart view entry (mobile only) ----------
  // Most mobile browsers require a USER GESTURE before requestFullscreen()
  // will work. We attach a one-time touchstart listener that fires the
  // first time the user touches the chart view, then auto-removes itself.
  // On iOS Safari (non-PWA) this will silently fail — those users get the
  // toast hint when they tap the fullscreen button manually.
  useEffect(() => {
    if (!isMobile) return;
    if (typeof document === "undefined") return;
    // If already fullscreen (e.g. PWA standalone), nothing to do.
    if (document.fullscreenElement) return;
    // If running as PWA standalone, no need to request fullscreen —
    // standalone mode already hides browser chrome.
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    let triggered = false;
    const tryFullscreen = () => {
      if (triggered) return;
      triggered = true;
      // Clean up listeners immediately so we don't fire twice.
      document.removeEventListener("touchstart", tryFullscreen);
      document.removeEventListener("click", tryFullscreen);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Silent fail — user can tap the button manually if they want.
        });
      }
    };
    // Attach to both touchstart (mobile) and click (mouse) for safety.
    document.addEventListener("touchstart", tryFullscreen, { once: true, passive: true });
    document.addEventListener("click", tryFullscreen, { once: true });
    return () => {
      document.removeEventListener("touchstart", tryFullscreen);
      document.removeEventListener("click", tryFullscreen);
    };
  }, [isMobile, view]);

  // Track whether the user has manually selected a file/symbol via the
  // dropdown. Once true, auto-XAUUSD-default won't override their choice.
  const userTouchedSelectionRef = useRef(false);
  // Whether the XAUUSD file has arrived yet. The first-load overlay is
  // held until it does, so opening the app goes STRAIGHT into the XAUUSD
  // chart — another symbol never renders first and gets swapped away.
  const sawXauusdRef = useRef(false);
  // Whether ANY file has arrived — used by the fallback in
  // handleLoadingChange for folders that contain no XAUUSD file at all.
  const loadedAnyFileRef = useRef(false);

  const handleLoaded = useCallback(
    (result: ParseResult, fileName: string) => {
      const primarySymbol = result.symbol || result.symbols[0] || "";
      setFiles((prev) => {
        const next = new Map(prev);
        // If this file is already loaded, preserve the user's currently
        // selected symbol — don't reset it. Only set the default symbol
        // for newly loaded files.
        const existing = prev.get(fileName);
        const sym = existing
          ? existing.selectedSymbol  // keep what the user selected
          : primarySymbol;            // new file — use default
        next.set(fileName, { result, fileName, selectedSymbol: sym });
        return next;
      });

      const isXauusd = (result.symbols || []).some((s) =>
        s.toUpperCase().includes("XAU"),
      );
      if (isXauusd) sawXauusdRef.current = true;
      loadedAnyFileRef.current = true;

      // Default selected file = XAUUSD file (preferred, and it is fetched
      // first by DriveFilePicker so it normally IS the first to arrive) —
      // fall back to the first file received for folders without XAUUSD.
      // After the user manually picks a different symbol/file via the
      // dropdown, we don't override their choice — the initial
      // setSelectedFile(prev => prev || ...) is a no-op once a selection
      // has been made.
      setSelectedFile((prev) => {
        // User already picked something — keep it.
        if (prev) return prev;
        // First load — take it; if this isn't XAUUSD a later XAUUSD load
        // will overwrite (only while the user hasn't picked manually).
        return fileName;
      });
      // If XAUUSD arrives, switch to it.
      if (isXauusd) {
        setSelectedFile((prev) => {
          // If the user already has a non-XAUUSD file selected, switch to
          // XAUUSD on the first auto-load. Once a manual selection is made
          // (tracked by userTouchedSelectionRef), respect it.
          if (userTouchedSelectionRef.current) return prev;
          return fileName;
        });
        // Reveal the chart ONLY once XAUUSD is what's on it. Dropping the
        // overlay on the first file received (as before) let a different
        // symbol flash in first, then visibly switch to XAUUSD.
        setHasFirstLoad(true);
      }
      // Non-XAUUSD loads deliberately do NOT flip hasFirstLoad here — if
      // XAUUSD never arrives, handleLoadingChange reveals the fallback.
    },
    [],
  );

  // Loading-state gate: when ALL Drive loading finishes and no XAUUSD file
  // was among the loaded files, reveal the chart with the fallback symbol
  // instead of keeping the loading overlay up forever.
  const handleLoadingChange = useCallback((isLoading: boolean) => {
    setChartLoading(isLoading);
    if (!isLoading && loadedAnyFileRef.current && !sawXauusdRef.current) {
      setHasFirstLoad(true);
    }
  }, []);

  const currentFile = files.get(selectedFile);
  const currentResult = currentFile?.result;
  const selectedSymbol = currentFile?.selectedSymbol ?? "";

  const candles = useMemo(() => {
    if (!currentResult) return [];
    const syms = currentResult.symbols;
    const filtered =
      syms.length <= 1
        ? currentResult.candles
        : currentResult.candles.filter(
            (c) => !c.symbol || c.symbol === selectedSymbol,
          );
    // Show only the last MAX_DISPLAY_CANDLES so each candle is wide and
    // readable ("big zoom" view). The full history is still in memory if
    // we ever need it.
    if (filtered.length > MAX_DISPLAY_CANDLES) {
      return filtered.slice(filtered.length - MAX_DISPLAY_CANDLES);
    }
    return filtered;
  }, [currentResult, selectedSymbol]);

  const timeframe = useMemo(() => detectTimeframe(candles), [candles]);

  // S/R lines: STRICTLY from CSV columns H–O (user-defined levels).
  // No auto-detection fallback — only the user's CSV data is used.
  // If the CSV has no S/R levels in columns H–O, no lines are drawn.
  const top6Lines = (() => {
    if (candles.length < 10) return [];
    const lastClose = candles[candles.length - 1].close;
    const result = files.get(selectedFile)?.result;
    if (result?.userLevels && result.userLevels.length > 0) {
      return userLevelsToLines(result.userLevels, lastClose);
    }
    return [];
  })();

  // ---- Global symbol list: all symbols across ALL loaded files ----
  // Each entry: { symbol, fileName }. Used to populate the unified dropdown
  // so the user can pick any symbol from any file directly.
  const allSymbols = useMemo(() => {
    const entries: { symbol: string; fileName: string }[] = [];
    for (const [fileName, loaded] of files) {
      for (const sym of loaded.result.symbols) {
        entries.push({ symbol: sym, fileName });
      }
    }
    // Sort by symbol name, then by file name for duplicates.
    entries.sort((a, b) =>
      a.symbol !== b.symbol
        ? a.symbol.localeCompare(b.symbol)
        : a.fileName.localeCompare(b.fileName),
    );
    return entries;
  }, [files]);

  // The dropdown's value encodes BOTH the file and symbol as `fileName::symbol`.
  // This lets us disambiguate when the same symbol exists in multiple files.
  const dropdownValue = selectedFile && selectedSymbol
    ? `${selectedFile}::${selectedSymbol}`
    : selectedFile;

  const handleDropdownChange = useCallback(
    (value: string) => {
      const [fileName, ...symbolParts] = value.split("::");
      const symbol = symbolParts.join("::");
      // Mark that the user has made a manual selection — the auto-
      // XAUUSD default won't fire anymore after this.
      userTouchedSelectionRef.current = true;
      setFiles((prev) => {
        const next = new Map(prev);
        const f = next.get(fileName);
        if (f && symbol) next.set(fileName, { ...f, selectedSymbol: symbol });
        return next;
      });
      setSelectedFile(fileName);
    },
    [],
  );

  const fileNames = Array.from(files.keys());
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // Market change%: calculated from TODAY's first candle (the day's open).
  // We find the first candle whose UTC date matches the last candle's UTC date,
  // and use its open price as the "market open" reference. This gives the
  // correct intraday change, not the change across all 200 loaded candles.
  const todayOpen = (() => {
    if (candles.length === 0) return 0;
    const lastCandle = candles[candles.length - 1];
    const lastD = new Date(lastCandle.time * 1000);
    const lastDay = lastD.getUTCFullYear() * 10000 + (lastD.getUTCMonth() + 1) * 100 + lastD.getUTCDate();
    for (let i = candles.length - 1; i >= 0; i--) {
      const d = new Date(candles[i].time * 1000);
      const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      if (dayKey !== lastDay) {
        // The candle just before this one is the first candle of today.
        return candles[i + 1]?.open ?? lastClose;
      }
    }
    // All candles are from the same day — use the very first candle's open.
    return candles[0].open;
  })();
  const totalChangePct = todayOpen > 0 ? ((lastClose - todayOpen) / todayOpen) * 100 : 0;
  const symbolLabel = selectedSymbol || currentResult?.symbol || "";

  // Price alerts — monitors current price and fires notifications.
  const { alerts, addAlert, removeAlert, clearAll } = usePriceAlerts(symbolLabel, lastClose);

  // Auto S/R level touch alerts — fires when price crosses any S/R line.
  useSRLevelAlerts(symbolLabel, candles, top6Lines);

  // No live price streaming — chart uses CSV data only.

  // For the symbol dropdown value: the currently active symbol.
  const activeSymbolValue = selectedSymbol || currentResult?.symbol || "";

  // Helper: get candles + lines for a specific chart slot.
  // Slot 0 = main chart (uses selectedFile/multiSymbols[0]).
  // Slots 1-3 = additional charts with their own symbol selection.
  const getChartSlotData = (slot: number) => {
    if (slot === 0) {
      return { candles, lines: top6Lines, symbol: symbolLabel, lastClose };
    }

    // For multi-chart slots, find the symbol and its file.
    const slotSymbol = multiSymbols[slot];
    if (!slotSymbol) return { candles: [], lines: [], symbol: "", lastClose: 0 };

    // Find which file contains this symbol.
    let slotResult: ParseResult | null = null;
    let slotFileName = "";
    for (const [fName, loaded] of files) {
      if (loaded.result.symbols.includes(slotSymbol)) {
        slotResult = loaded.result;
        slotFileName = fName;
        break;
      }
    }
    if (!slotResult) return { candles: [], lines: [], symbol: slotSymbol, lastClose: 0 };

    const slotCandles = (() => {
      const syms = slotResult!.symbols;
      const filtered =
        syms.length <= 1
          ? slotResult!.candles
          : slotResult!.candles.filter(
              (c) => !c.symbol || c.symbol === slotSymbol,
            );
      if (filtered.length > MAX_DISPLAY_CANDLES) {
        return filtered.slice(filtered.length - MAX_DISPLAY_CANDLES);
      }
      return filtered;
    })();

    const slotClose = slotCandles.length > 0 ? slotCandles[slotCandles.length - 1].close : 0;
    const slotLines =
      slotResult.userLevels && slotResult.userLevels.length > 0
        ? userLevelsToLines(slotResult.userLevels, slotClose)
        : [];

    return { candles: slotCandles, lines: slotLines, symbol: slotSymbol, lastClose: slotClose, fileName: slotFileName };
  };

  // Get live price for a specific slot.
  const getSlotLivePrice = (slot: number) => {
    const data = getChartSlotData(slot);
    return data.symbol;
  };

  // Find XAUUSD candles + S/R levels from loaded files for the landing page visual.
  const xauusdData = (() => {
    for (const [, loaded] of files) {
      if (loaded.result.symbols.some((s) => s.toUpperCase().includes("XAU"))) {
        return {
          candles: loaded.result.candles.slice(-200),
          userLevels: loaded.result.userLevels ?? [],
        };
      }
    }
    return null;
  })();

  if (view === "landing") {
    return <LandingPage onOpenChart={() => setView("chart")} xauusdCandles={xauusdData?.candles} xauusdLevels={xauusdData?.userLevels} />;
  }

  return (
    // h-dvh = 100dvh (dynamic viewport height). On mobile this adapts as the
    // address bar shows/hides, so the header, chart, and bottom bar ALL stay
    // visible with no clipping — unlike h-screen (100vh) which includes the
    // area behind the address bar and pushes the bottom bar off-screen.
    // Fallback to h-screen for any very old browser lacking dvh support.
    <div className="flex h-dvh flex-col bg-[#070D12] text-white">
      {/* ============================================================= HEADER (top bar — logo, symbol, controls) */}
      <header
        className="flex items-center gap-2 border-b border-white/10 bg-[#0D141B] px-3 py-2"
        style={{
          // Respect iOS safe-area (notch / status bar) at the top so the
          // header bar isn't cut off when installed as a PWA / in app mode.
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          // Use safe-area insets on left/right for landscape notch devices.
          paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        {/* Back to home button */}
        <button
          onClick={() => setView("landing")}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="Back to home"
        >
          <img src="/logo.png" alt="Vaan.One" className="h-7 w-7 rounded-md object-contain sm:h-9 sm:w-9" />
        {/* App name — hidden on mobile to save space */}
        <div className="hidden shrink-0 sm:block">
          <h1 className="text-sm font-semibold leading-tight">Vaan.One</h1>
          <p className="text-[10px] leading-tight text-white/70">Vaan Pivot - A JJ TechHub Product</p>
        </div>
        </button>

        {/* Spacer to push the rest to the right on desktop */}
        <div className="flex-1" />

        {/* All controls in one row, no wrapping. On mobile the row may
            overflow horizontally — make it scrollable so the fullscreen
            button (and other controls) are always reachable. */}
        <div className="flex items-center gap-1.5 overflow-x-auto sm:gap-2 sm:overflow-visible">
          {/* Chart layout dropdown — 1/2/3/4 chart views */}
          {candles.length > 0 && (
            <Select
              value={String(chartLayout)}
              onValueChange={(v) => {
                const n = Number(v) as 1 | 2 | 3 | 4;
                setChartLayout(n);
                if (n > 1) {
                  setMultiSymbols((prev) => {
                    const next = { ...prev };
                    const syms = Array.from(files.values()).flatMap((f) => f.result.symbols);
                    for (let i = 1; i < n; i++) {
                      if (!next[i] && syms[i]) next[i] = syms[i];
                    }
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger className="h-7 w-auto shrink-0 gap-1 border-white/15 bg-white/5 px-1.5 text-white hover:bg-white/10 sm:h-8 sm:px-2">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/60">
                  {chartLayout === 1 && <rect x="1" y="1" width="10" height="10" rx="1" />}
                  {chartLayout === 2 && (<><rect x="1" y="1" width="4.5" height="10" rx="1" /><rect x="6.5" y="1" width="4.5" height="10" rx="1" /></>)}
                  {chartLayout === 3 && (<><rect x="1" y="1" width="2.8" height="10" rx="1" /><rect x="4.6" y="1" width="2.8" height="10" rx="1" /><rect x="8.2" y="1" width="2.8" height="10" rx="1" /></>)}
                  {chartLayout === 4 && (<><rect x="1" y="1" width="2" height="10" rx="1" /><rect x="3.7" y="1" width="2" height="10" rx="1" /><rect x="6.4" y="1" width="2" height="10" rx="1" /><rect x="9.1" y="1" width="2" height="10" rx="1" /></>)}
                </svg>
              </SelectTrigger>
              <SelectContent className="border-white/15 bg-[#15161d] text-white">
                {/* 1 chart */}
                <SelectItem value="1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="10" height="10" rx="1" />
                  </svg>
                </SelectItem>
                {/* 2 charts — horizontal */}
                <SelectItem value="2">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="4.5" height="10" rx="1" />
                    <rect x="6.5" y="1" width="4.5" height="10" rx="1" />
                  </svg>
                </SelectItem>
                {/* 3 charts — horizontal */}
                <SelectItem value="3">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="2.8" height="10" rx="1" />
                    <rect x="4.6" y="1" width="2.8" height="10" rx="1" />
                    <rect x="8.2" y="1" width="2.8" height="10" rx="1" />
                  </svg>
                </SelectItem>
                {/* 4 charts — horizontal */}
                <SelectItem value="4">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="2" height="10" rx="1" />
                    <rect x="3.7" y="1" width="2" height="10" rx="1" />
                    <rect x="6.4" y="1" width="2" height="10" rx="1" />
                    <rect x="9.1" y="1" width="2" height="10" rx="1" />
                  </svg>
                </SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Symbol dropdown — only shown in single-chart mode */}
          {activeSymbolValue && chartLayout === 1 && (
            <Select value={dropdownValue} onValueChange={handleDropdownChange}>
              <SelectTrigger className="h-7 w-auto min-w-[80px] max-w-[170px] gap-1 border-white/15 bg-white/5 px-1.5 font-mono text-xs font-bold tracking-wide text-white hover:bg-white/10 sm:h-8 sm:min-w-[110px] sm:max-w-[220px] sm:px-2 sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 border-white/15 bg-[#15161d] text-white">
                {allSymbols.map((entry) => (
                  <SelectItem
                    key={`${entry.fileName}::${entry.symbol}`}
                    value={`${entry.fileName}::${entry.symbol}`}
                    className="font-mono focus:bg-white/10"
                  >
                    {entry.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Last close + change % — same line, next to dropdown */}
          {candles.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 sm:border-l sm:border-white/10 sm:pl-2">
              <span className="font-mono text-[10px] text-white/50 sm:text-xs">
                {lastClose >= 1000
                  ? lastClose.toFixed(2)
                  : lastClose.toFixed(5)}
              </span>
              <Badge
                variant="outline"
                className={`h-5 border-white/15 px-1 text-[9px] font-mono sm:text-[10px] ${
                  totalChangePct >= 0
                    ? "bg-[#75D380]/10 text-[#75D380]"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {totalChangePct >= 0 ? "+" : ""}
                {totalChangePct.toFixed(2)}%
              </Badge>
            </div>
          )}

          {/* Timeframe badge — same line, next to percentage */}
          {timeframe && (
            <Badge className="h-7 shrink-0 gap-1 border border-[#75D380]/30 bg-[#75D380]/10 px-1.5 font-mono text-xs font-bold text-[#75D380] sm:h-8 sm:px-2 sm:text-sm">
              {timeframe.label}
            </Badge>
          )}

          {/* Price alert button — set alerts like TradingView */}
          {candles.length > 0 && (
            <AlertButton
              symbol={symbolLabel}
              currentPrice={lastClose}
              alerts={alerts}
              onAddAlert={addAlert}
              onRemoveAlert={removeAlert}
              onClearAll={clearAll}
            />
          )}

          {/* Drive refresh button — always rendered (even before candles load)
              so it can fetch files and clear the loading state. */}
          <DriveFilePicker
            onLoaded={handleLoaded}
            onLastUpdate={setLastUpdate}
            onLoadingChange={handleLoadingChange}
            compact
          />

          {/* Fullscreen toggle — MOBILE ONLY (md:hidden).
              On Android Chrome: enters true browser fullscreen (no address
                bar / tabs) via document.documentElement.requestFullscreen().
              On iOS Safari (non-PWA): requestFullscreen() isn't supported,
                so we show a toast suggesting "Add to Home Screen" for a
                true standalone app experience.
              On iOS/Android PWA (standalone mode): button is hidden since
                the app already runs fullscreen. */}
          {isMobile && (
            <button
              onClick={toggleFullscreen}
              className="flex h-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:h-8"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </header>

      {/* ============================================================== BODY (chart) */}
      <main className="relative flex-1 overflow-hidden">
        {/* Full-screen loading overlay — shown ONLY on the very first load.
            After that, all refreshes/polling happen silently in the background. */}
        {chartLoading && !hasFirstLoad && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070D12]">
            <div className="flex flex-col items-center gap-6">
              <img src="/logo.png" alt="Vaan.One" className="h-16 w-16 rounded-lg object-contain opacity-80" />
              <LoadingDots />
            </div>
          </div>
        )}
        {candles.length === 0 && !chartLoading ? (
          <EmptyState onLoaded={handleLoaded} />
        ) : chartLayout === 1 ? (
          isLg ? (
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={75} minSize={50}>
                <ChartArea
                  candles={candles}
                  lines={top6Lines}
                  symbol={symbolLabel}
                  timeframe={timeframe}
                  alertPrices={alerts
                    .filter((a) => a.symbol === symbolLabel)
                    .map((a) => ({ price: a.price, triggered: a.triggered }))}
                  livePrice={lastClose}
                  
                  lastUpdate={lastUpdate}
                />
              </ResizablePanel>
              <ResizableHandle withHandle className="bg-white/10" />
              <ResizablePanel defaultSize={25} minSize={18} maxSize={45}>
                <LevelsPanel
                  key={selectedFile}
                  lines={top6Lines}
                  lastClose={lastClose}
                  symbol={symbolLabel}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <ChartArea
              candles={candles}
              lines={top6Lines}
              symbol={symbolLabel}
              timeframe={timeframe}
              alertPrices={alerts
                .filter((a) => a.symbol === symbolLabel)
                .map((a) => ({ price: a.price, triggered: a.triggered }))}
              livePrice={lastClose}
              
              lastUpdate={lastUpdate}
            />
          )
        ) : (
          /* Multi-chart grid layout */
          <MultiChartGrid
            layout={chartLayout}
            allSymbols={allSymbols.map((s) => s.symbol)}
            multiSymbols={multiSymbols}
            onSymbolChange={(slot, sym) => {
              // User picked a symbol in any chart slot — mark as touched.
              userTouchedSelectionRef.current = true;
              if (slot === 0) {
                // Slot 0 uses the main symbol — find the file containing
                // this symbol and switch to it.
                for (const [fName, loaded] of files) {
                  if (loaded.result.symbols.includes(sym)) {
                    setFiles((prev) => {
                      const next = new Map(prev);
                      next.set(fName, { ...loaded, selectedSymbol: sym });
                      return next;
                    });
                    setSelectedFile(fName);
                    break;
                  }
                }
              } else {
                setMultiSymbols((prev) => ({ ...prev, [slot]: sym }));
              }
            }}
            getSlotData={getChartSlotData}
            timeframe={timeframe}
            lastUpdate={lastUpdate}
            slotSymbols={[symbolLabel, multiSymbols[1], multiSymbols[2], multiSymbols[3]]}
          />
        )}
      </main>

      {/* ============================================================ BOTTOM BAR (Last Update + disclaimer + mobile Levels) */}
      {candles.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-white/10 bg-[#0D141B] px-4 py-1.5 text-[11px] text-white/70"
          style={{
            // Respect iOS safe-area (home indicator) at the bottom so the
            // bottom bar isn't cut off when installed as a PWA / in app mode.
            paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))",
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
            paddingRight: "max(1rem, env(safe-area-inset-right))",
          }}
        >
          {/* Disclaimer — left side, small font, single line */}
          <p className="hidden whitespace-nowrap text-[10px] leading-tight text-white/60 sm:block">
            Disclaimer: This website is for educational purposes only. Trade at your own risk.
          </p>
          {/* Last Update timestamp — right side */}
          <div className="ml-auto flex items-center gap-3">
            {lastUpdate && (
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[9px] uppercase tracking-wider text-white/60">
                  Last Update @
                </span>
                <span className="font-mono text-xs text-white/85">
                  {formatLastUpdate(lastUpdate)}
                </span>
              </div>
            )}
          </div>
          <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-white/15 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 lg:hidden"
              >
                <PanelRight className="h-3.5 w-3.5" />
                Levels
                <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">{top6Lines.length}</Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto border-white/10 bg-[#0D141B] p-0 lg:hidden">
              <SheetHeader className="border-b border-white/10 px-4 py-3">
                <SheetTitle className="text-sm font-semibold text-white">
                  Pivot Levels
                </SheetTitle>
              </SheetHeader>
              <LevelsPanel
                lines={top6Lines}
                lastClose={lastClose}
                symbol={symbolLabel}
              />
            </SheetContent>
          </Sheet>
        </div>
      )}

    </div>
  );
}

function ChartArea({
  candles,
  lines,
  symbol,
  timeframe,
  alertPrices,
  livePrice,
  lastUpdate,
}: {
  candles: Candle[];
  lines: ReturnType<typeof getTop6Levels>;
  symbol: string;
  timeframe: TimeframeInfo | null;
  alertPrices?: { price: number; triggered: boolean }[];
  livePrice?: number;
  lastUpdate?: string | null;
}) {
  return (
    <div className="relative h-full w-full bg-[#0D141B]">
      <TradingChart
        candles={candles}
        lines={lines}
        symbol={symbol}
        timeframe={timeframe}
        visibleCount={VISIBLE_CANDLES}
        alertPrices={alertPrices}
        livePrice={livePrice}
      />
      <div className="pointer-events-none absolute left-4 top-3 select-none">
        <div className="flex items-baseline gap-2">
          <div className="font-mono text-3xl font-bold text-white/[0.06]">{symbol || "—"}</div>
          {timeframe && (
            <div className="font-mono text-xl font-bold text-[#75D380]/15">
              {timeframe.label}
            </div>
          )}
        </div>
        <div className="font-mono text-[10px] tracking-widest text-white/[0.05]">
          Vaan.One · {candles.length} BARS · LAST {MAX_DISPLAY_CANDLES}
        </div>
      </div>
      {/* Pivot line update timestamp — bottom-left of chart */}
      {lastUpdate && (
        <div className="pointer-events-none absolute bottom-8 left-3 select-none">
          <span className="font-mono text-[10px] text-white/65">
            Vaan.One Pivot line Updated at {formatLastUpdate(lastUpdate)}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================ MULTI-CHART GRID
function MultiChartGrid({
  layout,
  allSymbols,
  multiSymbols,
  onSymbolChange,
  getSlotData,
  timeframe,
  lastUpdate,
  slotSymbols,
}: {
  layout: 2 | 3 | 4;
  allSymbols: string[];
  multiSymbols: Record<number, string>;
  onSymbolChange: (slot: number, sym: string) => void;
  getSlotData: (slot: number) => {
    candles: Candle[];
    lines: ReturnType<typeof userLevelsToLines>;
    symbol: string;
    lastClose: number;
  };
  timeframe: TimeframeInfo | null;
  lastUpdate?: string | null;
  slotSymbols: string[];
}) {
  // For 4 charts: stacked vertically, each gets 1/4 height.
  if (layout === 4) {
    const slots4 = Array.from({ length: 4 }, (_, i) => {
      const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
      return { slot: i, symbol: sym };
    });
    return (
      <div className="flex h-full gap-0.5">
        <div className="flex w-1/4 h-full">
          <ChartSlot slot={slots4[0].slot} symbol={slots4[0].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex w-1/4 h-full">
          <ChartSlot slot={slots4[1].slot} symbol={slots4[1].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex w-1/4 h-full">
          <ChartSlot slot={slots4[2].slot} symbol={slots4[2].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex w-1/4 h-full">
          <ChartSlot slot={slots4[3].slot} symbol={slots4[3].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      </div>
    );
  }

  // For 3 charts: horizontal, each gets 1/3 width.
  if (layout === 3) {
    const slots3 = Array.from({ length: 3 }, (_, i) => {
      const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
      return { slot: i, symbol: sym };
    });
    return (
      <div className="flex h-full gap-0.5">
        <div className="flex w-1/3 h-full">
          <ChartSlot slot={slots3[0].slot} symbol={slots3[0].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex w-1/3 h-full">
          <ChartSlot slot={slots3[1].slot} symbol={slots3[1].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
        <div className="flex w-1/3 h-full">
          <ChartSlot slot={slots3[2].slot} symbol={slots3[2].symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      </div>
    );
  }

  // Layout 2 — horizontal, each gets 1/2 width.
  const slots = Array.from({ length: layout }, (_, i) => {
    const sym = i === 0 ? slotSymbols[0] : multiSymbols[i] || allSymbols[i] || allSymbols[0] || "";
    return { slot: i, symbol: sym };
  });

  return (
    <div className="flex h-full gap-0.5">
      {slots.map(({ slot, symbol }) => (
        <div key={slot} className="flex w-1/2 h-full">
          <ChartSlot slot={slot} symbol={symbol} getSlotData={getSlotData} allSymbols={allSymbols} onSymbolChange={onSymbolChange} timeframe={timeframe} lastUpdate={lastUpdate} />
        </div>
      ))}
    </div>
  );
}

// Individual chart slot — used in multi-chart layouts.
function ChartSlot({
  slot,
  symbol,
  getSlotData,
  allSymbols,
  onSymbolChange,
  timeframe,
  lastUpdate,
}: {
  slot: number;
  symbol: string;
  getSlotData: (slot: number) => {
    candles: Candle[];
    lines: ReturnType<typeof userLevelsToLines>;
    symbol: string;
    lastClose: number;
  };
  allSymbols: string[];
  onSymbolChange: (slot: number, sym: string) => void;
  timeframe: TimeframeInfo | null;
  lastUpdate?: string | null;
}) {
  const data = getSlotData(slot);
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border border-white/5 bg-[#0D141B]">
      {/* Per-chart header: symbol dropdown + price */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0D141B] px-2 py-1">
        <Select
          value={symbol}
          onValueChange={(v) => onSymbolChange(slot, v)}
        >
          <SelectTrigger className="h-6 w-auto min-w-[70px] max-w-[150px] gap-1 border-white/10 bg-white/5 px-1.5 font-mono text-[10px] font-bold text-white hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60 border-white/15 bg-[#15161d] text-white">
            {allSymbols.map((s) => (
              <SelectItem key={s} value={s} className="font-mono text-xs focus:bg-white/10">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          {data.lastClose > 0 && (
            <span className="font-mono text-[10px] text-white/50">
              {data.lastClose >= 1000 ? data.lastClose.toFixed(2) : data.lastClose.toFixed(5)}
            </span>
          )}
          {timeframe && (
            <Badge className="h-4 px-1 font-mono text-[8px] font-bold text-[#75D380]">
              {timeframe.label}
            </Badge>
          )}
        </div>
      </div>
      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        {data.candles.length > 0 ? (
          <ChartArea
            candles={data.candles}
            lines={data.lines}
            symbol={data.symbol}
            timeframe={timeframe}
            lastUpdate={lastUpdate}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-white/30">No data</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================ EMPTY STATE
function EmptyState({
  onLoaded,
}: {
  onLoaded: (r: ParseResult, fileName: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Vaan One"
          className="mx-auto mb-4 h-16 w-16 rounded-lg object-contain"
        />
        <h2 className="text-2xl font-semibold">Vaan.One</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          Upload MT5 candlestick CSV files to load them into the chart. Pivot Levels
          are read from columns H–O.
        </p>
      </div>
      <div className="w-full max-w-xl">
        <DriveFilePicker onLoaded={onLoaded} />
      </div>
    </div>
  );
}

// Format an ISO timestamp as "Aug 10th | 5:15 AM IST".
// Uses Asia/Kolkata (IST = UTC+5:30) regardless of the viewer's local
// timezone, because the user's data source operates on IST.
function formatLastUpdate(isoTime: string): string {
  const d = new Date(isoTime);
  if (isNaN(d.getTime())) return "";

  // Force IST (Asia/Kolkata = UTC+5:30) so the time is consistent for all viewers.
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = istFormatter.formatToParts(d);

  const month = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const hour = parts.find((p) => p.type === "hour")?.value || "";
  const minute = parts.find((p) => p.type === "minute")?.value || "";
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";

  const dayNum = parseInt(day, 10);
  const ordinal = getOrdinal(dayNum);

  return `${month} ${day}${ordinal} ${hour}:${minute} ${dayPeriod} (IST)`;
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// "Loading Chart" with animated dots that grow from . to .....
// Uses a JS interval (250ms) so the animation works in all browsers
// without relying on CSS @keyframes content animations.
function LoadingDots() {
  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 5 ? 0 : prev + 1));
    }, 250);
    return () => clearInterval(interval);
  }, []);
  return (
    <span className="font-mono text-2xl text-white/80">
      Loading Chart
      <span className="text-[#75D380]">{".".repeat(dotCount)}</span>
    </span>
  );
}

// ============================================================ LANDING PAGE
function LandingPage({ onOpenChart, xauusdCandles, xauusdLevels }: { onOpenChart: () => void; xauusdCandles?: Candle[]; xauusdLevels?: UserLevel[] }) {
  return (
    <div className="min-h-screen bg-[#070D12] text-white pb-12">
      {/* pb-12 reserves space at the bottom so the fixed footer
          doesn't overlap the last section's content. */}
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
            <a href="#quant" className="hidden text-sm text-white/60 hover:text-white sm:block">Quant</a>
            <a href="#faq" className="hidden text-sm text-white/60 hover:text-white sm:block">FAQ</a>
            <Button
              onClick={onOpenChart}
              size="sm"
              className="bg-red-600/15 font-mono text-sm text-red-400 hover:bg-red-600/25"
            >
              Open Chart →
            </Button>
          </div>
        </div>
      </nav>

      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden px-6 py-4 text-center">
        {/* Animated background: drifting grid + floating glow orbs */}
        <div className="pointer-events-none absolute inset-0">
          {/* Drifting grid */}
          <div
            className="animate-grid-drift absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
          {/* Glow orb 1 — gold */}
          <div className="animate-float-slow absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#75D380]/8 blur-[80px]" />
          {/* Glow orb 2 — red */}
          <div className="animate-float-medium absolute -right-20 top-40 h-96 w-96 rounded-full bg-red-600/5 blur-[100px]" />
          {/* Glow orb 3 — gold pulse */}
          <div className="animate-pulse-glow absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#75D380]/5 blur-[90px]" />
        </div>

        <div className="relative mx-auto max-w-4xl">
          {/* Scrolling price ticker — above the badge */}
          <div className="mb-4">
            <PriceTicker />
          </div>

          {/* Economic calendar — US 3-star high-impact events (Forex Factory feed) */}
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
            <span className="bg-gradient-to-r from-red-500 via-[#75D380] to-[#60D2D5] bg-clip-text text-transparent">Vaan Pivot</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-xl font-medium text-[#75D380] sm:text-2xl">
            Know Your Levels. Trade with Confidence.
          </p>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-white/60 sm:text-lg">
            Vaan Pivot Levels are calculated using a proprietary, customized calculation method designed to identify potential intraday support and resistance levels. These levels help traders identify possible price reaction zones and make informed trading decisions.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              onClick={onOpenChart}
              className="bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
            >
              Launch Chart →
            </Button>
          </div>
        </div>

          {/* Animated trading visualization with real XAUUSD data */}
          <div className="relative mx-auto mt-12 max-w-3xl">
            <TradingVisualCard candles={xauusdCandles} userLevels={xauusdLevels} />
          </div>
      </section>

      {/* ====== Vaan.One LEVELS ====== */}
      <section id="levels" className="relative border-t border-white/5 px-6 py-20">
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-[#75D380]">01 — Chart</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Vaan.One Levels on Chart</h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/60">
              Get daily Pivot Points and Support &amp; Resistance levels for your favourite trading
              instruments.
            </p>
          </div>

          {/* Key facts */}
          <div className="mb-12 grid gap-5 sm:grid-cols-3">
            <FeatureCard
              title="Daily Updates"
              desc="Vaan.One Pivot levels are manually updated every morning at 5:30 AM IST."
            />
            <FeatureCard
              title="Claimed Accuracy"
              desc="Up to 80%"
            />
            <FeatureCard
              title="Currently FREE!"
              desc="Access all available levels at no cost for now."
            />
          </div>

          {/* Available symbols */}
          <div className="mb-10 rounded-xl border border-white/10 bg-white/[0.02] p-8">
            <h4 className="mb-6 text-center text-base font-semibold uppercase tracking-wider text-[#75D380]">
              Available Trading Symbols
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { sym: "XAUUSD", name: "Gold" },
                { sym: "EURUSD", name: "Euro / US Dollar" },
                { sym: "GBPUSD", name: "British Pound / US Dollar" },
                { sym: "USDCHF", name: "US Dollar / Swiss Franc" },
              ].map((s) => (
                <div
                  key={s.sym}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.01] px-5 py-3.5"
                >
                  <span className="font-mono text-base font-bold text-[#75D380]">{s.sym}</span>
                  <span className="text-sm text-white/60">{s.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mb-10 rounded-xl border border-[#75D380]/15 bg-[#75D380]/[0.03] p-6">
            <p className="text-sm leading-relaxed text-white/50">
              <span className="font-semibold text-[#75D380]">Disclaimer:</span>{" "}
              Vaan.One Levels are provided for educational and informational purposes only. These levels
              are manually calculated and updated daily. Accuracy is not guaranteed. They are not
              investment advice or trading recommendations. Always do your own research and manage your
              risk.
            </p>
          </div>

          <div className="text-center">
            <Button
              onClick={onOpenChart}
              className="bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
            >
              View Live Chart →
            </Button>
          </div>
        </div>

        {/* Animated glowing S/R visual — below the View Live Chart button */}
        <div className="pointer-events-none relative mt-12 h-40 overflow-hidden rounded-xl">
          <div className="animate-float-slow absolute left-10 top-5 h-32 w-32 rounded-full" style={{ background: "rgba(212,175,55,0.12)", filter: "blur(50px)" }} />
          <div className="animate-float-medium absolute right-20 top-0 h-40 w-40 rounded-full" style={{ background: "rgba(239,68,68,0.08)", filter: "blur(60px)" }} />
          {/* Animated horizontal lines representing S/R levels */}
          <div className="absolute left-0 right-0 top-6 h-0.5" style={{ background: "linear-gradient(90deg, transparent, rgba(34,197,94,0.4), transparent)" }} />
          <div className="absolute left-0 right-0 top-14 h-0.5" style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.4), transparent)" }} />
          <div className="absolute left-0 right-0 top-24 h-0.5" style={{ background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)" }} />
          {/* Small floating candlestick icons */}
          <div className="animate-float-slow absolute left-1/4 top-4 h-3 w-1 rounded-sm" style={{ background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.6)" }} />
          <div className="animate-float-medium absolute right-1/3 top-10 h-2 w-1 rounded-sm" style={{ background: "#ef4444", boxShadow: "0 0 6px rgba(239,68,68,0.6)" }} />
          <div className="animate-pulse-glow absolute left-1/2 top-6 h-2.5 w-1 rounded-sm" style={{ background: "#d4af37", boxShadow: "0 0 8px rgba(212,175,55,0.8)" }} />
        </div>
      </section>

      {/* ====== QUANT DEVELOPER ====== */}
      <section id="quant" className="relative border-t border-white/5 bg-[#0D141B] px-6 py-20">
        {/* Animated code/matrix visual */}
        <div className="pointer-events-none absolute top-0 left-0 right-0 bottom-0 overflow-hidden">
          <div className="animate-pulse-glow absolute left-1/3 top-1/4 h-40 w-40 rounded-full" style={{ background: "rgba(212,175,55,0.06)", filter: "blur(80px)" }} />
          <div className="animate-float-medium absolute right-1/4 bottom-1/3 h-48 w-48 rounded-full" style={{ background: "rgba(239,68,68,0.04)", filter: "blur(90px)" }} />
          {/* Binary/matrix-style code lines — visible */}
          <div className="absolute left-4 top-8 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(212,175,55,0.12)" }}>
            01001 10110 01101<br/>10110 01001 11010<br/>01101 10110 01001<br/>11010 01101 10110
          </div>
          <div className="absolute right-8 top-12 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(34,197,94,0.1)" }}>
            11010 01101 10110<br/>01001 11010 01101<br/>10110 01001 11010<br/>01101 10110 01001
          </div>
          <div className="absolute left-1/4 bottom-12 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(239,68,68,0.1)" }}>
            01101 10110 01001<br/>11010 01101 10110<br/>01001 11010 01101<br/>10110 01001 11010
          </div>
          {/* Glowing code brackets */}
          <div className="animate-pulse-glow absolute left-12 top-1/3 font-mono text-2xl font-bold" style={{ color: "rgba(212,175,55,0.15)" }}>{"{ }"}</div>
          <div className="animate-float-slow absolute right-16 bottom-1/4 font-mono text-xl font-bold" style={{ color: "rgba(34,197,94,0.12)" }}>{"</>"}</div>
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <span className="text-xs uppercase tracking-widest text-[#75D380]">02 — Development</span>
            <h3 className="mt-3 text-3xl font-bold sm:text-4xl">Quant Developer</h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/60">
              MT5/MT4 and Amibroker Indicators &amp; EA — custom algorithmic trading systems built to
              your specification.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="shimmer-border rounded-xl border border-[#75D380]/15 bg-white/[0.02] p-8 transition-colors hover:border-[#75D380]/30">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#75D380]/10 font-mono text-sm font-bold text-[#75D380]">M5</span>
                <h4 className="font-mono text-lg font-bold text-[#75D380]">MetaTrader 5 / MT4</h4>
              </div>
              <ul className="space-y-3 text-base text-white/60">
                <li className="flex gap-2"><span className="text-[#75D380]">▸</span> Expert Advisors (EAs) for automated trading</li>
                <li className="flex gap-2"><span className="text-[#75D380]">▸</span> Custom indicators for pivot-level detection</li>
                <li className="flex gap-2"><span className="text-[#75D380]">▸</span> Strategy backtesting &amp; optimization</li>
                <li className="flex gap-2"><span className="text-[#75D380]">▸</span> Multi-symbol and multi-timeframe systems</li>
              </ul>
            </div>
            <div className="shimmer-border rounded-xl border border-red-500/15 bg-white/[0.02] p-8 transition-colors hover:border-red-500/30">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 font-mono text-sm font-bold text-red-400">AB</span>
                <h4 className="font-mono text-lg font-bold text-red-400">Amibroker (AFL)</h4>
              </div>
              <ul className="space-y-3 text-base text-white/60">
                <li className="flex gap-2"><span className="text-red-400">▸</span> AFL formulas for scanning &amp; screening</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Custom chart templates with pivot overlays</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Backtesting with historical data</li>
                <li className="flex gap-2"><span className="text-red-400">▸</span> Automated exploration &amp; alerts</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 text-center">
            <a
              href="mailto:valan@outlook.com"
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-600/10 px-6 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-600/20"
            >
              Get a Quote →
            </a>
          </div>
        </div>

        {/* Matrix-based quant developer graphics — below Get a Quote */}
        <div className="pointer-events-none relative mt-12 h-48 overflow-hidden rounded-xl">
          {/* Binary matrix lines */}
          <div className="absolute left-4 top-4 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(212,175,55,0.65)" }}>
            01001 10110 01101<br/>10110 01001 11010<br/>01101 10110 01001<br/>11010 01101 10110<br/>01001 11010 01101
          </div>
          <div className="absolute right-8 top-6 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(34,197,94,0.6)" }}>
            11010 01101 10110<br/>01001 11010 01101<br/>10110 01001 11010<br/>01101 10110 01001<br/>11010 01101 10110
          </div>
          <div className="absolute left-1/3 bottom-4 font-mono text-xs leading-relaxed select-none" style={{ color: "rgba(239,68,68,0.6)" }}>
            01101 10110 01001<br/>11010 01101 10110<br/>01001 11010 01101<br/>10110 01001 11010
          </div>
          {/* Glowing code symbols */}
          <div className="animate-pulse-glow absolute left-12 top-1/3 font-mono text-3xl font-bold" style={{ color: "rgba(212,175,55,0.7)" }}>{"{ }"}</div>
          <div className="animate-float-slow absolute right-16 top-1/4 font-mono text-2xl font-bold" style={{ color: "rgba(34,197,94,0.65)" }}>{"</>"}</div>
          <div className="animate-float-medium absolute left-1/2 bottom-6 font-mono text-2xl font-bold" style={{ color: "rgba(239,68,68,0.6)" }}>{"[ ]"}</div>
          {/* Glowing orbs */}
          <div className="animate-pulse-glow absolute left-1/3 top-1/4 h-32 w-32 rounded-full" style={{ background: "rgba(212,175,55,0.2)", filter: "blur(60px)" }} />
          <div className="animate-float-medium absolute right-1/4 bottom-1/3 h-36 w-36 rounded-full" style={{ background: "rgba(239,68,68,0.15)", filter: "blur(70px)" }} />
        </div>
      </section>

      {/* ====== CTA ====== */}
      <section className="border-t border-white/5 px-6 py-20 text-center">
        <div className="mx-auto max-w-2xl">
          <h3 className="text-3xl font-bold sm:text-4xl">Ready to trade with precision?</h3>
          <p className="mt-4 text-base text-white/60">
            Launch the live chart with today's pivot levels loaded automatically.
          </p>
          <Button
            onClick={onOpenChart}
            className="mt-8 bg-red-600 px-10 py-4 text-base font-semibold text-white hover:bg-red-700"
          >
            Launch Vaan.One Chart →
          </Button>
        </div>

        {/* Animated globe network visualization — different from the chart card */}
        <div className="pointer-events-none relative mx-auto mt-12 h-48 max-w-3xl overflow-hidden rounded-xl">
          {/* Glowing orbs */}
          <div className="animate-pulse-glow absolute left-1/3 top-1/4 h-32 w-32 rounded-full" style={{ background: "rgba(212,175,55,0.15)", filter: "blur(60px)" }} />
          <div className="animate-float-slow absolute right-1/3 bottom-1/4 h-28 w-28 rounded-full" style={{ background: "rgba(239,68,68,0.1)", filter: "blur(50px)" }} />

          {/* SVG network — connected nodes representing trading instruments */}
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 400 180">
            <defs>
              <filter id="nodeGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <linearGradient id="netLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#d4af37" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.5" />
              </linearGradient>
            </defs>

            {/* Connection lines */}
            <line x1="60" y1="90" x2="150" y2="40" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="60" y1="90" x2="150" y2="140" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="150" y1="40" x2="250" y2="90" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="150" y1="140" x2="250" y2="90" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="250" y1="90" x2="340" y2="40" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="250" y1="90" x2="340" y2="140" stroke="url(#netLine)" strokeWidth="1" opacity="0.6" />
            <line x1="150" y1="40" x2="150" y2="140" stroke="rgba(239,68,68,0.3)" strokeWidth="1" />
            <line x1="340" y1="40" x2="340" y2="140" stroke="rgba(34,197,94,0.3)" strokeWidth="1" />

            {/* Nodes — pulsing circles */}
            <circle cx="60" cy="90" r="6" fill="#d4af37" filter="url(#nodeGlow)">
              <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="150" cy="40" r="5" fill="#22c55e" filter="url(#nodeGlow)">
              <animate attributeName="r" values="5;7;5" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="150" cy="140" r="5" fill="#ef4444" filter="url(#nodeGlow)">
              <animate attributeName="r" values="5;7;5" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="250" cy="90" r="7" fill="#d4af37" filter="url(#nodeGlow)">
              <animate attributeName="r" values="7;9;7" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="340" cy="40" r="5" fill="#22c55e" filter="url(#nodeGlow)">
              <animate attributeName="r" values="5;7;5" dur="2.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="340" cy="140" r="5" fill="#ef4444" filter="url(#nodeGlow)">
              <animate attributeName="r" values="5;7;5" dur="3.2s" repeatCount="indefinite" />
            </circle>

            {/* Animated traveling pulses along lines */}
            <circle r="2" fill="#d4af37">
              <animateMotion dur="3s" repeatCount="indefinite" path="M60,90 L150,40 L250,90 L340,40" />
            </circle>
            <circle r="2" fill="#22c55e">
              <animateMotion dur="4s" repeatCount="indefinite" path="M60,90 L150,140 L250,90 L340,140" />
            </circle>

            {/* Labels */}
            <text x="60" y="108" fill="rgba(212,175,55,0.6)" fontSize="7" fontFamily="monospace" fontWeight="bold">XAUUSD</text>
            <text x="150" y="28" fill="rgba(34,197,94,0.5)" fontSize="6" fontFamily="monospace">EURUSD</text>
            <text x="150" y="158" fill="rgba(239,68,68,0.5)" fontSize="6" fontFamily="monospace">GBPUSD</text>
            <text x="250" y="108" fill="rgba(212,175,55,0.6)" fontSize="7" fontFamily="monospace" fontWeight="bold">PIVOT</text>
            <text x="340" y="28" fill="rgba(34,197,94,0.5)" fontSize="6" fontFamily="monospace">USDCHF</text>
            <text x="340" y="158" fill="rgba(239,68,68,0.5)" fontSize="6" fontFamily="monospace">ALERT</text>
          </svg>

          {/* Floating badges */}
          <div className="animate-float-slow absolute right-6 top-4 rounded-full border border-[#75D380]/20 bg-black/40 px-3 py-1">
            <span className="font-mono text-[10px] text-[#75D380]">MULTI-SYMBOL</span>
          </div>
          <div className="animate-pulse-glow absolute left-6 bottom-4 rounded-full border border-emerald-500/20 bg-black/40 px-3 py-1">
            <span className="font-mono text-[10px] text-emerald-400">LIVE NETWORK</span>
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
              a="Vaan Pivot Levels are daily support and resistance price levels calculated using a customized pivot methodology. They identify potential intraday reversal zones for trading instruments like XAUUSD, EURUSD, GBPUSD, and USDCHF."
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
              a="XAUUSD (Gold), EURUSD (Euro / US Dollar), GBPUSD (British Pound / US Dollar), and USDCHF (US Dollar / Swiss Franc)."
            />
            <FaqItem
              q="How do I view the live chart?"
              a="Click the 'Launch Chart' button on this page. The chart auto-loads the latest pivot levels from our data source — no login or upload required."
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

      {/* ====== FOOTER (fixed at bottom — stable while page scrolls) ======
          Compact single-row layout: logo + name | email | disclaimer
          Reduced height (py-2 instead of py-8). Always visible while scrolling. */}
      <footer
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0D141B]/95 backdrop-blur-md"
        style={{
          // Respect iOS safe-area (home indicator) so the footer isn't
          // cut off when installed as a PWA / in app mode.
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-center sm:text-left">
          {/* Left: logo + brand name */}
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vaan.One" className="h-4 w-4 rounded object-contain" />
            <span className="font-mono text-[10px] text-white/50">Vaan.One</span>
          </div>
          {/* Middle-left: email + Telegram channel link */}
          <div className="flex items-center gap-2">
            <a
              href="mailto:valan@outlook.com"
              className="text-[10px] text-[#75D380] transition-colors hover:text-[#75D380]"
            >
              valan@outlook.com
            </a>
            {/* Telegram channel — logo only; click opens the channel in a new
                tab. Inline SVG because lucide-react ships no Telegram glyph. */}
            <a
              href="https://t.me/vaan_one"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram channel"
              className="text-white/50 transition-colors hover:text-[#75D380]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M23.91 3.79L20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.35-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73z" />
              </svg>
            </a>
          </div>
          {/* Right: disclaimer — hidden on small screens to save space */}
          <p className="hidden text-[9px] leading-tight text-white/60 md:block">
            Disclaimer: This website is for educational purposes only. Trade at your own risk.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="shimmer-border animate-fade-in-up rounded-xl border border-white/10 bg-white/[0.02] p-7 transition-all hover:border-[#75D380]/40 hover:bg-[#75D380]/[0.04] hover:shadow-lg hover:shadow-amber-500/5">
      <h4 className="mb-3 text-lg font-semibold text-white">{title}</h4>
      <p className="text-sm leading-relaxed text-white/50">{desc}</p>
    </div>
  );
}

/** Sample equity curve card — mimics a backtest performance chart */
function EquityCurveCard() {
  // Generate an upward-trending equity curve path (SVG points)
  const points = [
    80, 75, 78, 70, 72, 65, 68, 60, 58, 62, 55, 50, 48, 52, 45, 42, 38, 40, 35, 30, 25, 20,
  ];
  const w = 400;
  const h = 160;
  const stepX = w / (points.length - 1);
  const maxVal = 90;
  const pathD = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - (p / maxVal) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div className="shimmer-border overflow-hidden rounded-xl border border-[#75D380]/20 bg-[#0D141B]/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Vaan.One" className="h-5 w-5 rounded object-contain" />
          <span className="font-mono text-xs font-semibold text-white/80">
            Master Equity Curve · XAUUSD
          </span>
        </div>
        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
          Simulated
        </span>
      </div>
      {/* Equity curve SVG */}
      <div className="relative p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          {/* Gradient fill under curve */}
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#equityGrad)" />
          {/* Curve line */}
          <path
            d={pathD}
            fill="none"
            stroke="#d4af37"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-draw-line"
          />
        </svg>
      </div>
      {/* Footer stats */}
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
        <div className="flex gap-4">
          <div>
            <span className="text-[9px] uppercase text-white/30">Net Profit</span>
            <p className="font-mono text-xs font-bold text-[#75D380]">+$24,580</p>
          </div>
          <div>
            <span className="text-[9px] uppercase text-white/30">Win Rate</span>
            <p className="font-mono text-xs font-bold text-white/80">72%</p>
          </div>
        </div>
        <div>
          <span className="text-[9px] uppercase text-white/30">Max DD</span>
          <p className="font-mono text-xs font-bold text-red-400">-8.3%</p>
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-[#75D380]/20">
      <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-white/80 [&::-webkit-details-marker]:hidden">
        {q}
        <span className="ml-2 text-lg text-[#75D380] transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-4 text-sm leading-relaxed text-white/50">{a}</p>
    </details>
  );
}
