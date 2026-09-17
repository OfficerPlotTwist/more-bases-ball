# Task 8 — ADDENDUM (controller rulings; the brief's docs text is substantially stale)

Task 8 is the orchestrator plus documentation. The orchestrator is nearly right as
briefed. **The documentation text in the brief is not** — it was written against a
data source that turned out to be dead, and repeating it would actively mislead
the next person. Treat the brief's `AGENTS.md` block as a draft to be replaced,
not copied.

## 1. `tools/build-spine.mjs` — order and comment

The `STEPS` array as briefed is correct:

```js
const STEPS = ['build-players.mjs', 'build-seasons.mjs',
  'build-statcast.mjs', 'build-coverage.mjs'];
```

But the brief's header comment says "statcast joins through players.parquet",
which is false — every Savant leaderboard carries the MLBAM id natively, so the
first three builders are independent. Only the last is ordered. Use:

```
 * Order matters only at the end: coverage.json is measured from everything else,
 * so build-coverage.mjs runs last. The first three are independent — statcast
 * does NOT join through players.parquet, because every Savant leaderboard
 * already carries the MLBAM id. The crosswalk is consumed by the query layer
 * and by the Retrosheet work in a later plan, not by the builders.
```

Add one thing the brief omits: **`build-coverage.mjs` exits non-zero when the
spine is incomplete.** The orchestrator already propagates a non-zero child
status, so this works — but say so in the final message, because a user who sees
`build-spine` fail at the last step should understand it is a refusal, not a
crash:

```
if (r.status !== 0) {
  console.error(`\nbuild-spine: ${s} failed with status ${r.status}`);
  if (s === 'build-coverage.mjs') {
    console.error('build-coverage refuses to measure an incomplete spine. '
      + 'Check data/_build.json for the failing years.');
  }
  process.exit(r.status || 1);
}
```

## 2. Delete these three claims from the brief's docs text — all are now false

1. **"Lahman team codes are not the modern abbreviations — the Dodgers are `LAN`,
   the Yankees `NYA`."** Wrong. The source is the MLB Stats API, which uses the
   modern codes. I read the real values off `data/league/2024.parquet`: `LAD`,
   `NYY`, `CWS`, `AZ`, `SF`, `TB`. There are 163 distinct codes across history,
   including Federal League forms like `BAL-F`. A wrong hint is worse than none.
2. **Any reference to Lahman or the Baseball Databank as a source.** The
   `chadwickbureau/baseballdatabank` repository 404s; it is gone. Season lines and
   team totals come from `statsapi.mlb.com`.
3. **"nine batters per club, 2021–2025"** as a description of the spine. That
   describes `data.js`, the small committed slice the browser sim loads. The spine
   is every player, 1876–2025, both roles.

## 3. What the docs must actually say

Write `AGENTS.md`'s section and the `README.md` section from this, not from the
brief:

**Sources.** Season lines and team totals: MLB Stats API (`statsapi.mlb.com`),
1876–2025, batters and pitchers, per-club roster hydration. Statcast tracking:
Baseball Savant leaderboards, 2015+, six boards with per-board era starts. Player
id crosswalk: Chadwick Register. All free, none key-gated.

**Layout** (all generated, all gitignored):

```
data/
  seasons/{year}.parquet    150 files, 1876-2025, 105,833 bat + 53,719 pit
  league/{year}.parquet     150 files, team-season totals incl. R and G
  statcast/{year}.parquet    11 files, 2015-2025
  players.parquet            23,666 players, id crosswalk
  coverage.json              measured coverage manifest
  _build.json                build manifest: complete flag, per-year clubsEmpty
  .cache/                    sha1-keyed HTTP cache, no TTL
```

**One command:** `node tools/build-spine.mjs`. Cold ≈ a few minutes, warm ≈ 30s.
`MBB_CACHE_REFRESH=1` forces refetch.

**Three gates, and why they exist.** State these plainly — they are the spine's
main safety property:
- `build-seasons.mjs` writes `data/_build.json` with `complete: true` only when
  the year loop finished, no club fetch failed, and every year fetched the number
  of clubs MLB lists. A partial build never exits 0.
- `build-coverage.mjs` refuses to run unless `complete === true`. `coverage.json`
  is what intake reads before charging a customer; measuring a truncated spine
  and reporting it as whole is the worst failure this project has.
- `openSpine()` refuses for the same reason, with `{ allowIncomplete: true }` as
  a debugging-only escape.

**Query it through `tools/lib/spine.mjs` only.** Nothing else reads Parquet —
that is what keeps the storage layout swappable. Its `teamLineup` returns the
same shape `data.js` hands `sim.js`, plus `pos`.

**`spine.mjs` validates its inputs and throws.** `year` must be an integer,
`team` must match `/^[A-Z]{2,4}(-[A-Z])?$/`, `role` must be `bat` or `pit`.
This is not fussiness: those parameters originate in a customer request in the
product this serves, and the module interpolates them into SQL. Both a
`year: '2024 OR 1=1'` and a `team: "LAD' OR '1'='1"` payload were demonstrated
defeating the filters before the guards were added; `tests/spine-query.test.js`
carries both as regressions.

**Coverage is a product surface, not a build detail.** `coverage.json` records,
per stat, the measured first and last year, row and player counts, and a
`populationVsWidest` ratio. That ratio exists because Statcast columns do not
share a population: bat tracking covers 0.07 of what expected-wOBA does, arm
strength 0.28. It also carries `leagueOnlySeasons` — 111 club-seasons that have
team totals but no player rows, overwhelmingly **Negro Leagues clubs 1920–1948**
(MLB recognised them as major leagues in 2020, so they appear in the team list
while player-level data remains thin), plus the 1914–15 Federal League. A fan
asking a 1924 question should be told this on his results page. It is provenance,
not an apology.

**`data.js` is unchanged and must stay that way.** It is the committed slice the
browser sim loads. Its run environment is published in the README and
`tests/ngon.test.js` asserts the box scores do not move. Regenerating it from the
spine is a task in a later sub-project, gated by a golden-run identity test.

## 4. Note for the user, put it in the report not the docs

`tools/build-data.mjs:60` reads `stats.splits[0]`, which for a traded player is
the **combined** season line, and stamps it with whichever club's roster fetched
it. `data.js` currently carries 18 such players for 2024 alone — Jorge Soler at
574 PA for both ATL and SF, Gio Urshela 461 for both ATL and DET, and so on —
each inflating two lineups. The spine hit the identical bug and fixed it by
adding `team` to the stats hydrate and selecting the split whose `team.id`
matches the club. Do not fix `data.js` here; it is frozen by this plan's
constraints. Flag it.

**Cost if these rulings are wrong:** documentation only, plus one extra error
line in the orchestrator. Everything factual above was read off the data or the
running code.
