# Task 5 report — Statcast tracking leaderboards, 2015+

## Files changed

- **Created** `tools/build-statcast.mjs` — builder. Implements the addendum's six-board
  `BOARDS` table verbatim (speed, xstats, statcast, oaa, arm, bat), the addendum's
  `nameOf()` three-shape name resolver, and `+r[b.id]` per-board id lookup (not a
  `??` fallback chain). One deviation from the brief's literal code sample: the brief's
  `JSON.stringify(p.name)` produces a double-quoted JS string, which DuckDB parses as
  an *identifier*, not a string literal — it threw `Binder Error: Referenced column
  "Byron Buxton" was not found`. Replaced with a small `sqlStr()` helper that emits a
  single-quoted SQL literal with `'` doubled for escaping. This is a bugfix to the
  brief's illustrative code, not a deviation from the addendum's ruling (the addendum
  didn't touch this line).
  Also added an `unnamed` counter per year, printed in the per-year log line, per the
  addendum's "count those rows and print the count" instruction — observed 0 every
  year (see below).
- **Created** `tests/statcast-data.test.js` — the brief's test plus the addendum's
  required addition: `first('ev') === 2015` for the exit-velo/launch-angle board the
  brief omitted. 7 checks total (brief's 6 minus the implicit combining, plus the new one).

Nothing under `data/` was committed (gitignored, verified via `git status --short`
before commit). No pre-existing user changes (README.md, data.js, editor.js, field3d.js,
fielders.js, graphsim.js, index.html, layout.js, style.css, tests/anim.test.js,
trisim.js, ui.js) or other untracked files (onlyprompts.json, tests/batters.test.js,
tests/multiplate.test.js) were staged or touched.

## Commands and output

### 1. Pre-check: test skips cleanly with no data

```
$ node tests/statcast-data.test.js
skip  data/statcast not built — run `node tools/build-statcast.mjs`
$ echo $?
0
```

### 2. First builder run — failed, fixed a real bug

First run threw immediately:
```
[Error: Binder Error: Referenced column "Byron Buxton" was not found because the FROM clause is missing
LINE 2: (2015, 621439, "Byron Buxton", 30.9, 0, 0.204, 86.4, 12.5, NULL, NULL,...
```
Cause: `JSON.stringify()` double-quotes strings; DuckDB requires single quotes for
string literals in a `VALUES` list, so it read `"Byron Buxton"` as a column reference.
Fixed with a proper SQL-string escaper (see above). This is unrelated to the
addendum's board/name corrections — it's a bug in the brief's own illustrative
`COPY` construction that only manifests once real names are being written (which
the brief's broken name extraction would never have hit, since it always produced `""`).

### 3. Builder run (final, full range 2015–2025)

```
$ node tools/build-statcast.mjs
2015  players 964  speed:550  xstats:964  statcast:480  unnamed:0
2016  players 969  speed:551  xstats:969  statcast:471  oaa:544  unnamed:0
2017  players 957  speed:548  xstats:957  statcast:466  oaa:534  unnamed:0
2018  players 990  speed:550  xstats:990  statcast:480  oaa:537  unnamed:0
2019  players 990  speed:570  xstats:990  statcast:478  oaa:548  unnamed:0
2020  players 583  speed:461  xstats:581  statcast:352  oaa:487  arm:241  unnamed:0
2021  players 1049  speed:560  xstats:1049  statcast:487  oaa:568  arm:404  unnamed:0
2022  players 693  speed:586  xstats:693  statcast:497  oaa:587  arm:414  unnamed:0
2023  players 709  speed:583  xstats:656  statcast:496  oaa:558  arm:399  bat:202  unnamed:0
2024  players 687  speed:566  xstats:651  statcast:485  oaa:552  arm:388  bat:202  unnamed:0
2025  players 686  speed:579  xstats:673  statcast:486  oaa:568  arm:395  bat:202  unnamed:0
cache  8 hits  44 fetched
```

No board ever hit the schema-drift guard (no "schema drifted" error at any year 2015–2025).

### 4. Test run (final)

```
$ node tests/statcast-data.test.js
ok    sprint speed starts 2015
ok    exit velo / launch angle starts 2015
ok    outs above average starts 2016
ok    arm strength starts 2020
ok    bat tracking starts 2023
ok    nothing claims tracking before 2015 — n=0
ok    every row has an mlbam id — n=0
$ echo $?
0
```

### 5. Full suite

```
$ node tools/run-tests.mjs
...
17/17 test files passed
```

## Per-board first year actually observed (read back from the written parquet)

- `spd` (sprint speed): 2015 — matches addendum
- `ev`/`la` (statcast exit velo/launch angle): 2015 — matches addendum (new board)
- `oaa` (outs above average): 2016 — matches addendum
- `arm` (arm strength): 2020 — matches addendum
- `bat_speed`/`swing_len` (bat tracking): 2023 — matches addendum

All five era boundaries land exactly where the addendum said they would.

## Rows lacking a resolvable name

**0** across every year, 2015–2025 (`unnamed:0` on every line above). `nameOf()`'s
three-shape handling (`last_name, first_name` combined column, `fielder_name`, `name`)
covered every row in every board across the full range.

## Concern: one board's row count is far below the addendum's own measurement

The addendum's pre-flight measurement states `statcast 2015 -> 1543 rows`. My build,
using the addendum's URL verbatim (`type=batter&year=2015&position=&team=&min=50&csv=true`),
observed **480** rows for that board in 2015 — roughly a third of the stated figure.
Per the outer task's explicit instruction ("if a board returns wildly fewer rows than
this for its first year, something is wrong — say so rather than proceeding quietly"),
I'm flagging this rather than silently proceeding.

What I checked before flagging (all against the live endpoint, no code changes):
- `min=50,type=batter` (addendum's exact URL): 480 rows
- `min=0,type=batter`: 964
- `min=1,type=batter`: 915
- `min=10,type=batter`: 673
- `min=50,type=pitcher`: 545; `min=0,type=pitcher`: 735; `min=1,type=pitcher`: 734
- omitting `min` entirely (site default, "qualified"): 250
- omitting `type` entirely: same as `type=batter` (480 at min=50, 250 with no min)
- combining batter+pitcher counts under several min values: none summed to 1543

I could not reproduce 1543 under any parameter combination I tried, and per the
task's own hazard guidance ("do not guess a replacement column name" when something
doesn't match what was probed) I did not guess a replacement URL parameter — the
addendum's URL and column names are otherwise fully verified correct (schema guard
never fired, and four of the other five boards' row counts either matched the
addendum's measurement exactly — sprint_speed 550, expected_statistics 964,
outs_above_average 544 — or were within 1 of it — arm-strength 241 vs 242,
bat-tracking 202 vs 203). Only the `statcast` board's count is substantially off.
This does not block the task (schema and every test-asserted era boundary check out),
but the discrepancy is real and worth the controller's attention — possibly the
1543 figure was measured with a parameter I haven't tried, or a different endpoint
variant, or was a transcription/measurement error on a differently-filtered pull.

## Anything else uncertain

- The `unnamed` counter and its log-line placement were my own design choice within
  the addendum's instruction ("count those rows and print the count in the per-year
  log line") — the addendum didn't specify exact formatting, so I appended `unnamed:N`
  after the existing board-count segments.
- Left `data/statcast/` in place (gitignored) after the run rather than deleting it,
  matching how `data/players.parquet`, `data/seasons/`, `data/league/` from prior
  tasks are already present in the working tree.

---

## Fix round 1/5 — year-completeness check

Coordinator ruling: the test only asserted each board's *first* year, so a build
that died after 2023 would pass every check while silently missing 2024-2025.
Fix: assert every year FIRST..LAST has a `data/statcast/{year}.parquet` file with
at least one row, naming the first few missing years on failure, consistent with
`tests/seasons-data.test.js`'s equivalent guard.

### Files changed

- `tests/statcast-data.test.js` — added the year-completeness check, importing
  `FIRST`/`LAST` from `tools/build-statcast.mjs` rather than hardcoding 2025 a
  second time.
- `tools/build-statcast.mjs` — exported `FIRST`/`LAST` as top-level consts, and
  wrapped the builder body (mkdir, db open, per-year loop, cache summary, db
  close) in `async function main()` gated by an `isMain` check — the same
  pattern already used in `tools/build-seasons.mjs` — so that importing the
  module for its two constants does not also trigger the full network build.
  `min=50`, the board table, the escaper, and the `VALUES` construction are
  byte-identical to the previously-approved version; only the entry-point
  wrapping and the two `export const` changed.

### Verify: new check passes at 11 years

```
$ node tests/statcast-data.test.js
ok    sprint speed starts 2015
ok    exit velo / launch angle starts 2015
ok    outs above average starts 2016
ok    arm strength starts 2020
ok    bat tracking starts 2023
ok    nothing claims tracking before 2015 — n=0
ok    every row has an mlbam id — n=0
ok    every year 2015-2025 has a statcast file with rows — present=11/11
$ echo $?
0
```

### Verify: check actually fails when a year is removed

```
$ mv data/statcast/2024.parquet data/statcast/2024.parquet.bak
$ node tests/statcast-data.test.js
ok    sprint speed starts 2015
ok    exit velo / launch angle starts 2015
ok    outs above average starts 2016
ok    arm strength starts 2020
ok    bat tracking starts 2023
ok    nothing claims tracking before 2015 — n=0
ok    every row has an mlbam id — n=0
FAIL  every year 2015-2025 has a statcast file with rows — present=10/11 missing first: 2024
$ echo $?
1
```

Restored immediately after:

```
$ mv data/statcast/2024.parquet.bak data/statcast/2024.parquet
$ node tests/statcast-data.test.js
...
ok    every year 2015-2025 has a statcast file with rows — present=11/11
$ echo $?
0
```

### Full suite

```
$ node tools/run-tests.mjs
...
17/17 test files passed
```

### Commit

`348405c` — `tests/statcast-data.test.js` and `tools/build-statcast.mjs` only
(the latter touched solely to export `FIRST`/`LAST` and gate execution behind
`isMain`; no board/URL/escaper/VALUES logic changed).

### Concerns

None. The controller's 1543-row transcription-error explanation for the earlier
concern is accepted; no further action needed there.
