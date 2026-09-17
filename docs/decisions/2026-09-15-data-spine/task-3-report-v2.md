# Task 3 report v2 — season lines, 1876-2025, batters and pitchers

Status: DONE. Commit `d829c79` on branch `data-spine`.

## Files changed (file by file)

### `tools/lib/duck.mjs` (new)
Exactly as specified in the brief and reaffirmed unchanged by the addendum
(section 6): `openDb(file = ':memory:')` wraps `DuckDBInstance.create` +
`connect`, exposing `all(sql)` (via `runAndReadAll().getRowObjects()`),
`run(sql)`, and `close()`. `sqlPath(p)` replaces backslashes with forward
slashes for SQL string literals.

### `tools/build-seasons.mjs` (new)
Implements the addendum's replacement source and fetch pattern in full:

- Default year range 1876-2025 (overridable via two numeric argv args, per
  the brief).
- Per year: fetches `teams?sportId=1&season=${year}`, filters to
  `t.sport.id === 1`.
- Resolves each club's league abbreviation via a small memoized
  `leagueAbbr(id, name)` helper that calls `getJson` on
  `/api/v1/league/${id}` (itself disk-cached) and falls back to the league
  name already present on the club record if that call fails. This was
  needed because `teams/stats` splits return only `team.id`/`team.name`,
  and historical seasons carry league ids beyond AL/NL (e.g. 100 = American
  Association, 101 = Union Association in 1884) — a hardcoded AL/NL map
  would have silently mislabeled every non-AL/NL season.
- Per club: two roster-hydrate fetches (`group=hitting`, `group=pitching`),
  pooled at concurrency 8 via `pool()`, exactly the pattern in
  `tools/build-data.mjs`. Reads `spot.person.stats[0].splits[0].stat`,
  skips entries where that path is missing.
- `toOuts(ip)` parses `inningsPitched` as whole-and-thirds
  (`"217.0"` → 651, `"216.1"` → 649), not as a float. Exported for the
  test's network-free unit checks.
- Row shape matches the addendum's final column list exactly: `year,
  mlbam, bbref (NULL), name, pos, team, lg, role, pa, ab, h, d2, d3, hr,
  bb, so, sb, cs, hbp, ipouts, er, bf, p_h, p_bb, p_so, p_hr`. `mlbam` is
  native (`spot.person.id`); `bbref` is always NULL (reserved for a future
  Retrosheet/Chadwick-register hop per the addendum); `pos` comes from
  `spot.position.abbreviation`.
- Per-year rows are written to a temp JSON file under
  `data/.cache/seasons-tmp/`, loaded into DuckDB with `read_json_auto`,
  cast to explicit types, and `COPY ... TO ... (FORMAT PARQUET)`'d to
  `data/seasons/{year}.parquet`; the temp file is deleted immediately
  after and the temp directory is removed at the end of the run. This
  ingest-via-temp-JSON approach was not spelled out in either document —
  the brief's builder used `read_csv_auto` directly against CSV files,
  but the addendum's source is roster-hydrate JSON responses that must be
  parsed and reshaped in JS first, so there is no direct-file DuckDB read
  available. A JSON scratch file is the smallest addition that reuses
  `read_json_auto`'s type inference before the explicit `CAST`s pin every
  column to the schema's declared type.
- League dataset: two fetches per year
  (`teams/stats?stats=season&group=hitting|pitching&season=${year}&sportId=1`),
  joining hitting and pitching splits by team id (`ra` from the pitching
  split's `runs`, everything else from hitting). Team abbreviation and
  league resolved from the same per-year `clubs`/`lgByClub` map built for
  the season fetch, at no extra request cost. Written to
  `data/league/{year}.parquet` with the addendum's 13-column schema
  (`w`/`l` dropped as instructed).
- Cache-summary line: `console.log(\`cache  ${cs.hits} hits  ${cs.misses} fetched\`)`
  exactly as the addendum asked.
- **Guarded entry point** (not in either document, and a real bug I caught
  before it shipped): the whole builder ran as top-level module code. The
  test needs `toOuts` importable without triggering ~7,500 network
  requests, so I wrapped the entire per-year loop and DuckDB session in an
  `async function main()` and added `if (isMain) await main();`, where
  `isMain` compares `process.argv[1]` against `fileURLToPath(import.meta.url)`.
  Running `node tools/build-seasons.mjs` behaves identically; `import
  '../tools/build-seasons.mjs'` from the test now only pulls in `toOuts`
  and does nothing else.

### `tests/seasons-data.test.js` (new)
All three addendum-specified test changes applied, plus one more I found
necessary during verification:

1. `'every row carries a player id'` counts `mlbam IS NULL` (was `bbref`).
2. Two `toOuts` unit checks (`'217.0' === 651`, `'216.1' === 649`) added
   above the `data/seasons` existence guard, importing `toOuts` from
   `../tools/build-seasons.mjs` — network-free, run on every clone.
3. History-reaches check changed from 1871 to 1876.
4. **Not anticipated by the addendum:** the Pedro Martinez 2000 check
   originally matched `name = 'Pedro Martinez'` (plain ASCII, per the
   brief's original test text, which the addendum left unmodified except
   for the disambiguation note). The MLB Stats API returns his name as
   `"Pedro Martínez"` (accented í), so the literal match returned zero
   rows and the check failed with `pedro=undefined`. I changed the match
   to `mlbam = 118377` — the exact id the addendum's own probe table cites
   (`Pedro Martinez 2000 (people/118377/stats)`) — which is more precise
   than a name match, immune to encoding/diacritics, and sidesteps the
   two-Pedro-Martinezes disambiguation the addendum flagged as a fallback
   (`AND ipouts > 600`) entirely. Expected values (284 SO, 651 outs) are
   unchanged, as instructed.

## Exact commands run and output

### Cold build
```
$ node tools/build-seasons.mjs
cache  155 hits  7302 fetched
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  106847 player-seasons
  pit  53976 player-seasons

real	2m52.753s
```
(The 155 pre-existing cache hits came from `data/.cache` entries already on
disk from earlier `build-data.mjs` runs / prior session activity, not from
this task.)

### Test, network-free (before build)
```
$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
skip  data/seasons not built — run `node tools/build-seasons.mjs`
(exit 0)
```

### Test, first pass after build (before the Pedro fix)
```
FAIL  known pitcher season is right
```
Diagnosed via a direct DuckDB query: the row was present and numerically
correct (`ipouts 651, er 42, p_so 284`) under `name: "Pedro Martínez"` —
an encoding mismatch, not a data or logic bug. Fixed by matching on
`mlbam = 118377` as described above.

### Test, final
```
$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
ok    history reaches 1876 — lo=1876
ok    history reaches 2024 or later — hi=2025
ok    batter seasons present — bat=106847
ok    pitcher seasons present — pit=53976
ok    known pitcher season is right — {"er":42,"ipouts":651,"p_so":284}
ok    derived PA is never below AB — bad=0
ok    every row carries a player id — null=0
ok    2019 runs per team-game is ~4.8 — rpg=4.831
(exit 0)
```

### Full suite
```
$ node tools/run-tests.mjs
...
15/15 test files passed
```
(Full per-file output includes all fourteen pre-existing files plus
`seasons-data.test.js`; every file printed `ok`/`All checks passed`/`all
good` with no `FAIL` lines.)

### Warm rerun (idempotency / cache check)
```
$ node tools/build-seasons.mjs
cache  7457 hits  0 fetched
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  106847 player-seasons
  pit  53976 player-seasons

real	0m27.004s
```
Zero new fetches, identical row counts — confirms the build is
deterministic and the disk cache is being used correctly on rerun.

## Year span, row counts

- `data/seasons/*.parquet`: years 1876-2025, 150 files, 106,847 batter
  seasons, 53,976 pitcher seasons.
- `data/league/*.parquet`: 150 team-season files (one per year, 1876-2025).

## What I changed from the brief/addendum, and why

1. **Ingest via temp JSON + `read_json_auto`**, not a direct-file DuckDB
   read. Necessary because the addendum's source is parsed/reshaped JS
   objects (from JSON API responses), not a CSV DuckDB can read directly.
   Not spelled out in either document; the closest analog is the brief's
   `read_csv_auto` call, which no longer applies.
2. **League abbreviation resolved via `/api/v1/league/{id}` lookups**
   (cached, one request per distinct historical league id — about a dozen
   across 150 years), instead of assuming AL=103/NL=104 for every season.
   Necessary because pre-1901 and defunct-league seasons (American
   Association, Union Association, Players League, Federal League) use
   other ids, and the `teams/stats` league-totals endpoint doesn't include
   the club's league on the split itself.
3. **Guarded the builder's `main()` behind an entrypoint check** so
   `import '../tools/build-seasons.mjs'` in the test (for `toOuts`) doesn't
   fire the entire ~7,500-request build. This is a bug the brief's own
   inline builder code would have had if imported the same way; neither
   document flagged it because the brief's test imported `duck.mjs`, not
   the builder itself — the addendum's requirement to unit-test `toOuts`
   from the builder module introduced this hazard.
4. **Pedro Martinez test match changed from name to `mlbam = 118377`**, as
   detailed above — an encoding issue neither document anticipated,
   resolved using the addendum's own verification id rather than
   inventing a new one.
5. **File count is 150, not "roughly 155" as the brief's Step 5 expected**
   — this is not a bug, just arithmetic: the addendum moved the start year
   from 1871 to 1876, and 2025 − 1876 + 1 = 150.

## Things I was unsure about

- Whether team abbreviations from the roster/teams-list endpoint
  (`club.abbreviation`, e.g. `"NYA"` vs `"NYY"` historically) are stable
  and match what later tasks (4-8) will expect for joins against other
  sources. I used the same field `tools/build-data.mjs` already trusts, so
  it's at least internally consistent with the existing codebase, but I
  did not cross-check it against Retrosheet/Lahman team codes since that
  crosswalk is explicitly Task 4's job per the addendum.
- Early-era coverage thinness (caught stealing, HBP before the 1950s,
  and generally shallower rosters in the 1876-1900 window) — the addendum
  says this is expected and is what Task 6's `coverage.json` measures
  honestly; I did not attempt to backfill or flag it further here.
- The `leagueAbbr` fallback (using the club's league *name* when the
  `/api/v1/league/{id}` lookup fails) is untested in this run since it
  never failed in the full 1876-2025 build, but it's a defensive path I
  added, not something either document required.

---

## Fix round 1/5 (post-review)

Commit `af6fb6b` on branch `data-spine`. Files touched: `tools/build-seasons.mjs`,
`tests/seasons-data.test.js` only (no other files staged).

### Finding 1 (Critical, addendum defect) — traded players got the combined line per club

`person.stats[0].splits[0]` is the season TOTAL for a traded player (carries
`numTeams`), not that club's line. Fixed per the coordinator's ruling:

- Added `team` to both hydrate strings:
  `hydrate=person(stats(type=season,group=${group},season=${year},team))`.
- Added `ownSplit(stats, clubId)`: picks the split where `split.team.id ===
  clubId`; falls back to the sole split only when `splits.length === 1` and
  it carries no `numTeams` (never falls back to a `numTeams`-bearing split).
- Both the hitting and pitching row-building loops now call `ownSplit`
  instead of indexing `splits[0]` directly.

This changed every hydrate URL, so the disk cache was cold for these
requests: the rebuild took `1m56s` and fetched 6,896 (only 561 cache hits,
carried over from the unrelated `league`/`teams` endpoints whose URLs did
not change).

### Finding 2 (Important) — a failing club could truncate or silently under-report

- Each club's fetch+parse is now wrapped in `try/catch`. A failure is
  pushed to a `failures` array and printed immediately as
  `WARN ${year} ${club.abbreviation}: ${reason}`; that club contributes
  zero rows for the year instead of aborting the whole run.
- Per year, `fetchedClubs` (count of clubs whose fetch succeeded) is
  compared against `clubs.length` (from the teams endpoint) and a
  `WARN ${year}: expected N clubs, fetched M` line prints on mismatch.
- The league-stats fetch (`teams/stats` for hitting/pitching) is also
  wrapped in try/catch; a failure there is recorded the same way and that
  year's league file is skipped rather than aborting the run.
- At the end, if `failures.length > 0`, the script prints a `N fetch
  failure(s):` summary listing every `{year, club, error}` and sets
  `process.exitCode = 1` — a partial spine now cannot report success.
- On the actual 1876-2025 rebuild this round, zero `WARN` lines were
  printed and the run exited 0 — no failures were hit in practice, but the
  guard is in place and code-verified.

### Finding 3 (Important) — missing middle years were undetectable

Added two checks to `tests/seasons-data.test.js`, inside the existing
`data/seasons` skip guard: for the full range 1876-2025, verify each year
has both a `data/seasons/{year}.parquet` and a `data/league/{year}.parquet`
file present on disk AND at least one row for that year in the aggregated
Parquet glob (a `GROUP BY year` count map). The detail string reports the
missing count and names the first five missing years, e.g. `missing=3
first: 1953,1972,1981`.

### Verification (as required)

**1. Stroman 2019 split:**
```
$ node -e "... query data/seasons/2019.parquet WHERE mlbam=573186 AND role='pit' ..."
[{"team":"NYM","ipouts":179,"p_so":60},{"team":"TOR","ipouts":374,"p_so":99}]
```
374 (TOR) + 179 (NYM) = 553, exactly the old single wrong combined value —
confirms the split now correctly attributes IP to each club and the old
value was the double-counted combined total.

**2. 2019 season-total sanity:**
```
SELECT sum(ipouts) FROM read_parquet('data/seasons/*.parquet') WHERE year=2019 AND role='pit'
-> 130311 outs = 43437 IP
```
43,437 IP is right in line with 30 clubs x ~1,448 IP (~43,500 expected);
no evidence of remaining double-counted combined lines.

**3. Pedro Martinez 2000 control (untraded):**
```
SELECT ipouts, p_so FROM read_parquet('data/seasons/*.parquet') WHERE year=2000 AND mlbam=118377 AND role='pit'
-> [{"ipouts":651,"p_so":284}]
```
Unchanged, as expected.

### Commands run

```
$ node tools/build-seasons.mjs
cache  561 hits  6896 fetched
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  106796 player-seasons
  pit  53962 player-seasons
real  1m56.117s

$ node tools/build-seasons.mjs        # warm rerun, sanity check
cache  7457 hits  0 fetched
(same counts)
exit 0

$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
ok    history reaches 1876 — lo=1876
ok    history reaches 2024 or later — hi=2025
ok    batter seasons present — bat=106796
ok    pitcher seasons present — pit=53962
ok    known pitcher season is right — {"er":42,"ipouts":651,"p_so":284}
ok    derived PA is never below AB — bad=0
ok    every row carries a player id — null=0
ok    every year 1876-2025 has a seasons file with rows — missing=0
ok    every year 1876-2025 has a league file with rows — missing=0
ok    2019 runs per team-game is ~4.8 — rpg=4.831
(exit 0)

$ node tools/run-tests.mjs
...
15/15 test files passed
```

### New row counts

`data/seasons/*.parquet`: 106,796 batter seasons, 53,962 pitcher seasons
(down slightly from the buggy 106,847 / 53,976 — traded players now
contribute one correctly-scoped row per club instead of one
combined-total row per club, which changes both the row count and every
traded player's per-club numbers).

`data/league/*.parquet`: unchanged, 150 files (this dataset was never
affected by the splits[0] bug).

### Concerns / things I did not independently re-verify

- The failure-handling and per-year club-count-mismatch code paths
  (Finding 2) were not exercised by a real failure in this run — no club
  fetch failed and no count mismatch occurred, so the WARN/summary/exit(1)
  paths are code-reviewed and reasoned through but not observed firing on
  live data. I did not construct a synthetic failure to force-test them,
  since doing so would require modifying `fetch.mjs` or injecting a bad
  URL, which felt out of scope for this fix round.
- I did not audit every year for players with 3+ team splits (players
  traded twice in one season) beyond confirming `ownSplit`'s logic handles
  an arbitrary number of splits by id match; Stroman (2 teams) was the
  only case directly verified.

---

## Fix round 2/5 (post-review)

Commit `e2ca152` on branch `data-spine`. Files touched: `tools/build-seasons.mjs`,
`tests/seasons-data.test.js` only (no other files staged).

### Finding — the `solo` fallback accepted a split belonging to a different club

`ownSplit()`'s fallback fired whenever a club's fetch returned exactly one
split and that split had no `numTeams`, without checking whether the split
actually named this club. A player rostered by multiple clubs in a season
(e.g. Aaron Altherr, 2019 — one inning pitched, for PHI only, while also
carried on NYM's and SF's rosters that year) has every club's fetch return
the identical single PHI-labeled split. `own` correctly failed to match on
the NYM/SF fetches, but `solo` accepted the PHI split anyway on all three,
producing three rows (NYM, PHI, SF) for one inning of work.

Fix, exactly as ruled: added `!splits[0].team` to the fallback condition,
so a lone split is only usable as a fallback when it names no team at all
(previously it only required `!numTeams`). If a lone split does name a
team, it must match via `own` or the row is dropped — per the ruling, this
dataset must under-report an unattributable row rather than mis-attribute
it.

```js
function ownSplit(stats, clubId) {
  const splits = (stats && stats.splits) || [];
  const own = splits.find((s) => s.team && s.team.id === clubId);
  const teamless = splits.length === 1 && !splits[0].team && !splits[0].numTeams
    ? splits[0] : null;
  return own || teamless || null;
}
```

### Regression test added

`'no duplicate high-volume player-club rows'` in `tests/seasons-data.test.js`,
inside the existing skip guard: groups 2019 rows by `(mlbam, role, ipouts,
pa)` restricted to real-volume rows (`pa > 20` or `ipouts > 30`) and asserts
no group has `count(*) > 1`. This is the check that would have caught both
round 1 (combined-line duplication) and round 2 (teamed-single-split
duplication); neither the original plan nor either prior fix round had it.

### Verification (as required)

**1. Altherr, 2019, pitching — exactly one row:**
```
SELECT team, ipouts FROM read_parquet('data/seasons/2019.parquet')
WHERE name LIKE '%Altherr%' AND role='pit'
-> [{"team":"PHI","ipouts":3}]
```

**2. Duplicate-row check, 2019 — now 0 (was 3):**
```
SELECT count(*) FROM (
  SELECT mlbam, role, ipouts, pa FROM read_parquet('data/seasons/2019.parquet')
  WHERE coalesce(pa,0) > 20 OR coalesce(ipouts,0) > 30
  GROUP BY 1,2,3,4 HAVING count(*) > 1)
-> 0
```

**3. Stroman 2019 — unchanged:**
```
-> [{"team":"NYM","ipouts":179,"p_so":60},{"team":"TOR","ipouts":374,"p_so":99}]
```

**4. Pedro Martinez 2000 (mlbam 118377) — unchanged:**
```
-> [{"ipouts":651,"p_so":284}]
```

### Commands run

```
$ node tools/build-seasons.mjs
cache  7457 hits  0 fetched          # hydrate URLs unchanged this round, fully cached
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  105833 player-seasons
  pit  53719 player-seasons
real  0m17.144s

$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
ok    history reaches 1876 — lo=1876
ok    history reaches 2024 or later — hi=2025
ok    batter seasons present — bat=105833
ok    pitcher seasons present — pit=53719
ok    known pitcher season is right — {"er":42,"ipouts":651,"p_so":284}
ok    derived PA is never below AB — bad=0
ok    every row carries a player id — null=0
ok    every year 1876-2025 has a seasons file with rows — missing=0
ok    every year 1876-2025 has a league file with rows — missing=0
ok    no duplicate high-volume player-club rows — dupes=0
ok    2019 runs per team-game is ~4.8 — rpg=4.831
(exit 0)

$ node tools/run-tests.mjs
...
15/15 test files passed
```

### New row counts

`data/seasons/*.parquet`: 105,833 batter seasons, 53,719 pitcher seasons
(down from 106,796 / 53,962 — the mis-attributed teamed-single-split rows,
like Altherr's extra NYM/SF rows, are the rows that dropped out).

`data/league/*.parquet`: unchanged, 150 files — never affected by this bug
class.

### Concerns

- I did not exhaustively search all 150 years for every instance of this
  pattern beyond the regression test's 2019-year scope; the regression
  test as written only checks the year 2019. If the same defect class
  recurs in a different year via a different mechanism, this specific test
  would not catch it unless it also hits 2019. I judged this acceptable
  since the fix is structural (in `ownSplit`, applied to every year
  uniformly), not year-specific, and the coordinator's own ruling scoped
  verification to 2019.

---

## Fix round 3/5 (post-review, test-only)

Commit `54c5c0b` on branch `data-spine`. File touched: `tests/seasons-data.test.js`
only. `tools/build-seasons.mjs` is unchanged this round — the round-2 data
fix was independently confirmed correct across all 150 years.

### Finding — the regression test's grouping key produced false positives when widened

The round-2 test grouped on `(mlbam, role, ipouts, pa)`, scoped to 2019
only. Run across all years, that key reports 31 groups that are legitimate
coincidences (a traded player recording the same PA count at both clubs
while H/HR/BB/etc. genuinely differ), not the mis-attribution bug. So the
test as committed would pass today but fail spuriously the moment someone
widened its year range — punishing exactly the person trying to make it
stronger.

Fix, exactly as ruled:
- Grouping key widened to the full stat line: `year, mlbam, role, pa, ab,
  h, d2, d3, hr, bb, so, sb, cs, hbp, ipouts, er, bf, p_h, p_bb, p_so,
  p_hr`, via `GROUP BY ALL`. Two rows for the same player-season are only
  the bug if every measured column matches.
- Scope widened from `year = 2019` to all years (the existing `glob`
  variable already covers `data/seasons/*.parquet`).
- Volume floor kept: `coalesce(pa,0) > 20 OR coalesce(ipouts,0) > 30`.
- On failure, the first three offending rows (`year/mlbam/role`) are
  included in the detail string instead of a bare count.
- Renamed to `'no player-season duplicated across clubs (all years)'`.

### Verification

```
$ node tests/seasons-data.test.js
...
ok    no player-season duplicated across clubs (all years) — dupes=0
...
(exit 0, 13/13 ok)
```
The widened, full-line, all-years check reports `dupes=0` — matching the
coordinator's independent verification that 0 fully-identical stat lines
exist at 2+ clubs across all 150 years, and correctly does NOT report the
31 false positives the narrower key would have produced.

```
$ node tools/run-tests.mjs
...
15/15 test files passed
```

### Concerns

None. `build-seasons.mjs` was not touched, per instruction, and its
correctness was independently confirmed by the coordinator this round.

---

## Fix round 4/5 (post-review) — Findings 6 and 7

Commit `1aaf69d` on branch `data-spine`. Files touched: `tools/build-seasons.mjs`,
`tests/seasons-data.test.js` only. The eleven modified and two untracked
unrelated user files in the working tree were left alone and not staged.

### Finding 6 (Important) — the per-club try/catch conflated code bugs with network failures

The per-club `try` wrapped both `getJson` calls *and* the entire row-building
loop — every `ownSplit()` call and every property access on `spot.person` /
`st`. A `TypeError` from a genuine code bug was therefore caught and printed
as a `WARN <year> <club>: <reason>` line, indistinguishable from an HTTP
failure, and silently degraded into "one club had a transient problem".

Fixed exactly per the ruling: the `try` now wraps the fetch only.

```js
let hj;
let pj;
try {
  [hj, pj] = await Promise.all([getJson(hitUrl), getJson(pitUrl)]);
} catch (e) {
  const reason = (e && e.message) || String(e);
  failures.push({ year, club: club.abbreviation, error: reason });
  console.log(...WARN...);
  return { ok: false, rows: [] };
}

const rows = [];
for (const spot of hj.roster || []) { /* ... */ }
```

This is the same shape as the league-stats `try/catch` further down the same
file (which already wrapped only its fetch and left splits processing
outside) — the in-file precedent the ruling pointed at. The two row loops
were dedented by two spaces and the now-dead outer `catch` removed; no other
change to their bodies. A malformed payload now throws out of `pool()` and
aborts the build rather than being swallowed, which is the intended trade.

### Finding 7 (Important) — a partial spine was indistinguishable from a complete one on disk

Implemented the manifest, not temp-directory promotion.

- New `MANIFEST = path.join(ROOT, 'data', '_build.json')`.
- A per-year `entry = { year, clubsExpected, clubsFetched, seasonRows,
  leagueRows }` is pushed right after the existing `fetchedClubs` mismatch
  WARN, then `entry.seasonRows` / `entry.leagueRows` are filled in as each
  parquet is written. `clubsExpected` is `clubs.length` from the teams
  endpoint; `clubsFetched` is the count of clubs whose fetch returned ok.
- `writeManifest()` emits the exact shape specified (`tool`, `startedAt`,
  `finishedAt`, `complete`, `firstYear`, `lastYear`, `years[]`, `failures[]`),
  with `complete` true only when the loop ran to the end, `failures` is empty,
  and every year has `clubsFetched === clubsExpected`.
- The whole year loop is wrapped in `try { ... } finally { writeManifest(); }`,
  so a crashed run — including the Finding-6 crash the narrowed try now
  allows — still leaves a manifest saying `complete: false` rather than no
  manifest at all. The exception still propagates and still fails the run.
- `process.exitCode = 1` is kept (both, not either) and now also fires on a
  short year, not just on recorded fetch failures. A one-line
  `manifest <path>  complete=<bool>` summary prints at the end.

`data/_build.json` is covered by the existing `data/` entry in `.gitignore`
(`git check-ignore -v data/_build.json` reports `.gitignore:3:data/`), so it
is generated, never committed.

### Test changes

Two checks added to `tests/seasons-data.test.js`, both inside the existing
`data/seasons` skip guard so a fresh clone with no `data/` still passes:

- "build manifest exists and reports a complete build" — reads and parses
  `data/_build.json`, asserts `complete === true`. On an unreadable or missing
  manifest the detail string names the path and the rebuild command.
- "no year lost a club during the build" — filters `manifest.years` for
  `clubsFetched < clubsExpected` and names the first three offenders as
  `year fetched/expected`.

Failure path verified by temporarily moving the manifest aside:

```
$ mv data/_build.json data/_build.json.bak && node tests/seasons-data.test.js
FAIL  build manifest exists and reports a complete build — unreadable ...\data\_build.json — rerun `node tools/build-seasons.mjs`
FAIL  no year lost a club during the build — short=0
(exit 1)
$ mv data/_build.json.bak data/_build.json
```

### Commands run and output

```
$ node --check tools/build-seasons.mjs
(silent — syntax ok)

$ node tools/build-seasons.mjs
cache  7457 hits  0 fetched
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  105833 player-seasons
  pit  53719 player-seasons
manifest C:\Users\nik\Documents\AI\more-bases-ball\data\_build.json  complete=true
real  0m27.883s
exit 0
```

Fully warm — 0 new fetches, so this rebuild re-derived nothing; it only
re-emitted the parquet files and produced the manifest.

Manifest summary:

```
complete true  years 150  failures 0  firstYear 1876  lastYear 2025
{"year":1876,"clubsExpected":8,"clubsFetched":8,"seasonRows":157,"leagueRows":8}
{"year":1950,"clubsExpected":16,"clubsFetched":16,"seasonRows":825,"leagueRows":16}
{"year":2025,"clubsExpected":30,"clubsFetched":30,"seasonRows":1856,"leagueRows":30}
sum(seasonRows) = 159552   (= 105833 bat + 53719 pit, exactly)
startedAt 2026-09-16T01:09:12.047Z  finishedAt 2026-09-16T01:09:39.418Z
```

```
$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
ok    history reaches 1876 — lo=1876
ok    history reaches 2024 or later — hi=2025
ok    batter seasons present — bat=105833
ok    pitcher seasons present — pit=53719
ok    known pitcher season is right — {"er":42,"ipouts":651,"p_so":284}
ok    derived PA is never below AB — bad=0
ok    every row carries a player id — null=0
ok    every year 1876-2025 has a seasons file with rows — missing=0
ok    every year 1876-2025 has a league file with rows — missing=0
ok    no player-season duplicated across clubs (all years) — dupes=0
ok    build manifest exists and reports a complete build — complete=true years=150 failures=0
ok    no year lost a club during the build — short=0
ok    2019 runs per team-game is ~4.8 — rpg=4.831
(exit 0, 15/15)

$ node tools/run-tests.mjs
...
15/15 test files passed
(exit 0)
```

### Row counts before and after

| | before | after |
|---|---|---|
| batter-seasons | 105,833 | **105,833** |
| pitcher-seasons | 53,719 | **53,719** |
| `data/seasons/*.parquet` | 150 | 150 |
| `data/league/*.parquet` | 150 | 150 |

Unchanged, as required. Spot checks re-confirmed against the rebuilt files:

```
Stroman 2019 pit    -> [{"team":"NYM","ipouts":179,"p_so":60},{"team":"TOR","ipouts":374,"p_so":99}]
Altherr 2019 pit    -> [{"team":"PHI","ipouts":3}]
Pedro 2000 (118377) -> er 42, ipouts 651, p_so 284   (via the test)
```

### Things I was unsure about

- **`complete` also requires `finishedLoop`.** The ruling defines `complete`
  as "failures empty AND every year clubsFetched === clubsExpected". Taken
  literally, a build that crashed in 1912 would write a manifest with 36
  clean year entries, no failures, and `complete: true` — precisely the
  false-complete the finding exists to prevent. I added `finishedLoop` to the
  conjunction so a crashed run is never `complete`. This is stricter than the
  literal wording, never looser.
- **Years with zero clubs are absent from `years[]`, not entered as zero.**
  The pre-existing `if (!clubs.length) continue;` fires before any accounting.
  No year in 1876-2025 hits it, so `years.length === 150` today. A consumer
  wanting "one entry per year in [firstYear, lastYear]" should check
  `years.length` against the span; the test covers the same ground via the
  separate per-year file-coverage checks.
- **`exitCode = 1` now also fires on a short year** (previously only on a
  non-empty `failures`). In practice these coincide — a club is only short
  because its fetch failed and pushed a failure — but a future code path
  could drop a club without recording a failure, and the two signals should
  not be able to disagree with the manifest.
- **Git printed "LF will be replaced by CRLF" on staging.** That is this
  machine's `core.autocrlf`, not something I wrote: both files are LF on disk
  (zero CR bytes) and were written LF.
- The narrowed try means a malformed API payload now aborts the whole build
  instead of skipping one club. That is the ruled-on trade, but it is a
  behaviour change I did not exercise against a real malformed payload — the
  path is code-reviewed, not observed.

---
Generated by claude-opus-5 · task completed

---

## Fix round 5/5 (post-review) — Items 1, 2, 3, and a blocking finding

Commit `25b66cf` on branch `data-spine`. Files touched: `tools/build-seasons.mjs`,
`tests/seasons-data.test.js` only. The unrelated user changes in the working
tree were left alone and not staged.

**Status: all three items implemented exactly as ruled. The build now reports
`complete: false` and exits 1, and the suite is 14/15. This is not a defect in
the implementation — Item 1's completeness condition is unsatisfiable against
this data source. Details in "Blocking finding" below. Per the explicit
instruction, I am reporting it rather than adjusting the check to pass.**

### Item 1 — `clubsFetched` counted clubs that contributed nothing

`r.ok` is set as soon as the two `getJson` calls resolve, before any row is
built, so a club with a successful-but-empty roster still counted as fetched.

Implemented as ruled:

- Each year entry gains `clubsWithRows` — `perClub.filter((r) => r.rows.length > 0).length`
  — alongside the retained `clubsExpected` and `clubsFetched`.
- A per-year WARN fires on a `clubsWithRows` shortfall, in the same shape as
  the existing `clubsFetched` WARN.
- Completeness is now a single named predicate used by both the manifest and
  the exit-code path:

```js
const yearIsClean = (y) => y.clubsFetched === y.clubsExpected
  && y.clubsWithRows === y.clubsExpected;
```

- `process.exitCode = 1` fires on a `clubsWithRows` shortfall too, and the
  end-of-run listing prints both numbers per offending year
  (`1914: fetched 24/24, with rows 16/24`).
- `clubsFetched` kept as its own field, as instructed — the distinction
  between "fetch failed" and "fetched but empty" is what made the blocking
  finding below diagnosable at all. All 150 years have
  `clubsFetched === clubsExpected`; the shortfall is entirely in `clubsWithRows`.

The test's shortfall check now fails on either column and names offenders as
`year fetched N/E rows M/E`.

### Item 2 — duplicated completeness formula

`writeManifest()` now returns its `complete` into a `manifestComplete`
variable assigned in the `finally`, and the end-of-run line logs that value
instead of recomputing `failures.length === 0 && short.length === 0` (which
had silently omitted the `finishedLoop` term). One source of truth.

### Item 3 — atomic manifest write

```js
const tmp = `${MANIFEST}.tmp`;
fs.writeFileSync(tmp, body);
fs.renameSync(tmp, MANIFEST);
```

Confirmed no `data/_build.json.tmp` remains after the run (`ls data/ | grep -i tmp`
returns nothing; only `data/_build.json`, 24,406 bytes, is present).

I left the parked `finally`-masks-the-original-exception item alone, as
instructed.

### BLOCKING FINDING — `clubsWithRows === clubsExpected` is unsatisfiable against this source

The rebuild reports:

```
41 year(s) short of their club count
109 of 150 years clean
complete=false, exit 1
```

`clubsExpected` comes from `teams?sportId=1&season=${year}`, which is a
franchise list, not a list of clubs that played and have player-level data.
Across the 41 affected years there are **111 empty club-years**, and they are
not random:

| count | league |
|---|---|
| 28 | Negro National League (I) |
| 25 | Negro American League |
| 16 | Federal League |
| 14 | Negro National League (II) |
| 9 | American Association (1880s) |
| 9 | (no league — franchises that had not begun play) |
| 8 | Eastern Colored League |
| 2 | Negro Southern League |

Sample of the empty clubs, direct from the API:

```
1996  TB    "Tampa Bay Devil Rays"      league undefined   (first played 1998)
1996  AZ    "Arizona Diamondbacks"      league undefined   (first played 1998)
1914  CHI-F "Chicago Whales"            Federal League
1914  BAL-F "Baltimore Terrapins"       Federal League     (+6 more Federal clubs)
1948  HOM   "Homestead Grays"           Negro National League (II)
1948  KCM   "Kansas City Monarchs"      Negro American League   (+7 more)
1932  ABC   "Indianapolis ABC's"        Negro Southern League
1882  STL-A "St. Louis Cardinals"       American Association
```

Their roster endpoint returns zero entries for both `group=hitting` and
`group=pitching` — the fetch succeeds, the payload is well-formed, there are
simply no players in it.

Cross-checking `leagueRows` (the independent `teams/stats` endpoint) against
`clubsWithRows` separates two distinct causes:

- **Franchise did not play that season.** 1996 has `leagueRows` 28 and
  `clubsWithRows` 28 against `clubsExpected` 30 — the team-totals endpoint
  agrees TB and AZ did not play. Here `clubsExpected` is simply wrong as a
  denominator. 9 club-years.
- **Club played but the API has no player-level data for it.** 1914 has
  `leagueRows` 24 (all Federal clubs have team totals) but `clubsWithRows` 16.
  The Negro Leagues and 1880s AA cases behave the same way. ~102 club-years.
  This is precisely the thin early-era coverage the addendum anticipated:
  "early-era coverage for some fields may be thinner than Lahman's.
  `coverage.json` in Task 6 measures that honestly from what actually lands."

Neither cause is a builder bug and neither loses a row: totals are unchanged
at 105,833 / 53,719 and `sum(seasonRows)` is still exactly 159,552. But as
ruled, `complete` can never become true for 1876-2025, which would permanently
block the two tasks that gate on it.

**What I did not do:** I did not weaken the check, exclude leagues, or special-case
years. That is a coordinator decision. The options I can see, for your ruling:

1. **Derive the denominator from `teams/stats`** rather than the teams list —
   i.e. `clubsExpected = leagueRows`. Fixes the 9 never-played club-years
   cleanly, leaves the ~102 no-player-data ones still short.
2. **Make `clubsWithRows` shortfalls a recorded, non-fatal fact** — keep the
   field and the per-year WARN, record the empty clubs in the manifest (say a
   `clubsEmpty: [...]` list per year), but keep them out of `complete`, which
   stays "no failures and `clubsFetched === clubsExpected`". Task 6's
   `coverage.json` then measures the thinness, which is its stated job.
3. **Scope the condition to the modern era** (e.g. require
   `clubsWithRows === clubsExpected` only from 1901 or 1950 on). I like this
   least — it hard-codes a date into an integrity check.

My own read is (1) and (2) combined: `leagueRows` is the honest denominator
for "clubs that played", and a club that played but has no player rows is a
coverage fact for Task 6, not a build failure. But this changes what
`complete` promises, so I am not making that call.

### Commands run and output

```
$ node --check tools/build-seasons.mjs
(silent — syntax ok)

$ node tools/build-seasons.mjs
WARN 1882: expected 14 clubs, 13 contributed rows
WARN 1883: expected 16 clubs, 15 contributed rows
... (41 such lines) ...
WARN 1997: expected 30 clubs, 28 contributed rows
cache  7457 hits  0 fetched
league  150 seasons of team totals
seasons 1876–2025  files 150
  bat  105833 player-seasons
  pit  53719 player-seasons
manifest C:\Users\nik\Documents\AI\more-bases-ball\data\_build.json  complete=false

41 year(s) short of their club count:
  1882: fetched 14/14, with rows 13/14
  1914: fetched 24/24, with rows 16/24
  1948: fetched 29/29, with rows 20/29
  1996: fetched 30/30, with rows 28/30
  ...
real  0m30.361s
exit 1
```

Warm cache, 0 new fetches — nothing was re-derived.

Manifest state:

```
complete false   years 150   failures 0   firstYear 1876   lastYear 2025
sum(seasonRows) = 159552          (= 105833 bat + 53719 pit, exactly)
clean years (clubsWithRows === clubsExpected): 109 / 150
years with a clubsFetched shortfall: 0
{"year":1996,"clubsExpected":30,"clubsFetched":30,"clubsWithRows":28,"seasonRows":1567,"leagueRows":28}
{"year":2025,"clubsExpected":30,"clubsFetched":30,"clubsWithRows":30,"seasonRows":1856,"leagueRows":30}
```

```
$ ls data/ | grep -i tmp
(nothing — the rename left no .tmp behind)
```

```
$ node tests/seasons-data.test.js
ok    toOuts full innings — got=651
ok    toOuts partial innings — got=649
ok    history reaches 1876 — lo=1876
ok    history reaches 2024 or later — hi=2025
ok    batter seasons present — bat=105833
ok    pitcher seasons present — pit=53719
ok    known pitcher season is right — {"er":42,"ipouts":651,"p_so":284}
ok    derived PA is never below AB — bad=0
ok    every row carries a player id — null=0
ok    every year 1876-2025 has a seasons file with rows — missing=0
ok    every year 1876-2025 has a league file with rows — missing=0
ok    no player-season duplicated across clubs (all years) — dupes=0
FAIL  build manifest exists and reports a complete build — complete=false years=150 failures=0
FAIL  no year lost a club during the build — short=41 first: 1882 fetched 14/14 rows 13/14, 1883 fetched 16/16 rows 15/16, 1884 fetched 33/33 rows 32/33
ok    2019 runs per team-game is ~4.8 — rpg=4.831
(exit 1, 13/15)

$ node tools/run-tests.mjs
...
14/15 test files passed
(exit 1)
```

The two FAILs are the new checks correctly reporting the finding above. The
other thirteen checks in the file, and the fourteen other test files, are
green and unaffected.

### Row counts before and after

| | before | after |
|---|---|---|
| batter-seasons | 105,833 | **105,833** |
| pitcher-seasons | 53,719 | **53,719** |
| sum(seasonRows) | 159,552 | **159,552** |
| `data/seasons/*.parquet` | 150 | 150 |
| `data/league/*.parquet` | 150 | 150 |

Unchanged. Nothing about this round altered a row; it only changed what the
build asserts about the rows it already had.

### Concerns

- **The suite is red and will stay red until the completeness condition is
  ruled on.** I could have made it green in one line by dropping the
  `clubsWithRows` term, and I deliberately did not.
- **The 111 empty club-years may be worth surfacing in the manifest itself**
  (a per-year `clubsEmpty` array of abbreviations) so Task 6 can report which
  clubs are missing rather than just how many. I did not add it because it
  was not in the ruling and it changes the manifest schema.
- The Negro Leagues club-years are a real and somewhat pointed coverage gap:
  MLB recognises those leagues as major, the team-totals endpoint carries
  them, and the roster endpoint does not. Whatever is decided about
  `complete`, that gap should be visible in `coverage.json` rather than
  silently absorbed.

---
Generated by claude-opus-5 · task completed

---

## Task 3 — corrected ruling applied (2026-09-15, claude-sonnet-5)

**Status:** Done. Corrected ruling implemented exactly as specified: `complete`
now requires `finishedLoop && failures.length === 0 && years.every(y => y.clubsFetched === y.clubsExpected)`.
`clubsWithRows` remains recorded per year but is no longer part of `complete`
and does not affect `process.exitCode`. Added a sorted per-year `clubsEmpty[]`
array of club abbreviations that fetched successfully but contributed zero
player rows, and reworded the per-year console line from `WARN` to `note`
(informational, not an error).

**Commit:** `673dba06dd416c734c9eadeb643dee31d8f19593` — "fix: completeness
gates on clubsFetched, not clubsWithRows" (touches only
`tools/build-seasons.mjs` and `tests/seasons-data.test.js`).

**Complete + samples:** `data/_build.json` now reports `complete: true`
(150 years, 0 failures, 0 clubsFetched shortfalls, no leftover `.tmp`).
`clubsEmpty` verbatim:
- 1914: `["BAL-F","BRO-F","BUF-F","CHI-F","IND-F","KC-F","PIT-F","STL-F"]`
- 1924: `["BRG","CSE","DAY","HIL"]`
- 1996: `["AZ","TB"]`

**Coverage total + rows:** total empty club-years = 111 (unchanged). Row
counts unchanged: 105,833 batter-seasons, 53,719 pitcher-seasons.

**Tests:** `node tests/seasons-data.test.js` — all checks pass, including
the new informational line `empty club-years (fetched, zero player rows): 111`.
`node tools/run-tests.mjs` — 15/15 test files passed.

**Rebuild verification:** `node tools/build-seasons.mjs` ran against the warm
cache: `cache  7457 hits  0 fetched`, `manifest ... complete=true`.

**Concerns:** none — this closes the two open items the prior report flagged
(the suite is green, and `clubsEmpty` now surfaces which clubs are thin per
year for Task 6 to consume). The Negro Leagues / Federal League / expansion
coverage gaps are real and now visible in the manifest's `clubsEmpty` field
per year, ready for a later coverage-reporting task to read.

---
Generated by claude-sonnet-5 · task completed
