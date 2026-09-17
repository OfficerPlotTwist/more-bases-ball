# Task 7 report — the spine query layer

Commit: `60314bc24232aaa30692682b07faed116bb1aa50`

## Files changed

- `C:\Users\nik\Documents\AI\more-bases-ball\tools\lib\spine.mjs` (new) — the module.
- `C:\Users\nik\Documents\AI\more-bases-ball\tests\spine-query.test.js` (new) — the test.

No other files were touched. The working tree's pre-existing uncommitted
changes (README.md, data.js, editor.js, field3d.js, fielders.js, graphsim.js,
index.html, layout.js, style.css, tests/anim.test.js, trisim.js, ui.js, plus
tests/coverage.test.js and tools/build-coverage.mjs, which I did not expect
from the initial snapshot but also did not modify) were left alone and were
not staged or committed.

## What the module does, vs. the brief

Implemented the brief's design with all five addendum rulings applied:

1. **Team codes** — used `'LAD'` in the test, not `'LAN'`. Verified against
   `data/league/2024.parquet` directly (see below).
2. **`teamLineup` joins `seasons.mlbam = statcast.mlbam` directly** — no
   `players.parquet` crosswalk hop, since `bbref` is NULL on seasons rows.
   `players.parquet` is imported nowhere in this module. Added `pos` to the
   returned columns, per the addendum's reading of `data.js`'s `P()` shape.
3. **`sigma()`** — implemented exactly as specified, reading
   `data/league/*.parquet`.
4. **`openSpine()` refusal** — implemented the `_build.json` gate with
   `allowIncomplete` as the only escape hatch, plus a `buildInfo()` accessor
   returning the parsed manifest (addendum's suggested addition).
5. **`requireCoverage` stays pure** — unchanged logic, no fs/db access. Added
   the second pure helper, `leagueOnlyClubs(cov, year)`, reading only the
   object passed in.

### Beyond the addendum: BigInt/Decimal normalisation

DuckDB returns `BIGINT` for integer columns as JS `BigInt`, and it turns out
`spd`/`hp1` (DECIMAL columns from Statcast) come back as `DuckDBDecimalValue`
objects, not plain numbers — neither survives `JSON.stringify` or arithmetic
cleanly. I added a `normaliseRow`/`normaliseRows` helper applied at the
boundary in `seasonLines` and `teamLineup`, converting `BigInt` via `Number()`
and any object with a `.toDouble()` method (the DuckDB decimal value class)
via that method. Chose to normalise inside the module rather than push this
onto every caller, since the whole point of the spine is that callers (sim.js,
diagnostics, intake) never need to know DuckDB's wire types.

## Verification: 2024 LAD lineup

```
$ node -e "import('./tools/lib/spine.mjs').then(async spine => {
  const s = await spine.openSpine();
  const lad = await s.teamLineup({ year: 2024, team: 'LAD' });
  console.log(lad[0]);
  await s.close();
});"
{
  name: 'Shohei Ohtani', pos: 'TWP', team: 'LAD', pa: 731, h: 197,
  d2: 38, d3: 7, hr: 54, bb: 87, so: 162, spd: 28.1, hp1: 4.17
}
```

Full 9-row lineup (via the test), highest PA first:
1. Shohei Ohtani — 731 PA
2. Teoscar Hernández — 652 PA
3. Freddie Freeman — 638 PA
4. Will Smith — 544 PA
5. Mookie Betts — 516 PA
6. Gavin Lux — 487 PA
7. Andy Pages — 443 PA
8. Enrique Hernández — 393 PA
9. Miguel Rojas — 337 PA

`c.spd`/`c.hp1` populated for 9/9 (all nine matched on `mlbam` in Statcast
2024). `team = 'LAN'` (the brief's original value) returns 0 rows against this
data, confirmed against `data/league/2024.parquet`'s team list, which uses
`LAD` not `LAN`.

## `sigma('runs_per_game', 2000, 2024)`

```
sigma = 0.2007447054955552
```

Matches the addendum's verified value of 0.2007 to four decimal places.

## Refusal demonstrations

All three paths exercised in `tests/spine-query.test.js` against a fresh temp
directory (never touching the real `data/`), output from the test run:

```
ok    refusal names the missing manifest — openSpine: data/_build.json is missing — run `node tools/build-seasons.mjs` first. Refusing to serve an unverified spine.
ok    openSpine throws when data/_build.json is missing
ok    allowIncomplete escape hatch opens despite missing manifest
ok    refusal names complete=false — openSpine: spine build reports complete=false (1 failures). Refusing to serve partial data.
ok    openSpine throws when spine build reports complete=false
```

Concretely:
- `openSpine(emptyTmpDir)` — no `_build.json` present — threw
  `openSpine: data/_build.json is missing — run \`node tools/build-seasons.mjs\` first. Refusing to serve an unverified spine.`
- `openSpine(emptyTmpDir, { allowIncomplete: true })` — same directory, same
  missing manifest — did NOT throw; returned a working `Spine` (closed
  immediately after).
- `openSpine(tmpDirWithSyntheticManifest)` where the manifest was
  `{ complete: false, failures: ['1994'] }` — threw
  `openSpine: spine build reports complete=false (1 failures). Refusing to serve partial data.`

Both temp directories were created under the OS temp dir and removed in a
`finally` block; the real `data/_build.json` (`complete: true`) was never
touched or altered.

## Full test output

```
$ node tests/spine-query.test.js
ok    guard allows a supported year — {"ok":true,"missing":[]}
ok    guard rejects tracking in 1927 — {"ok":false,"missing":[{"stat":"sprint_speed","first":2015,"last":2025}]}
ok    guard names the offending stat — [{"stat":"sprint_speed","first":2015,"last":2025}]
ok    guard reports the real first year — {"stat":"sprint_speed","first":2015,"last":2025}
ok    guard rejects an unknown stat — {"ok":false,"missing":[{"stat":"pitch_spin","first":null,"last":null}]}
ok    leagueOnlyClubs names the 1924 clubs — ["BRG","CSE","DAY","HIL"]
ok    leagueOnlyClubs returns empty array for a year with no gaps — []
ok    refusal names the missing manifest — openSpine: data/_build.json is missing — run `node tools/build-seasons.mjs` first. Refusing to serve an unverified spine.
ok    openSpine throws when data/_build.json is missing
ok    allowIncomplete escape hatch opens despite missing manifest
ok    refusal names complete=false — openSpine: spine build reports complete=false (1 failures). Refusing to serve partial data.
ok    openSpine throws when spine build reports complete=false
ok    coverage loads — season_batting,season_pitching,strikeouts,caught_stealing,team_totals,sprint_speed,home_to_first,batted_ball_tracking,outs_above_average,arm_strength,bat_tracking
ok    buildInfo reports complete — true
ok    2024 qualified batters is a plausible count — n=118
ok    seasonLines numerics are plain numbers, not BigInt — number
ok    2024 has pitchers — n=972
ok    lineup returns nine batters — n=9
ok    lineup carries statcast speed — with spd=9
ok    lineup has the fields sim.js needs — {"name":"Shohei Ohtani","pos":"TWP","team":"LAD","pa":731,"h":197,"d2":38,"d3":7,"hr":54,"bb":87,"so":162,"spd":28.1,"hp1":4.17}
ok    season-to-season sigma is a small positive number — sigma=0.2007447054955552
```

Exit code 0, all 21 checks passed (12 pure/refusal checks that run always +
9 data-dependent checks, since `data/coverage.json` was present).

Full suite:

```
$ node tools/run-tests.mjs
...
19/19 test files passed
```

All pre-existing 18 test files stayed green; `spine-query.test.js` is the
19th and passed.

## Things I was unsure about

- **BigInt/Decimal normalisation scope.** The brief and addendum didn't
  explicitly ask for Statcast DECIMAL handling — only "BIGINT... this has
  bitten three times" was flagged. I discovered `spd`/`hp1` come back as
  `DuckDBDecimalValue` objects (not `BigInt`) empirically when the lineup
  test's `JSON.stringify` check threw. I normalised both cases in one helper
  rather than special-casing decimals, since the failure mode (unserializable
  wire type reaching a caller) is the same hazard the addendum called out.
- **`normaliseRows` applied to both `seasonLines` and `teamLineup`.** The
  task prompt explicitly asked me to "decide whether to normalise numerics
  there and say what you chose" — I normalise in both, at the boundary, since
  both hand rows straight to external callers per the brief's own doc comment.
- **`coverage()` and `buildInfo()` are not normalised** — they return parsed
  JSON directly (already plain JS numbers from `JSON.parse`), so no BigInt
  hazard exists there.
- Left `tests/coverage.test.js` and `tools/build-coverage.mjs` untouched even
  though `git status` showed them as modified going into this task (not
  mentioned in the task's context as expected-dirty) — assumed they're
  someone else's in-progress work per the "DO NOT modify" instruction's spirit,
  and they were not in my file scope regardless.

## Fix round 1 — SQL injection (Finding 1, Critical) and two Important findings

Commit: `4006f20645c82cc80cb1d09b570ab6ae2fefdc29`

### Finding 1 — SQL injection in teamLineup/seasonLines/sigma

Confirmed the coordinator's two payloads worked pre-fix (reproduced them
against the built spine before patching):

- `teamLineup({ year: '2024 OR 1=1', team: 'LAD' })` — returned 9 rows from
  across all seasons (year filter defeated, unquoted numeric interpolation).
- `teamLineup({ year: 2024, team: "LAD' OR '1'='1" })` — returned 9 rows from
  another club (team filter defeated, unescaped single-quote break-out).

**Fix — guard clauses at the top of each public method, per the ruling** (no
query builder): `checkYear`, `checkTeam`, `checkRole`, `checkCount` helpers in
`tools/lib/spine.mjs`, all throwing rather than sanitising:

- `year` (and `sigma`'s `from`/`to`): `Number.isInteger(year)` or throw.
- `team`: allowlisted against `/^[A-Z]{2,4}(-[A-Z])?$/`.
- `role`: must be exactly `'bat'` or `'pit'`.
- `minPA`, `limit`, `size`: `Number()`-coerced, rejected if non-finite or
  negative.

**Team-code pattern verification.** Pulled every distinct `team` value across
all 150 `data/league/*.parquet` files (163 distinct codes total, spanning
1876-2025 — modern clubs, defunct 19th-century clubs, the 1914-15 Federal
League, and Negro Leagues clubs). Tested the addendum's suggested pattern
`^[A-Z]{2,4}(-[A-Z])?$` against the full list: **0 failures, all 163 codes
match.** Examples covered: 2-letter (`LA`, `SF`, `KC`), 3-letter modern
(`LAD`, `NYY`, `BOS`), 3-letter with a league suffix (`BAL-F`, `CHI-F`,
`STL-A`, `ALT-U`, `RIC-C`), and Negro Leagues codes (`ABC`, `CSE`, `HIL`). No
widening was needed.

**`close()` / Finding 3 investigation.** Checked whether `closeSync` exists on
the pinned `@duckdb/node-api@1.5.5-r.5` connection object directly:

```
$ node -e "import('@duckdb/node-api').then(async ({ DuckDBInstance }) => {
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  console.log('closeSync exists:', typeof conn.closeSync);
  conn.closeSync();
  console.log('closed ok');
});"
closeSync exists: function
closed ok
```

`closeSync` exists and works on the pinned driver, so `duck.mjs`'s
`conn.closeSync?.()` is not a silent no-op today. Per the ruling, left
`duck.mjs` untouched (out of this task's scope) and am reporting this rather
than changing it unilaterally.

**Regression tests added** to `tests/spine-query.test.js`, using the two exact
payloads:

- `teamLineup({ year: '2024 OR 1=1', team: 'LAD' })` now throws.
- `teamLineup({ year: 2024, team: "LAD' OR '1'='1" })` now throws.
- A valid `teamLineup({ year: 2024, team: 'LAD' })` call still returns the
  unchanged 9-row lineup with Ohtani first.
- Additional coverage for the same guard shape on `seasonLines` (bad `year`,
  bad `role`) and `sigma` (bad `from`).

### Finding 2 — malformed manifest threw the wrong error

`m.failures.length` was read unconditionally when `complete !== true`.
Changed to `(m.failures || []).length` so a `{ complete: false }` manifest
with no `failures` key still raises the intended refusal message instead of
a raw `TypeError`.

### Not fixing (per ruling)

Left the two parked Minors untouched: the `seasonLines` BigInt check being
vacuous on an empty result set, and `buildInfo reports complete` being true
by construction.

### Re-verification after the fix

Direct re-run of both exploit payloads:

```
year payload threw: spine: year must be an integer
team payload threw: spine: team must match /^[A-Z]{2,4}(-[A-Z])?$/ (got "LAD' OR '1'='1")
```

`node tests/spine-query.test.js` — 26/26 checks pass (21 from round 1 +
5 new injection/guard regression checks).
`node tools/run-tests.mjs` — 19/19 test files passed.

Files touched this round: `tools/lib/spine.mjs`, `tests/spine-query.test.js`
(same two files as before — no other files staged or modified).

## Fix round 2 — prototype-pollution gap in sigma, untested manifest edge case

Commit: `687c6510839f2c7d69b110645bd317bfb4ef13e1`

### Finding 4 — prototype keys bypassed sigma's unknown-stat guard

`EXPR` in `sigma()` is a plain object literal, so `if (!EXPR[stat])` silently
resolves any key inherited from `Object.prototype` (`toString`,
`constructor`, `__proto__`, `hasOwnProperty`, `valueOf`) to a function value,
which is truthy, so the guard never fires. Confirmed pre-fix by calling all
five plus a genuine unknown stat directly against the built spine:

```
sigma('toString')       -> Parser Error ... SELECT year, function toString() { [nat
sigma('constructor')    -> Parser Error ... SELECT year, function Object() {
sigma('__proto__')      -> Parser Error ... SELECT year, [object Object] AS v
sigma('hasOwnProperty') -> Parser Error ... SELECT year, function hasOwnProperty()
sigma('valueOf')        -> Parser Error ... SELECT year, function valueOf() { [nati
sigma('nope')           -> sigma: unknown stat nope
```

**Fix — used `Object.hasOwn(EXPR, stat)`** as the ruling suggested (available
on Node 22, reads clearly as "is this stat's own key", no need to touch
`EXPR`'s construction). Did not switch to `Object.create(null)` since
`Object.hasOwn` is the smaller, more localized change and needed no other
edits to the lookup table.

**Regression test** added: loops over the exact five keys named in the
finding plus `'nope'` as the ordinary-unknown-stat control, asserting the
error message is exactly `sigma: unknown stat <key>` for each — not just
"something threw".

Re-verified directly against the built spine after the fix:

```
toString -> sigma: unknown stat toString
constructor -> sigma: unknown stat constructor
__proto__ -> sigma: unknown stat __proto__
hasOwnProperty -> sigma: unknown stat hasOwnProperty
valueOf -> sigma: unknown stat valueOf
sigma runs_per_game 2000-2024 = 0.2007447054955552
lad rows: 9 first: Shohei Ohtani
```

Confirms `sigma('runs_per_game', 2000, 2024)` and the LAD lineup are
unaffected by the fix.

### Finding 5 — Finding 2's fix had no test for the scenario it fixed

The existing manifest test used `{ complete: false, failures: ['1994'] }` —
`failures` present, so it never exercised the `(m.failures || [])` fallback.
Added a new case: a temp-directory manifest of literally `{ "complete": false
}` (no `failures` key at all), asserting `openSpine()` throws an `Error` that
is specifically **not** a `TypeError` (`caught instanceof Error &&
!(caught instanceof TypeError)`), and that the message matches
`/complete=false/` — i.e. the intended refusal text, not a raw property-access
crash.

### While there — tightened injection regression tests to assert on message text

Per the coordinator's note, all of round 1's injection/guard regression tests
(`teamLineup` year/team, `seasonLines` year/role, `sigma` from-year) were
changed from `catch (e) { threw = true }` to capturing `e` and asserting
`e.message` matches the specific guard's wording (`/year must be an
integer/`, `/team must match/`, `/role must be/`). This caught one bug in my
own test while making the change: the `sigma` from-year test asserted
`/year must be an integer/`, but `checkYear(from, 'from')` throws `"spine:
from must be an integer"` — labelled per-argument, as intended — so the
regex needed to be `/from must be an integer/`. Fixed before committing.

### Not touched (per instruction)

Left the guards themselves (`checkYear`/`checkTeam`/`checkRole`/`checkCount`),
`normaliseRow`, the team-code regex, and `duck.mjs` untouched — all reviewed
and accepted in this round.

### Tests

`node tests/spine-query.test.js` — 33/33 checks pass (26 from round 1 fixes +
7 new: the no-failures-key manifest case ×2 assertions, 5 prototype-key
checks + 1 ordinary-unknown-stat check, counted individually).
`node tools/run-tests.mjs` — 19/19 test files passed.

Files touched this round: `tools/lib/spine.mjs`, `tests/spine-query.test.js`
(same two files — no other files staged or modified).
