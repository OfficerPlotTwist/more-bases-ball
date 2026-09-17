# Cache scope by season — report

**Branch:** `main` · **Suite:** 19/19 green before and after.

## The gap

`getText` keyed its freshness check on `fs.existsSync(cachePath(url))` alone. That is
correct for 149 of 150 seasons and is what makes a warm rebuild ~30s across ~6000
requests. It is wrong for a season still being played: a March build caches a
half-season, a September rebuild hits that cache, the parquet holds March's numbers,
`_build.json` still says `complete: true`, and `coverage.json` reports the year as
whole. All three gates pass because each asks only "did this build lose anything it
fetched?" — and it didn't. It faithfully recorded stale data.

## The fix

Scope the cache by season, not by time. No TTL was added. `getText(url, validate,
opts)` gains an explicit `opts.fresh`, which refetches and **overwrites** the entry
(so an offline rebuild still has a fallback) and counts as a **miss**.
`isVolatileSeason(year, now)` puts the definition of "still changing" in one place,
and every per-year call site in both builders passes
`{ fresh: isVolatileSeason(year) }`. The `league/${id}` lookup in
`build-seasons.mjs` is not per-year and was left cached.

Call sites converted (all per-year fetches in the two builders; grep for `getJson(`/
`getText(` confirms none were missed):

- `tools/build-seasons.mjs` — teams list, both roster-hydrate calls, both
  `teams/stats` calls.
- `tools/build-statcast.mjs` — the per-year board fetch, keeping `csvBody`.

## Diff

```diff
diff --git a/AGENTS.md b/AGENTS.md
index 62b8416..f4474b8 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -124,6 +124,19 @@ generated and gitignored.
   the team list while player-level data stays thin) plus the 1914-15
   Federal League. Surface that on a results page touching those years; it is
   provenance, not an apology.
+- **The HTTP cache has no TTL, and must not get one** — baseball history is
+  immutable, and existence-keyed caching is what makes a warm rebuild ~30s
+  across ~6000 requests. The one exception is a season that is not over yet:
+  every per-year fetch passes `{ fresh: isVolatileSeason(year) }` (the current
+  year and the one before it, which still takes late corrections) so it
+  refetches and overwrites its cache entry. Add a per-year fetch without it and
+  a September rebuild serves March: that year lands in parquet as a
+  half-season, `_build.json` still says `complete: true`, and `coverage.json`
+  reports it as whole — all three gates pass, because each only asks whether
+  the build lost anything it fetched, never whether what it fetched was
+  current. A forced refetch counts as a cache MISS and both builders name the
+  refetched seasons in their cache line, so `cache N hits 0 fetched` can never
+  describe a run that went to the network.
 - Spine tests skip cleanly when `data/` is absent, so a fresh clone with no
   network still shows the original twelve green.
 - **`data.js` is unchanged and stays that way.** It is the committed slice
diff --git a/tests/fetchlib.test.js b/tests/fetchlib.test.js
index aecddba..f70257d 100644
--- a/tests/fetchlib.test.js
+++ b/tests/fetchlib.test.js
@@ -72,6 +72,49 @@ function check(label, ok, detail) {
   const afterHit = lib.cacheStats();
   check('cacheStats records a hit', afterHit.hits === 1 && afterHit.misses === 1, JSON.stringify(afterHit));
 
+  // isVolatileSeason: the current and prior seasons are still moving; anything
+  // older is immutable. An explicit `now` keeps this from rotting each January.
+  const now = new Date('2026-06-15T00:00:00Z');
+  check('volatile: current season', lib.isVolatileSeason(2026, now) === true);
+  check('volatile: prior season', lib.isVolatileSeason(2025, now) === true);
+  check('volatile: two seasons ago is immutable', lib.isVolatileSeason(2024, now) === false);
+  check('volatile: 1927 is immutable', lib.isVolatileSeason(1927, now) === false);
+
+  // The falsifiable pair. (a) { fresh: true } over an EXISTING cache entry must
+  // go to the network again and overwrite the file on disk; (b) the same URL
+  // without `fresh` must still be served from that cache. (b) is what proves the
+  // fix is scoped to in-progress seasons rather than having disabled caching.
+  const freshUrl = 'https://example.test/season.csv';
+  let freshCalls = 0;
+  lib.setFetch(async () => { freshCalls++; return { ok: true, text: async () => 'march-half-season' }; });
+  const seeded = await lib.getText(freshUrl);
+  check('fresh: cache entry exists first', seeded === 'march-half-season' && fs.existsSync(lib.cachePath(freshUrl)), seeded);
+  const onDiskBefore = fs.readFileSync(lib.cachePath(freshUrl), 'utf8');
+
+  lib.setFetch(async () => { freshCalls++; return { ok: true, text: async () => 'september-full-season' }; });
+  const refetched = await lib.getText(freshUrl, null, { fresh: true });
+  const onDiskAfter = fs.readFileSync(lib.cachePath(freshUrl), 'utf8');
+  check('(a) fresh refetches over an existing entry', freshCalls === 2, `freshCalls=${freshCalls}`);
+  check('(a) fresh returns the new body', refetched === 'september-full-season', refetched);
+  check('(a) fresh overwrites the cached file',
+    onDiskBefore === 'march-half-season' && onDiskAfter === 'september-full-season',
+    `${onDiskBefore} -> ${onDiskAfter}`);
+
+  const without = await lib.getText(freshUrl);
+  check('(b) without fresh the cache still serves', freshCalls === 2, `freshCalls=${freshCalls}`);
+  check('(b) without fresh returns the cached body', without === 'september-full-season', without);
+
+  // A forced refetch is a MISS, not a hit — 'N hits 0 fetched' must never
+  // describe a run that went to the network.
+  const forcedUrl = 'https://example.test/forced.csv';
+  lib.setFetch(async () => ({ ok: true, text: async () => 'forced-body' }));
+  await lib.getText(forcedUrl);
+  lib.resetCacheStats();
+  await lib.getText(forcedUrl, null, { fresh: true });
+  const forcedStats = lib.cacheStats();
+  check('cacheStats counts a forced refetch as a miss',
+    forcedStats.misses === 1 && forcedStats.hits === 0, JSON.stringify(forcedStats));
+
   fs.rmSync(dir, { recursive: true, force: true });
   process.exit(failures ? 1 : 0);
 })();
diff --git a/tools/build-seasons.mjs b/tools/build-seasons.mjs
index 9793fe0..f4a113d 100644
--- a/tools/build-seasons.mjs
+++ b/tools/build-seasons.mjs
@@ -20,7 +20,7 @@
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { getJson, pool, cacheStats } from './lib/fetch.mjs';
+import { getJson, pool, cacheStats, isVolatileSeason } from './lib/fetch.mjs';
 import { openDb, sqlPath } from './lib/duck.mjs';
 
 const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
@@ -141,7 +141,7 @@ let manifestComplete = false;
 
 try {
 for (let year = FIRST; year <= LAST; year++) {
-  const list = await getJson(`${API}/teams?sportId=1&season=${year}`);
+  const list = await getJson(`${API}/teams?sportId=1&season=${year}`, { fresh: isVolatileSeason(year) });
   const clubs = (list.teams || []).filter((t) => t.sport && t.sport.id === 1);
   if (!clubs.length) continue;
 
@@ -165,7 +165,10 @@ for (let year = FIRST; year <= LAST; year++) {
     let hj;
     let pj;
     try {
-      [hj, pj] = await Promise.all([getJson(hitUrl), getJson(pitUrl)]);
+      [hj, pj] = await Promise.all([
+        getJson(hitUrl, { fresh: isVolatileSeason(year) }),
+        getJson(pitUrl, { fresh: isVolatileSeason(year) }),
+      ]);
     } catch (e) {
       const reason = (e && e.message) || String(e);
       failures.push({ year, club: club.abbreviation, error: reason });
@@ -249,8 +252,8 @@ for (let year = FIRST; year <= LAST; year++) {
   let pitJ;
   try {
     [hitJ, pitJ] = await Promise.all([
-      getJson(`${API}/teams/stats?stats=season&group=hitting&season=${year}&sportId=1`),
-      getJson(`${API}/teams/stats?stats=season&group=pitching&season=${year}&sportId=1`),
+      getJson(`${API}/teams/stats?stats=season&group=hitting&season=${year}&sportId=1`, { fresh: isVolatileSeason(year) }),
+      getJson(`${API}/teams/stats?stats=season&group=pitching&season=${year}&sportId=1`, { fresh: isVolatileSeason(year) }),
     ]);
   } catch (e) {
     const reason = (e && e.message) || String(e);
@@ -301,7 +304,15 @@ finishedLoop = true;
 fs.rmSync(TMP, { recursive: true, force: true });
 
 const cs = cacheStats();
-console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
+/* Name the seasons that bypassed the cache, so a human reading the log can
+ * see that an in-progress year was actually refetched and not quietly served
+ * from a months-old entry. */
+const refetched = [];
+for (let y = FIRST; y <= LAST; y++) if (isVolatileSeason(y)) refetched.push(y);
+console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`
+  + (refetched.length
+    ? `  (${refetched.join(', ')} refetched: in-progress seasons are never served from cache)`
+    : ''));
 console.log(`league  ${leagueYears.length} seasons of team totals`);
 console.log(`seasons ${seasonYears[0]}–${seasonYears[seasonYears.length - 1]}  files ${seasonYears.length}`);
 console.log(`  bat  ${totalBat} player-seasons`);
diff --git a/tools/build-statcast.mjs b/tools/build-statcast.mjs
index a6e83bf..21c7d63 100644
--- a/tools/build-statcast.mjs
+++ b/tools/build-statcast.mjs
@@ -21,7 +21,7 @@
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { getText, parseCsv, cacheStats, csvBody } from './lib/fetch.mjs';
+import { getText, parseCsv, cacheStats, csvBody, isVolatileSeason } from './lib/fetch.mjs';
 import { openDb, sqlPath } from './lib/duck.mjs';
 
 const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
@@ -96,7 +96,7 @@ for (let year = FIRST; year <= LAST; year++) {
 
   for (const b of BOARDS) {
     if (year < b.from) continue;
-    const rows = parseCsv(await getText(b.url(year), csvBody));
+    const rows = parseCsv(await getText(b.url(year), csvBody, { fresh: isVolatileSeason(year) }));
     if (!rows.length) { console.log(`  ${year} ${b.key}: EMPTY`); continue; }
     const missing = b.needs.filter((c) => !(c in rows[0]));
     if (missing.length) {
@@ -135,7 +135,15 @@ for (let year = FIRST; year <= LAST; year++) {
 }
 
 const cs = cacheStats();
-console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
+/* Name the seasons that bypassed the cache, so a human reading the log can
+ * see that an in-progress year was actually refetched and not quietly served
+ * from a months-old entry. */
+const refetched = [];
+for (let y = FIRST; y <= LAST; y++) if (isVolatileSeason(y)) refetched.push(y);
+console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`
+  + (refetched.length
+    ? `  (${refetched.join(', ')} refetched: in-progress seasons are never served from cache)`
+    : ''));
 await db.close();
 }
 
diff --git a/tools/lib/fetch.mjs b/tools/lib/fetch.mjs
index 4510bd0..70508af 100644
--- a/tools/lib/fetch.mjs
+++ b/tools/lib/fetch.mjs
@@ -33,9 +33,25 @@ let misses = 0;
 export const cacheStats = () => ({ hits, misses });
 export const resetCacheStats = () => { hits = 0; misses = 0; };
 
-export const getText = async (url, validate) => {
+/* A season is volatile until it is fully in the past. The current year is
+ * obviously still moving; the prior year still receives late statistical
+ * corrections. Everything older is immutable and cached forever — that is
+ * what keeps a warm rebuild fast. */
+export const isVolatileSeason = (year, now = new Date()) =>
+  year >= now.getFullYear() - 1;
+
+/* The disk cache has no age component ON PURPOSE: baseball history is
+ * immutable, so a TTL would only throw away facts that can never change.
+ * The one thing that is not immutable is a season still being played, and
+ * that is what `opts.fresh` is for — the caller, which knows the year,
+ * asks for a refetch and the fresh body OVERWRITES the stale entry (rather
+ * than skipping the cache) so a later offline rebuild still has something
+ * to fall back on. A forced refetch counts as a miss: a "cache N hits 0
+ * fetched" line must never describe a run that went to the network. */
+export const getText = async (url, validate, opts = {}) => {
   const p = cachePath(url);
-  if (process.env.MBB_CACHE_REFRESH !== '1' && fs.existsSync(p)) {
+  const fresh = opts.fresh === true || process.env.MBB_CACHE_REFRESH === '1';
+  if (!fresh && fs.existsSync(p)) {
     hits++;
     return fs.readFileSync(p, 'utf8');
   }
@@ -47,7 +63,7 @@ export const getText = async (url, validate) => {
   return body;
 };
 
-export const getJson = async (url) => JSON.parse(await getText(url, JSON.parse));
+export const getJson = async (url, opts = {}) => JSON.parse(await getText(url, JSON.parse, opts));
 
 /* The CSV counterpart to getJson's JSON.parse validator. retry() only checks
  * r.ok, so a 200 carrying a rate-limit/error page, or a truncated body, would
```

## Test output — `node tests/fetchlib.test.js`

```
ok    cache returns the same body — "a,b\n1,2\n"
ok    cache avoids a second network call — calls=1
ok    csv parses one row — rows=1
ok    csv respects quoted commas — two, comma
ok    pool visits every item — 1,2,3,4
ok    malformed json throws
ok    malformed body is not cached
ok    a later valid response recovers — {"ok":true}
ok    refresh: initial fetch populates cache — first
ok    MBB_CACHE_REFRESH forces a second network call — refreshCalls=2
ok    MBB_CACHE_REFRESH returns the new body — second
ok    cacheStats records a miss — {"hits":0,"misses":1}
ok    cacheStats records a hit — {"hits":1,"misses":1}
ok    volatile: current season
ok    volatile: prior season
ok    volatile: two seasons ago is immutable
ok    volatile: 1927 is immutable
ok    fresh: cache entry exists first — march-half-season
ok    (a) fresh refetches over an existing entry — freshCalls=2
ok    (a) fresh returns the new body — september-full-season
ok    (a) fresh overwrites the cached file — march-half-season -> september-full-season
ok    (b) without fresh the cache still serves — freshCalls=2
ok    (b) without fresh returns the cached body — september-full-season
ok    cacheStats counts a forced refetch as a miss — {"hits":0,"misses":1}
```

`node tools/run-tests.mjs`:

```
All checks passed.

19/19 test files passed
```

## Demonstrated failure and restore

The two halves of the pair fail under two different mutations, which is the point:
(a) catches "fresh does nothing", (b) catches "caching was quietly disabled". One
mutation alone cannot prove both.

### Mutation 1 — invert the `fresh` guard in `getText`

```js
- if (!fresh && fs.existsSync(p)) {
+ if (fresh && fs.existsSync(p)) {   // DELIBERATELY INVERTED
```

```
FAIL  cache avoids a second network call — calls=2
FAIL  MBB_CACHE_REFRESH forces a second network call — refreshCalls=1
FAIL  MBB_CACHE_REFRESH returns the new body — first
FAIL  cacheStats records a hit — {"hits":0,"misses":2}
FAIL  (a) fresh refetches over an existing entry — freshCalls=1
FAIL  (a) fresh returns the new body — march-half-season
FAIL  (a) fresh overwrites the cached file — march-half-season -> march-half-season
FAIL  cacheStats counts a forced refetch as a miss — {"hits":1,"misses":0}
exit=1
```

Part (a) goes red on all three of its assertions — the refetch, the returned body, and
the bytes on disk.

### Mutation 2 — unscope `fresh` (caching disabled everywhere)

```js
- const fresh = opts.fresh === true || process.env.MBB_CACHE_REFRESH === '1';
+ const fresh = true;   // DELIBERATELY UNSCOPED: caching disabled everywhere
```

```
FAIL  cache avoids a second network call — calls=2
FAIL  cacheStats records a hit — {"hits":0,"misses":2}
FAIL  (b) without fresh the cache still serves — freshCalls=3
exit=1
```

Part (b) goes red. Note (a) still passes here — exactly why (b) is required: without
it, "disable the cache entirely" would look like a valid fix.

### Restore

`tools/lib/fetch.mjs` restored from the pre-mutation copy both times.

```
--- restored run ---
... (all 24 ok)
exit=0

restored exit=0
```

`git diff --stat tools/lib/fetch.mjs` after restore: `19 insertions(+), 3 deletions(-)`
— i.e. only the intended change remains; neither mutation survived.

## Warm 2023–2024 build

```
$ node tools/build-seasons.mjs 2023 2024
cache  156 hits  0 fetched
league  2 seasons of team totals
seasons 2023–2024  files 2
  bat  1645 player-seasons
  pit  1935 player-seasons
manifest ...\data\_build.json  complete=true
```

All hits, zero fetched, and no refetch note — correct: today is 2026-09-16, so
`isVolatileSeason` covers 2026 and 2025, and neither is in range. Nothing went to the
network. A full rebuild was deliberately NOT run; it would refetch the in-progress
season over the network and rewrite `data/`.

## Manifest and coverage untouched

`build-seasons.mjs` rewrites `data/_build.json` unconditionally with the run's own
year range, so the scoped 2023–2024 run necessarily replaced the 150-year manifest
with a 2-year one. Both files were sha1'd and copied to the scratchpad before the
run, and `_build.json` was restored from that copy afterwards.

```
before:
13e87c69c611117120995c2ae9d605882a06bd60 *data/_build.json
266b82551e47bd0784b83d1f339a1629adb5efb9 *data/coverage.json

after restore:
data/_build.json: OK
data/coverage.json: OK
complete true years 150 first 1876 last 2025
```

`coverage.json` was never written by this run and hashes identically. `data/` is
gitignored and nothing under it is staged; `git status --porcelain` shows only the
five intended source files plus the untracked `onlyprompts.json`, which was left
alone.

## Files changed

- `tools/lib/fetch.mjs` — `isVolatileSeason`, `opts.fresh` on `getText`, pass-through on `getJson`, forced refetch counts as a miss.
- `tools/build-seasons.mjs` — `{ fresh: isVolatileSeason(year) }` at all five per-year call sites; cache line names refetched seasons.
- `tools/build-statcast.mjs` — same at the per-year board fetch; same cache line.
- `tests/fetchlib.test.js` — `isVolatileSeason` cases, the falsifiable pair, forced-refetch-is-a-miss.
- `AGENTS.md` — new "Data spine" bullet stating the no-TTL rule and the consequence.

## Concerns

- The refetch note is derived from the builder's `FIRST`/`LAST` range rather than from
  what `getText` actually bypassed, so it names the seasons that *were scoped* for
  refetch. That matches what a reader needs and keeps `fetch.mjs` free of per-URL
  bookkeeping, but it is a statement about intent, not an independent observation. The
  miss count next to it is the independent observation.
- `isVolatileSeason` uses calendar year, not season state. A build run in, say,
  February 2027 will still refetch 2026 and 2025 — harmless (a handful of URLs), and
  strictly safer than the alternative.
- Anyone adding a new per-year fetch must remember the `fresh` flag. That is now the
  `AGENTS.md` bullet's job; there is no mechanical enforcement.

———
Generated by claude-opus-5 · task completed
