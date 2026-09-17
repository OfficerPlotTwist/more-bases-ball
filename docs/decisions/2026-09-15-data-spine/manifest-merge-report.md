# _build.json merge fix — report

## Diff
```diff
diff --git a/AGENTS.md b/AGENTS.md
index f4474b8..ab0c523 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -111,6 +111,20 @@ generated and gitignored.
     failure mode this project has, worse than refusing to answer at all.
   - `openSpine()` refuses for the same reason, with `{ allowIncomplete:
     true }` as a debugging-only escape.
+- **`_build.json` is MERGED, never replaced.** A scoped run
+  (`node tools/build-seasons.mjs 2023 2024`) rewrote the whole manifest from
+  its own argv, so a 150-year manifest became a 2-year one while all 150
+  parquet files sat untouched beside it — and it still said `complete: true`,
+  truthfully, for the two years it now described. All three gates passed on a
+  manifest accounting for none of the other 148 years, and `leagueOnlySeasons`
+  (derived from it) would have collapsed from 111 club-years to whatever those
+  two held, stripping a 1924 results page of its Negro Leagues provenance.
+  `mergeManifest(existing, run)` is pure and exported for exactly this reason:
+  the bug lived behind a multi-minute network build and could not be tested
+  until it came out. `tests/manifest-merge.test.js` asserts the year count.
+  `writeManifest()` then checks the merged claim against disk and demotes any
+  year whose parquet has gone — an inherited entry is only worth what the
+  files back.
 - `spine.mjs` validates every query parameter and throws rather than
   interpolating it raw: `year` must be an integer, `team` must match
   `/^[A-Z]{2,4}(-[A-Z])?$/`, `role` must be `bat` or `pit`. These parameters
diff --git a/tools/build-seasons.mjs b/tools/build-seasons.mjs
index f4a113d..3687a85 100644
--- a/tools/build-seasons.mjs
+++ b/tools/build-seasons.mjs
@@ -75,6 +75,53 @@ async function leagueAbbr(id, name) {
   return abbr;
 }
 
+/* `clubsFetched` says the two roster requests resolved for every expected
+ * club — that is what an integrity flag can actually gate on. `clubsWithRows`
+ * is recorded per year (see below) but is a COVERAGE fact, not a build
+ * failure: some historical clubs (Negro Leagues in 1924, Federal League in
+ * 1914, expansion franchises not yet formed in 1996) are legitimately in
+ * the schedule with zero player-level rows at the source. Folding that into
+ * completeness makes `complete` unsatisfiable against real baseball history. */
+const yearIsClean = (y) => y.clubsFetched === y.clubsExpected;
+
+/* MERGE, never replace. `node tools/build-seasons.mjs 2023 2024` used to
+ * overwrite a 150-year manifest with a 2-year one while all 150 parquet files
+ * sat untouched in data/seasons — and the downgraded manifest still said
+ * complete:true (truthfully, for the two years it now described), so both
+ * gates that read it passed while it accounted for none of the other 148
+ * years. coverage.json's leagueOnlySeasons is derived FROM this file, so a
+ * 1924 results page would have silently lost its Negro Leagues provenance.
+ *
+ * Pure on purpose: no fs, no network, no globals, so tests/manifest-merge.test.js
+ * can exercise it without a multi-minute build. */
+export function mergeManifest(existing, run) {
+  const inRange = (y) => y >= run.firstYear && y <= run.lastYear;
+  const prevYears = (existing && Array.isArray(existing.years) ? existing.years : [])
+    .filter((y) => !inRange(y.year));
+  const years = [...prevYears, ...run.years].sort((a, b) => a.year - b.year);
+
+  const prevFailures = (existing && Array.isArray(existing.failures) ? existing.failures : [])
+    .filter((f) => !inRange(f.year));
+  const failures = [...prevFailures, ...run.failures];
+
+  /* A prior run's failure in a year this run did NOT touch correctly holds
+   * `complete` false until that year is rebuilt. That is the intent. */
+  const complete = run.finishedLoop && failures.length === 0 && years.every(yearIsClean);
+
+  return {
+    tool: run.tool,
+    startedAt: run.startedAt,
+    finishedAt: run.finishedAt,
+    complete,
+    firstYear: years.length ? years[0].year : run.firstYear,
+    lastYear: years.length ? years[years.length - 1].year : run.lastYear,
+    /* What this invocation covered, as against what the manifest describes. */
+    lastRun: { firstYear: run.firstYear, lastYear: run.lastYear, finishedAt: run.finishedAt },
+    years,
+    failures,
+  };
+}
+
 const COLUMNS = `
     CAST(year AS INTEGER) AS year, CAST(mlbam AS INTEGER) AS mlbam,
     CAST(bbref AS VARCHAR) AS bbref, CAST(name AS VARCHAR) AS name,
@@ -107,27 +154,45 @@ const years = [];
 const startedAt = new Date().toISOString();
 let finishedLoop = false;
 
-/* `clubsFetched` says the two roster requests resolved for every expected
- * club — that is what an integrity flag can actually gate on. `clubsWithRows`
- * is recorded per year (see below) but is a COVERAGE fact, not a build
- * failure: some historical clubs (Negro Leagues in 1924, Federal League in
- * 1914, expansion franchises not yet formed in 1996) are legitimately in
- * the schedule with zero player-level rows at the source. Folding that into
- * completeness makes `complete` unsatisfiable against real baseball history. */
-const yearIsClean = (y) => y.clubsFetched === y.clubsExpected;
+/* The prior manifest, read before anything is written, so a scoped run
+ * merges into it instead of replacing it. Unreadable or corrupt is treated
+ * as absent — a first build. */
+let existingManifest = null;
+try {
+  existingManifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
+} catch { existingManifest = null; }
 
 const writeManifest = () => {
-  const complete = finishedLoop && failures.length === 0 && years.every(yearIsClean);
-  const body = `${JSON.stringify({
+  const merged = mergeManifest(existingManifest, {
     tool: 'build-seasons.mjs',
     startedAt,
     finishedAt: new Date().toISOString(),
-    complete,
     firstYear: FIRST,
     lastYear: LAST,
     years,
     failures,
-  }, null, 2)}\n`;
+    finishedLoop,
+  });
+
+  /* A merged manifest can inherit a year whose parquet has since been
+   * deleted. The claim is only worth what the disk backs: verify, and
+   * demote any year the files no longer support. */
+  const missing = merged.years.filter(
+    (y) => !fs.existsSync(path.join(OUT, `${y.year}.parquet`)));
+  if (missing.length) {
+    const gone = new Set(missing.map((y) => y.year));
+    merged.years = merged.years.filter((y) => !gone.has(y.year));
+    for (const y of missing) {
+      merged.failures.push({ year: y.year, club: null, error: 'parquet missing at manifest write' });
+    }
+    merged.complete = finishedLoop && merged.failures.length === 0
+      && merged.years.every(yearIsClean);
+    console.log(`WARN manifest: no parquet on disk for ${[...gone].join(', ')}`
+      + ' — dropped from the manifest');
+  }
+
+  const complete = merged.complete;
+  const body = `${JSON.stringify(merged, null, 2)}\n`;
   /* Write-then-rename: a kill mid-write must never leave corrupt JSON in
    * the one artifact downstream tasks gate on. rename is atomic on NTFS
    * and POSIX alike. */
```

## New test: tests/manifest-merge.test.js — full output (green)
```
ok    importing build-seasons.mjs exports mergeManifest without building
ok    scoped 2023-2024 run keeps all 150 years — years=150
ok    firstYear stays 1876 — firstYear=1876
ok    lastYear stays 2025 — lastYear=2025
ok    complete stays true — complete=true
ok    years are sorted ascending
ok    2023 carries the run entry, not the existing one — seasonRows=999999
ok    2024 carries the run entry, not the existing one — seasonRows=999999
ok    1924 keeps its existing entry untouched — seasonRows=1924
ok    1924 keeps its 8 clubsEmpty entries — BLB,CAG,DTS,HBG,KCM,MRS,SLS,WSP
ok    total clubsEmpty across the merged manifest is preserved
ok    lastRun reports the invocation range 2023-2024 — 2023-2024
ok    lastRun.finishedAt matches the run
ok    existing=null yields exactly the run years — years=2
ok    existing=null yields the run range — 1876-1877
ok    existing=null with a clean finished loop is complete
ok    a prior failure in an untouched year survives the merge — [{"year":1901,"club":"BOS","error":"HTTP 503"}]
ok    an inherited failure keeps complete false
ok    a failure inside the rebuilt range is cleared by the rerun — []
ok    finishedLoop:false yields complete:false even with clean years — complete=false years=150
ok    an inherited short year keeps complete false

all checks passed
```

## Full suite
```

=== statcast-data.test.js ===
ok    sprint speed starts 2015
ok    exit velo / launch angle starts 2015
ok    outs above average starts 2016
ok    arm strength starts 2020
ok    bat tracking starts 2023
ok    nothing claims tracking before 2015 — n=0
ok    every row has an mlbam id — n=0
ok    every year 2015-2025 has a statcast file with rows — present=11/11

=== trisim.test.js ===
ok    three mounds, one per plate
ok    each mound lies on its plate→centroid line
ok    mounds track the base centroid
ok    tri game produces a winner
ok    line scores sum to totals
ok    log runs match totals
ok    same seed reproduces the game
ok    every pitch lands inside the shared 1s window
ok    cycles: ≤3 pitches, unique plates, time-ordered
ok    never two runners on one node (30 tri games)
ok    'any' release outscores 'origin' release — any=14.6 origin=6.9 runs/game
ok    defense cuts down runners (CUT plays occur) — 49 in 60 games
ok    defense turns double plays — 50 in 60 games
ok    every CUT names its victim

All checks passed.

20/20 test files passed
```

## Demonstrated failure (the assertion has been watched failing)

`mergeManifest` was temporarily reverted to the old replace behaviour
(`const years = [...run.years]`, `firstYear: run.firstYear`,
`lastYear: run.lastYear`) and the test re-run:

```
--- REVERTED RUN ---
ok    importing build-seasons.mjs exports mergeManifest without building
FAIL  scoped 2023-2024 run keeps all 150 years — years=2
FAIL  firstYear stays 1876 — firstYear=2023
FAIL  lastYear stays 2025 — lastYear=2024
ok    complete stays true — complete=true
...
TypeError: Cannot read properties of undefined (reading 'seasonRows')
    at tests/manifest-merge.test.js:89
exit=1
```

The headline assertion reports `years=2` instead of 150 — exactly the live
downgrade. The later TypeError is the 1924 entry having been deleted outright
by the replace, which is the same bug seen from the other side.

Restored from the pre-revert copy:

```
--- RESTORED RUN ---
ok    finishedLoop:false yields complete:false even with clean years — complete=false years=150
ok    an inherited short year keeps complete false

all checks passed
```

## Real-world proof: `node tools/build-seasons.mjs 2023 2024`

Warm cache, `cache 156 hits 0 fetched`, exit 0.

| figure | before the scoped run | after the scoped run (old code) | after the scoped run (fixed) |
| --- | --- | --- | --- |
| `complete` | `true` | `true` (vacuously) | `true` |
| years in manifest | 150 | 2 | **150** |
| `firstYear`–`lastYear` | 1876–2025 | 2023–2024 | **1876–2025** |
| clubsEmpty summed | 111 | ~0 | **111** |
| `lastRun` | absent | absent | **`{"firstYear":2023,"lastYear":2024,"finishedAt":"2026-09-17T17:55:06.370Z"}`** |

Measured after the fixed run:

```
complete true | years 150 | 1876 - 2025 | clubsEmpty 111 | lastRun {"firstYear":2023,"lastYear":2024,"finishedAt":"2026-09-17T17:55:06.370Z"} | failures 0
```

## sha1 confirmation

Backed up before the scoped run (copies in the session scratchpad):

```
13e87c69c611117120995c2ae9d605882a06bd60 *data/_build.json
266b82551e47bd0784b83d1f339a1629adb5efb9 *data/coverage.json
```

`data/coverage.json` after everything: `266b82551e47bd0784b83d1f339a1629adb5efb9` — unchanged.

Disclosure: `node tools/build-coverage.mjs` was invoked once during the
"does it still succeed appropriately" check (it succeeded — the merged
manifest reads `complete: true`, so the gate correctly lets it through) and it
rewrote `coverage.json` to `acbd7424…`. It was immediately restored from the
sha1-verified backup to `266b8255…`. No coverage rebuild is left in the tree.

## openSpine staleness check

With the scoped run's manifest in place (`finishedAt` bumped) and coverage.json
deliberately NOT rebuilt:

```
THREW: spine: coverage.json is stale relative to the spine build — coverage.json
reports spineBuiltAt="2026-09-16T03:43:14.982Z" but data/_build.json finished at
"2026-09-17T17:55:06.370Z". Re-run `node tools/build-coverage.mjs` against the
current spine.
```

That is the correct behaviour: a scoped rebuild does invalidate the coverage
measurement, and the existing `spineBuiltAt` guard says so.

## Final tree state

`data/` is gitignored and nothing under it is committed. After the proof runs,
both `data/_build.json` and `data/coverage.json` were restored from their
sha1-verified backups, so the data tree is byte-identical to how it was found:

```
13e87c69c611117120995c2ae9d605882a06bd60 *data/_build.json
266b82551e47bd0784b83d1f339a1629adb5efb9 *data/coverage.json
```

The manifest was restored rather than left at the scoped run's output for one
reason: the deliberately-stale `coverage.json` makes `tests/spine-query.test.js`
fail its staleness assertion (correctly), which would leave the suite reading
19/20 on a purely data-state basis. With the tree as found, the suite is 20/20.
`onlyprompts.json` was not staged, moved or touched.

———
Generated by claude-opus-5 · task completed
