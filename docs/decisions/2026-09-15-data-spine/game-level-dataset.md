# The game-level dataset — closing the eleventh KPI

**Date:** 2026-09-17. **Follows:** [kpi-coverage.md](kpi-coverage.md), which took
`coverage.json` from 3 of 11 certified KPIs to 10 and left
`run_distribution_variance` marked `available: false` with a `blockedBy` naming
exactly this work.

## Ruling: team-game grain, not game grain

`data/games/{year}.parquet` holds two rows per game, one per club:
`year, gamePk, date, team, opp, runs, runs_allowed, home`.

`var_pop(runs)` over team-games **is** the run distribution a fan means. Storing
game rows instead would make every consumer write an unpivot, and write it
correctly, before it could ask the only question this dataset exists to answer.
Cost is one boolean column and 2x rows — ~450k rows, a few MB.

**Cost if wrong:** a re-run of one builder.

## Ruling: `var_pop`, not `var_samp`

A season's team-games are the whole population of that season's games, not a
sample drawn from a larger one. The two differ by n/(n-1) — about 0.02% at 4860
team-games.

**Cost if wrong:** nothing visible, ever. That is precisely the danger: the wrong
choice produces a number that looks right in every check a human would run, so
the reasoning has to be written down rather than re-derived.

## Ruling: coverage starts at 1901

The schedule endpoint returns `totalGames: 0` for every season 1876-1900. Season
lines and team totals for those years exist; the game log does not. `FIRST_GAME_SEASON`
encodes the boundary so a run does not report 25 empty years as 25 failures, and
`run_distribution_variance` reports `first: 1901` while the other ten reach 1876.

## Three bugs the tests caught, all real

The dataset was built, looked plausible, and had 451,018 rows. Then
`tests/games-data.test.js` ran four structural invariants against it and three
failed. None would have shown up in the KPI value — the variance would simply
have been wrong.

### 1. Duplicate `gamePk` — 203 malformed games across 81 seasons

A suspended game is listed under **both** the date it started and the date it
resumed, and `totalGames` counts it twice. `flatMap` over `dates[]` emitted it
twice, producing four rows under one `gamePk` and counting that game twice in
the distribution.

Deduped on `gamePk`. The manifest now keeps `gamesFetched` (the raw transported
count, checked against `totalGames`) separate from `gamesUnique` — "did the
response arrive whole" and "how many distinct games does it describe" are
different questions and were being answered by one number.

### 2. 77 rows with `team: NULL` — the Negro Leagues, again

Negro Leagues clubs appear in the schedule for 1931/1934/1939 but **not** in
`/teams?sportId=1&season=Y`. The abbreviation lookup missed, the name fallback
had been pruned out of `fields=`, and the row landed with a null team — one side
of 77 real games silently absent from a per-team run distribution.

`/teams/{id}` resolves each one (1491 → BEG, Baltimore Elite Giants), so
`abbrForId()` falls back to it and memoises. This is the game-grain face of the
same gap `coverage.json` already reports as `leagueOnlySeasons`: **when this
dataset surprises you, check whether the surprise is the Negro Leagues before
assuming it is a bug in the code.**

### 3. Four games where a club plays itself — upstream, not ours

The Stats API reports the **same club id on both sides** of four games: 1943
Baltimore Elite Giants x3, 1940 New York Black Yankees x1. The opponent was never
recorded. The runs are real; the away side of the record is fictitious.

Excluded at build time and **counted** in the manifest as `selfGames`. Four games
out of 225k is numerically nothing, which is exactly why it must be visible
rather than dropped — a future reader who finds this on their own should find the
count already waiting for them.

## Ruling: an in-progress season never enters the series

2026 is being played as this is written: 2290 of 2458 scheduled games. Its
variance is a real number over a partial season and is **not** comparable to a
full one — and sigma is a series of year-over-year deltas, so one partial year
corrupts two of them.

Detected from the schedule (a scheduled game dated after today), **not** from
`gamesScored < apiTotalGames`, which cannot distinguish "not played yet" from
"never played": the 1994 strike and the 2020 season both scheduled games that
were never made up, and neither is in progress. Excluded from the series and
named in `kpis.inProgressSeasons`, because a reader who sees `last: 2025` in
September 2026 has to be told why.

## Ruling: `data/games/` is optional, and its absence demotes ONE KPI

The `_build.json` gate refuses *everything* when the spine is partial, because
there a truncated build makes every number suspect. This dataset is different:
ten KPIs never touch it, so a spine built without it is narrower, not broken.
Its absence sets `run_distribution_variance` to `available: false` with the
build command attached, and the other ten are unaffected.

Its own manifest must still say `complete: true` — a games build that lost
seasons would narrow the variance series silently, and a sigma computed over
whichever years happened to survive is a yardstick nobody can interpret.

## Result

`run_distribution_variance`: **1901-2025, 125 seasons, no gaps, sigma 0.6934,
2025 = 10.539 runs².**

That is a variance-to-mean ratio of 2.37 against a 4.45 R/G league — baseball
run scoring is over-dispersed relative to Poisson, which is the shape this number
has to have. The live `sigma()` and the baked `coverage.json` value agree to four
significant figures, because both read the same `KPIS` table.

**Coverage is now 11 of 11.**
