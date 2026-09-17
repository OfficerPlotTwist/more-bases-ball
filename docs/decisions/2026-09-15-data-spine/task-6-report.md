# Task 6 report — data/coverage.json

Commit: `f871a6bacd6e30ce2d1faf15fba01d1f3e39228e` on branch `data-spine`.
Files touched (both new): `tools/build-coverage.mjs`, `tests/coverage.test.js`.
No other files staged or modified — verified with `git status --short` before commit.

## Files changed

- **`tools/build-coverage.mjs`** (new) — builds `data/coverage.json`. Structure:
  1. Refusal gate (reads `data/_build.json`, exits 1 if missing or `complete !== true`).
  2. The brief's 11 `PROBES`, unchanged in `where` clauses/source/grain (all still
     resolve against Task 3/5's real columns — verified by running them).
  3. For each probe: `first`, `last`, `rows`, `source`, `grain`, plus addendum-required
     `players` (distinct id — `mlbam` for player-season grain, `team` for
     `team_totals`'s team-season grain, since `data/league/*.parquet` has no `mlbam`
     column) and `playerYearsPerSeason` (`round(rows / (last-first+1))`).
  4. `populationVsWidest` for the 6 Statcast-derived stats, computed against the
     widest **column** in the whole statcast table (see "Widest-column finding" below),
     not just the widest among the 6 named stats.
  5. `leagueOnlySeasons` section built by reading `_build.json`'s per-year `clubsEmpty`
     arrays directly (never recomputed) — 41 years have entries, 111 total empty
     club-years.
  6. `spineBuiltAt: manifest.finishedAt` for provenance.
  7. All `count(*)`/`count(DISTINCT ...)` results passed through `Number()` before
     `JSON.stringify` (BigInt hazard called out in the task).
  8. No cache-summary line (builder fetches nothing, per addendum §5).

- **`tests/coverage.test.js`** (new) — CommonJS, skips cleanly (prints `skip` line,
  exit 0) when `data/coverage.json` doesn't exist. 13 checks when it does exist,
  covering: 1876 (not 1871) start years, sprint_speed 2015 / bat_tracking 2023,
  every stat has `source`/non-zero `rows`, `first <= last` always, the source-grep
  guard against hardcoding `first: 2015`, `spineBuiltAt` presence,
  `populationVsWidest` bounds for `batted_ball_tracking` and `sprint_speed`,
  and `leagueOnlySeasons.totalEmptyClubYears === 111` / `years["1924"]` non-empty.

## Exact commands and full builder output

```
$ node tools/build-coverage.mjs
season_batting         1876–2025  96313 rows  18946 players
season_pitching        1876–2025  53614 rows  11166 players
strikeouts             1876–2025  95959 rows  18116 players
caught_stealing        1877–2025  80441 rows  14887 players
team_totals            1876–2025  3396 rows  163 players
sprint_speed           2015–2025  6104 rows  1535 players  vsWidest:0.57
home_to_first          2015–2025  6104 rows  1535 players  vsWidest:0.57
batted_ball_tracking   2015–2025  5178 rows  1341 players  vsWidest:0.49
outs_above_average     2016–2025  5483 rows  1472 players  vsWidest:0.54
arm_strength           2020–2025  2241 rows  751 players  vsWidest:0.28
bat_tracking           2023–2025  606 rows  202 players  vsWidest:0.07
```

## Refusal-gate demonstration (both paths, then restored)

**Path 1 — manifest missing:**
```
$ mv data/_build.json data/_build.json.bak
$ node tools/build-coverage.mjs; echo "EXIT=$?"
build-coverage: data/_build.json is missing — run `node tools/build-seasons.mjs` first. Refusing to measure coverage against an unverified spine.
EXIT=1
```

**Path 2 — manifest present but `complete: false`:**
```
$ node -e "... j.complete=false; j.failures=['fake failure for gate test']; write ..."
$ node tools/build-coverage.mjs; echo "EXIT=$?"
build-coverage: data/_build.json reports complete=false (1 failures). Refusing to measure coverage against a partial spine — fix the build first.
EXIT=1
```

**Restore and re-verify clean run:**
```
$ rm data/_build.json && mv data/_build.json.bak data/_build.json
$ node -e "console.log(j.complete, j.failures.length)"
true 0
$ node tools/build-coverage.mjs
<full 11-line listing above, exit 0>
```
Both refusal paths were observed with the correct message and exit code 1; the
original manifest (`complete: true`, 0 failures, `finishedAt:
2026-09-16T02:46:10.002Z`) was restored byte-for-byte before the final build,
confirmed by re-reading it and by the unchanged `spineBuiltAt` in the final
`coverage.json`.

## Test output

```
$ node tests/coverage.test.js
ok    season batting reaches 1876 — 1876
ok    season pitching reaches 1876 — 1876
ok    sprint speed starts 2015 — 2015
ok    bat tracking starts 2023 — 2023
ok    every stat carries a source
ok    every stat carries a non-zero row count
ok    first is never after last
ok    builder does not hardcode 2015
ok    coverage carries spineBuiltAt — 2026-09-16T02:46:10.002Z
ok    batted_ball_tracking.populationVsWidest < 0.8 — 0.49
ok    sprint_speed.populationVsWidest > 0.5 (measured 0.57, not the addendum's predicted >0.8 — see NOTE above) — 0.57
ok    leagueOnlySeasons.totalEmptyClubYears === 111 — 111
ok    leagueOnlySeasons.years["1924"] is non-empty
EXIT=0

$ node tools/run-tests.mjs
...
18/18 test files passed
```

## The one real finding: the addendum's `populationVsWidest` prediction was half right

The addendum's §3 gives one **verified** number (Task 5's own finding): ev/la
(`batted_ball_tracking`, gated at 50 batted balls) covers "roughly half the
players that expected-woba covers" — and measured, `batted_ball_tracking` vs.
`xwoba` is **0.49**, matching exactly.

But `xwoba` has no `PROBES` entry of its own (it isn't a stat intake asks about),
so the natural first implementation computed "widest Statcast column" only among
the 6 *named* coverage stats — which makes `sprint_speed` trivially 1.0 against
itself, and `batted_ball_tracking` comes out to **0.87** against `sprint_speed`,
not ~0.5. That version does not reproduce the addendum's own cited finding.

Querying the full statcast table directly (all 9 non-key columns, not just the 6
with coverage entries) confirmed `xwoba` is the actual widest column at 2,714
distinct players — well ahead of `sprint_speed`/`home_to_first` at 1,535. Per-year
breakdown:

| year | spd (sprint) | xwoba | ev  |
|------|------|-------|-----|
| 2015 | 550  | 964   | 480 |
| 2020 | 461  | 581   | 352 |
| 2022 | 586  | 693   | 497 |
| 2025 | 579  | 673   | 486 |

Sprint speed's per-year population (~550-580) tracks closer to ev/la (~470-500)
than to xwoba (~650-1050) — because sprint speed requires a *tracked competitive
base-running opportunity*, a rarer event than a plate appearance, despite its
numerically looser attempt threshold (min 10 vs. min 50 PA). That means the
addendum's illustrative claim "sprint_speed near 1.0" does not hold once `xwoba`
is correctly included as the reference: measured, `sprint_speed.populationVsWidest
= 0.57`.

**Decision:** I built `populationVsWidest` against the true widest column
(including `xwoba`, even though it has no standalone coverage entry) because that
is the literal, honest reading of "the widest Statcast column in the same
dataset," and because it is the only definition that reproduces the addendum's
own verified 0.5 figure. I then wrote the test's `sprint_speed` assertion against
the real measured value (`> 0.5`, actual 0.57) instead of the addendum's predicted
`> 0.8`, with an inline comment explaining the discrepancy and why. I did not
adjust the "widest" definition to instead make the `> 0.8` guess pass — that would
have required *excluding* `xwoba`, which would break the one number Task 5 had
already verified, and would be exactly the kind of paper-over-a-real-signal move
this task exists to prevent.

I flag this explicitly rather than silently fixing it, per the instruction that a
discrepancy between a controller ruling and measured reality is itself the kind of
thing worth surfacing.

## populationVsWidest values (as requested)

- `batted_ball_tracking.populationVsWidest = 0.49` (addendum predicted ~0.5 — matches)
- `sprint_speed.populationVsWidest = 0.57` (addendum predicted "near 1.0"/`>0.8` — does not match; see finding above)

## Anything else uncertain

- `team_totals` (team-season grain) has no `mlbam` column, so its `players` field
  counts distinct `team` values (163) rather than distinct players. This isn't
  specified anywhere in the brief or addendum since neither document anticipated a
  team-grain stat needing a population field; I judged "distinct entity at that
  stat's grain" to be the intended generalization of "distinct mlbam" and did not
  see a better option that avoids a runtime SQL error.
- `leagueOnlySeasons.years` has 41 keys (years with at least one empty club),
  summing to 111 empty club-years total — matches the manifest and the addendum's
  cited figure exactly.

---

## Fix round 1/5

Commit: `e5cd77e4002f62b071a3f796aa0acb460ddd9774` on branch `data-spine`.
Files touched (both already tracked): `tools/build-coverage.mjs`, `tests/coverage.test.js`.

### Finding 1 — "widest" column set is now schema-derived, not hand-maintained

Schema introspection method used: `DESCRIBE SELECT * FROM read_parquet('<statcast glob>')`,
which returns one row per column with a `column_name` field (confirmed directly — see
below). The candidate set is every column name from that result except the identity
columns `year`, `mlbam`, `name`. That set is then turned into one query with a
`count(DISTINCT mlbam) FILTER (WHERE <col> IS NOT NULL) AS <col>` expression per
candidate column, and `widest = max()` over all of them.

Full derived candidate column set (verified by running `DESCRIBE` against
`data/statcast/*.parquet`):

```
spd, hp1, xwoba, ev, la, oaa, arm, bat_speed, swing_len
```

`hp1` (home_to_first's own probed column) is now included, along with `la` and
`swing_len`, which the old hand-maintained list also omitted (harmlessly, since
neither is currently wider than xwoba — but that was luck, not a guarantee, same
as `hp1`).

`populationVsWidest` values after the fix, unchanged from before:
- `batted_ball_tracking.populationVsWidest = 0.49`
- `sprint_speed.populationVsWidest = 0.57`

Confirmed by re-running the builder — full listing below.

### Finding 2 — team_totals is now grain-aware (`teams`, not `players`)

`team_totals` (`grain: 'team-season'`) now emits `teams` and `teamYearsPerSeason`
instead of `players`/`playerYearsPerSeason`, and the `players` key is absent from
that entry entirely (not `null` — `undefined`, i.e. the key doesn't exist).
Every `player-season` stat is unchanged (`players`/`playerYearsPerSeason`, no
`teams` key). Implemented by branching on `p.grain === 'team-season'` when
building each stat's object, rather than adding a generic
`population`/`entityKind` pair that would change the shape of all eleven stats.

### Commands and output

```
$ node tools/build-coverage.mjs
season_batting         1876–2025  96313 rows  18946 players
season_pitching        1876–2025  53614 rows  11166 players
strikeouts             1876–2025  95959 rows  18116 players
caught_stealing        1877–2025  80441 rows  14887 players
team_totals            1876–2025  3396 rows  163 teams
sprint_speed           2015–2025  6104 rows  1535 players  vsWidest:0.57
home_to_first          2015–2025  6104 rows  1535 players  vsWidest:0.57
batted_ball_tracking   2015–2025  5178 rows  1341 players  vsWidest:0.49
outs_above_average     2016–2025  5483 rows  1472 players  vsWidest:0.54
arm_strength           2020–2025  2241 rows  751 players  vsWidest:0.28
bat_tracking           2023–2025  606 rows  202 players  vsWidest:0.07
```

The eleven-line listing is otherwise identical to the pre-fix run except
`team_totals` now says "teams" instead of "players", and both
`populationVsWidest` figures are byte-identical to before.

```
$ node tests/coverage.test.js
<13 checks, all ok, including new:>
ok    team_totals.teams === 163 — 163
ok    team_totals.players is undefined
EXIT=0

$ node tools/run-tests.mjs
...
18/18 test files passed
```

### Concerns

None outstanding. Both findings were narrow, mechanical fixes with no further
ambiguity — the schema-derived column list and the grain-aware key naming are
both direct, literal implementations of the ruling as given.

---

## Fix round 2/5

Commit: `13357701441a68d4f683d5806c08efd8d08465ec` on branch `data-spine`.
Files touched (both already tracked): `tools/build-coverage.mjs`, `tests/coverage.test.js`.

### Finding — corrected the five false `source` strings

`season_batting`, `season_pitching`, `strikeouts`, `caught_stealing`, and
`team_totals` all declared `source: 'Chadwick baseballdatabank'` — a dead,
404ing mirror per `tools/build-seasons.mjs`'s own header comment. Changed all
five to `'MLB Stats API (statsapi.mlb.com)'`. The six Savant-sourced Statcast
stats were left untouched (verified correct by the coordinator).

### Provenance guard added to `tests/coverage.test.js`

A small inline map (`SOURCE_URLS`) ties each known `source` string to
`{ builder, needle }`; for every distinct `source` value actually present in
`coverage.json`, the test reads that builder file and asserts the needle is a
substring of it. An unrecognized `source` string fails with
`source "<value>" is known to the provenance guard`. No mapping framework —
just the two entries this project currently needs.

### Commands and output

Rebuild — confirmed nothing but the five source strings changed (first/last/
rows/players/teams/vsWidest all identical to fix-round-1 output):

```
$ node tools/build-coverage.mjs
season_batting         1876–2025  96313 rows  18946 players
season_pitching        1876–2025  53614 rows  11166 players
strikeouts             1876–2025  95959 rows  18116 players
caught_stealing        1877–2025  80441 rows  14887 players
team_totals            1876–2025  3396 rows  163 teams
sprint_speed           2015–2025  6104 rows  1535 players  vsWidest:0.57
home_to_first          2015–2025  6104 rows  1535 players  vsWidest:0.57
batted_ball_tracking   2015–2025  5178 rows  1341 players  vsWidest:0.49
outs_above_average     2016–2025  5483 rows  1472 players  vsWidest:0.54
arm_strength           2020–2025  2241 rows  751 players  vsWidest:0.28
bat_tracking           2023–2025  606 rows  202 players  vsWidest:0.07
```

Verified the actual JSON source strings directly:
```
season_batting -> MLB Stats API (statsapi.mlb.com)
season_pitching -> MLB Stats API (statsapi.mlb.com)
strikeouts -> MLB Stats API (statsapi.mlb.com)
caught_stealing -> MLB Stats API (statsapi.mlb.com)
team_totals -> MLB Stats API (statsapi.mlb.com)
sprint_speed -> Baseball Savant
home_to_first -> Baseball Savant
batted_ball_tracking -> Baseball Savant
outs_above_average -> Baseball Savant
arm_strength -> Baseball Savant
bat_tracking -> Baseball Savant
```

**Guard failure demonstration** — copied `data/coverage.json` aside, edited
`season_batting.source` back to `"Chadwick baseballdatabank"` in the copy in
place, and ran the test:

```
$ node tests/coverage.test.js
... (14 unrelated checks ok) ...
FAIL  source "Chadwick baseballdatabank" is known to the provenance guard
ok    source "MLB Stats API (statsapi.mlb.com)" traces to statsapi.mlb.com in build-seasons.mjs
ok    source "Baseball Savant" traces to baseballsavant.mlb.com in build-statcast.mjs
EXIT=1
```

**Restored and re-verified clean:**
```
$ node tests/coverage.test.js
<17 checks, all ok>
EXIT=0

$ node tools/run-tests.mjs
...
18/18 test files passed
```

### Concerns

None. Straightforward correction plus a narrowly-scoped guard, as directed.

---

## Fix round 3/5

Commit: `241751e8a7df8bb924196d9febb484c2a3782709` on branch `data-spine`.
Files touched (both already tracked): `tools/build-coverage.mjs`, `tests/coverage.test.js`.

### Residual A — source is now derived from `dataset`, not declared

Each probe in `PROBES` now carries `dataset: 'seasons' | 'league' | 'statcast'`
instead of `src`/`source`. `DATASET_SOURCE` maps each dataset to `{ label,
builder, needle }`; `src` and `source` are both resolved from `p.dataset` at
query time, so a probe cannot state an origin different from the file it
queries — it no longer has a field to lie in. `coverage.json` now also carries
`dataset` on every stat entry (a new, harmless field) so the test can check a
real correspondence per stat rather than re-deriving or hardcoding a
key→dataset mirror map. The test now:
1. For each distinct `dataset` actually used, reads the mapped builder file
   (wrapped in try/catch — a missing/renamed builder produces a labelled
   `check(...)` failure naming the file and the ENOENT message, not a stack
   trace) and asserts the mapped needle is a substring of it.
2. For every stat, asserts `stat.source === DATASET_SOURCE[stat.dataset].label`
   — this is the check that closes the hole: a probe reading `seasons` but
   labelled `'Baseball Savant'` now fails on stat 2, not just passing stat 1
   because `build-statcast.mjs` happens to contain its own needle somewhere.

### Residual B — candidate columns filtered by DuckDB type, not name

`IDENTITY_COLS` shrank to `{year, mlbam}` (VARCHAR `name` is now excluded by
type, not by name). Added `NUMERIC_TYPE` regex matching DOUBLE/FLOAT/DECIMAL
and the INTEGER family; `DESCRIBE`'s `column_type` is filtered against it
before the identity exclusion. A future VARCHAR (`team`, `pos`) or DATE
(`game_date`) column cannot enter the candidate set regardless of its name.
The resolved list now prints as the builder's first line of output.

### Commands and output

```
$ node tools/build-coverage.mjs
populationVsWidest candidate columns: spd, hp1, xwoba, ev, la, oaa, arm, bat_speed, swing_len
season_batting         1876–2025  96313 rows  18946 players
season_pitching        1876–2025  53614 rows  11166 players
strikeouts             1876–2025  95959 rows  18116 players
caught_stealing        1877–2025  80441 rows  14887 players
team_totals            1876–2025  3396 rows  163 teams
sprint_speed           2015–2025  6104 rows  1535 players  vsWidest:0.57
home_to_first          2015–2025  6104 rows  1535 players  vsWidest:0.57
batted_ball_tracking   2015–2025  5178 rows  1341 players  vsWidest:0.49
outs_above_average     2016–2025  5483 rows  1472 players  vsWidest:0.54
arm_strength           2020–2025  2241 rows  751 players  vsWidest:0.28
bat_tracking           2023–2025  606 rows  202 players  vsWidest:0.07
```
Candidate list and every first/last/rows/players/teams/vsWidest value
identical to fix round 2's output.

**Wrong-dataset failure demonstration** — copied `data/coverage.json` aside,
set `stats.season_batting.dataset = 'statcast'` in the copy in place, ran the test:
```
FAIL  season_batting.source matches its own dataset (statcast) — got "MLB Stats API (statsapi.mlb.com)", expected "Baseball Savant"
EXIT=1
```
(All other checks, including the dataset→builder correspondence checks
themselves, still passed — only the one mismatched stat failed, by name.)

**Missing-builder failure demonstration** — renamed `tools/build-statcast.mjs`
aside and ran the test:
```
FAIL  dataset "statcast"'s builder build-statcast.mjs is readable — ENOENT: no such file or directory, open 'C:\Users\nik\Documents\AI\more-bases-ball\tools\build-statcast.mjs'
EXIT=1
```
A labelled check failure naming the file, not an unhandled exception/stack trace.

Both edits restored (coverage.json from the backup copy, build-statcast.mjs
renamed back), then re-verified clean:
```
$ node tests/coverage.test.js
<26 checks, all ok>
EXIT=0

$ node tools/run-tests.mjs
...
19/19 test files passed
```
Note: 19/19, not 18/18 — the user's own untracked `tests/batters.test.js` and
`tests/multiplate.test.js` (present since before this task began, per the
initial git status) are now picked up by the runner. Unrelated to this task's
changes; `coverage.test.js` and the other 17 pre-existing suites are green.

### Concerns

None. Both residuals were structural fixes (derive instead of declare, filter
by type instead of name) with no remaining ambiguity, and both failure
demonstrations behaved exactly as specified.
