# Task 7 — ADDENDUM (controller rulings, carried from Tasks 3, 5 and 6)

Task 7 is the spine's public surface: nothing outside `tools/lib/spine.mjs` reads
Parquet. The brief's design is right. Five things changed underneath it, and one
of the brief's own test values will return zero rows if used as written.

## 1. Team codes are `LAD` / `NYY`, not `LAN` / `NYA`

The brief's test calls `teamLineup({ year: 2024, team: 'LAN' })` and its
troubleshooting note says "Lahman team codes are not the modern abbreviations —
the Dodgers are `LAN`, the Yankees `NYA`."

**That is now wrong and must be deleted.** Task 3's source changed from Lahman to
the MLB Stats API, which uses the modern abbreviations. I read them off
`data/league/2024.parquet`:

```
TB, SEA, AZ, TEX, CWS, SF, LAD, HOU, BAL, MIA, CIN, KC, CHC, BOS,
STL, MIN, TOR, PHI, OAK, NYY, LAA, ATL, MIL, NYM, ...
```

Use `'LAD'` in the test. Remove the Lahman-codes note entirely — leaving it would
send the next person down a dead end.

## 2. `teamLineup` joins on `mlbam` directly — the crosswalk hop is gone

The brief joins `seasons.bbref → players.bbref → statcast.mlbam`. Task 3's source
now writes a **native `mlbam`** on every seasons row, and `bbref` is NULL there.
So the three-way join would match nothing.

Join `seasons.mlbam = statcast.mlbam` directly:

```sql
SELECT s.name, s.pos, s.team, s.pa, s.h, s.d2, s.d3, s.hr,
       s.bb + COALESCE(s.hbp, 0) AS bb, s.so,
       c.spd, c.hp1
  FROM read_parquet('<seasons>') s
  LEFT JOIN read_parquet('<statcast>') c
         ON c.mlbam = s.mlbam AND c.year = s.year
 WHERE s.year = ${year} AND s.role = 'bat' AND s.team = '${team}'
 ORDER BY s.pa DESC
 LIMIT ${size}
```

`data/players.parquet` stays built and stays unused by this module. It is the
crosswalk for the Retrosheet work in plan 1b, which is keyed on `retro` ids.

**Include `pos`.** The brief's Interfaces block says `teamLineup` returns "the
same shape `data.js` hands `sim.js` today", and `data.js`'s `P()` carries `pos`.
Task 3 writes it; return it.

Folding `hbp` into `bb` is correct and matches `data.js`'s documented convention
("bb includes hit-by-pitch"). Keep it.

## 3. `sigma()` reads the league dataset — values I verified

The plan was already amended for this. Confirming the numbers so the test's bound
is grounded rather than guessed. Measured from `data/league/*.parquet`, 1950-2024,
as the standard deviation of year-over-year deltas:

| stat | sigma |
|---|---|
| `runs_per_game` | 0.2554 |
| `home_runs_per_game` | 0.1062 |
| `strikeout_rate` | 0.0052 |
| `walk_rate` | 0.0041 |
| `batting_average` | 0.0050 |

Over the test's own window, 2000-2024, `runs_per_game` is **0.2007** — comfortably
inside the brief's `sd > 0 && sd < 1.5` assertion. Leave that assertion as
written; it now has a verified value behind it.

This is the denominator the product's effect-size ranking divides by. A rule
change that moves runs/game by 0.60 has moved it about 3 sigma — further than any
two consecutive real seasons since 1950. That sentence is the whole point of the
number.

## 4. `openSpine()` must refuse an incomplete spine

Task 3 writes `data/_build.json` with a `complete` flag; Task 6's
`build-coverage.mjs` already refuses to run when it is not `true`. The query layer
is the other door into this data and needs the same lock.

```js
export async function openSpine(dataDir = path.join(ROOT, 'data'), opts = {}) {
  const manifestPath = path.join(dataDir, '_build.json');
  if (!opts.allowIncomplete) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error('openSpine: data/_build.json is missing — run '
        + '`node tools/build-spine.mjs` first. Refusing to serve an unverified spine.');
    }
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.complete !== true) {
      throw new Error(`openSpine: spine build reports complete=false `
        + `(${m.failures.length} failures). Refusing to serve partial data.`);
    }
  }
  ...
}
```

`allowIncomplete: true` exists for debugging a broken build and nothing else.
Add a test that `openSpine()` throws when the manifest is absent, and that
`openSpine(dir, { allowIncomplete: true })` does not.

Expose the manifest too: `spine.buildInfo()` returning the parsed `_build.json`,
so a results page can state which build produced its numbers.

## 5. `requireCoverage` stays pure — do not change it

It takes a coverage object, a list of stat keys and a year, and returns
`{ ok, missing }`. It touches no filesystem and no database, which is what lets it
be unit-tested with no data on disk — the brief's test does exactly that and must
keep working on a fresh clone with no `data/`.

It is the intake guard: the thing that rejects "what if the mound moved back in
1927" **before** the fan is charged, naming the stat and its real first year.
Keep it a pure function. Resist any urge to have it read `coverage.json` itself.

One addition: `coverage.json` now carries a `leagueOnlySeasons` section listing
the 111 club-seasons that have team totals but no player rows — overwhelmingly
Negro Leagues clubs 1920-1948, plus the 1914-15 Federal League. Add a second pure
helper:

```js
export function leagueOnlyClubs(cov, year) // -> string[] of club abbrs, or []
```

so a results page for a 1924 question can say which clubs are league-only. Unit-
test it with a literal coverage object, no filesystem.

## 6. Unchanged from the brief

`seasonLines`, the `Spine` shape, `close()`, and the module's role as the sole
Parquet reader all stand. Keep the skip guard so the file's pure-function checks
run on a fresh clone with no `data/`.

**Cost if these rulings are wrong:** the join change and the team code are
verified against the data on disk, so those are facts rather than judgement. The
`openSpine` refusal is a judgement call — it makes the library strict by default,
and `allowIncomplete` is the escape hatch if that proves annoying in practice.
