# KPI coverage — scoping `coverage.json` to the full spec list

**Date:** 2026-09-17. **Follows:** the spine build recorded in `progress.md`.

## The gap this closes

`coverage.json` answered *"does this column exist, and since when."* Intake's
real question is *"can this KPI be computed for the season the fan asked about,
and what does a real season-to-season move look like."* Those are different
questions, and the difference is not cosmetic: `season_batting` reaches 1876,
but on-base percentage needs sacrifice flies, which nobody recorded before 1954.

Measured against the spec's list (`docs/superpowers/specs/2026-09-15-sim-as-a-service-design.md`
section 4), the old artifact certified **3 of 11** KPIs — runs/game, HR/game and
batting average were computable from team totals; the other eight were not,
because the columns were not there.

## Ruling: add six columns to the league table, not a new dataset

The menu looked like "certify 3 and document the rest" vs. "build a game-level
dataset". Both were wrong. The six missing columns — `pa`, `hbp`, `sf`, `sb`,
`cs`, `gidp` — were **already in the cached `teams/stats` responses**, fetched
and discarded unread. Adding them is a column widening plus a rebuild off a warm
cache (7394 hits, 63 fetched), not a new source, a new request, or a new gate.

**Cost if wrong:** the league parquet schema changes, so a stale `data/` from
before this change yields NULL for the new KPIs. Recoverable by
`node tools/build-seasons.mjs` — no data is destroyed, and the three completeness
gates are untouched.

That takes it to **10 of 11**. The eleventh is below.

## Ruling: `?? null`, never `?? 0`

The Stats API **omits** a stat key entirely for eras that never recorded it
(no `sacFlies` before 1954, no `caughtStealing` before ~1950, no
`groundIntoDoublePlay` before 1933) rather than returning zero. `?? null` carries
that through to Parquet, so each KPI's probe measures its **real** first year.

**Cost if wrong:** a `?? 0` default would have made every pre-1954 OBP come out
as `(h+bb+0)/(ab+bb+0+0)` — a plausible-looking number that is not OBP — and
`coverage.json` would have advertised OBP back to 1876. `tests/kpi-coverage.test.js`
asserts `on_base_percentage.first === 1954` as the regression.

## Ruling: `run_distribution_variance` stays in the list, marked unavailable

It is a property of the per-**game** run distribution; the spine holds
team-**season** totals. No expression over these columns yields it. It would
need a game-level builder over the Stats API schedule/linescore endpoints — a
new dataset, not a new column.

It is reported with `available: false`, its `reason`, and `blockedBy`, and it
carries **no sigma**. Omitting it would read as *"not a KPI"*, which is a
different and wrong statement from *"we have no game-level data"* — and only the
second one tells the next person what to build. This is the rule
`unconsumedColumns` already follows for the 100%-NULL `bbref` column.

## Ruling: `missingYears`, because first/last is not a coverage answer

A KPI's range can be hollow in the middle. `strikeout_rate` spans 1876-2025, but
13 seasons inside it (1897-1909) have no populated `pa` — batter strikeouts were
not tabulated. `steal_attempt_rate` is missing 26 dead-ball seasons.

A `first <= year <= last` check answers `ok: true` for 1900 and the fan is
charged for a diagnostic that cannot be computed. `requireKpis()` reads
`missingYears` and returns `reason: 'gap inside coverage'`, which is a different
sentence from `'outside coverage'` and from `'unavailable'` — only one of the
three is fixed by picking another year.

**Cost if wrong:** a charged request that produces an empty diagnostic. This is
the same class of failure as measuring coverage against a truncated spine.

## Ruling: one KPI table, shared by the builder and the query layer

`KPIS` in `tools/lib/spine.mjs` holds each KPI's SQL expression, required
columns and unit. `sigma()` computes from it and `build-coverage.mjs` measures
from it. `stdevOfDeltas()` is exported for the same reason.

**Cost if wrong:** two copies drift, and a KPI whose baked-in `sigma` and whose
live `sigma()` disagree ranks a rule's effect against the wrong yardstick with
nothing going red.

## Ruling: sigma's floor is 1950

Sigma is the stdev of the **year-over-year change**, not of the series, over
1950+ only. Pre-integration, pre-night-game baseball is not a comparable
yardstick for a modern rule. The window is reported per KPI in `sigmaWindow`
rather than left implicit.

## Result

| KPI | Years | Missing | sigma (1950+) | 2025 |
|---|---|---|---|---|
| runs_per_game | 1876-2025 | 0 | 0.2538 | 4.4473 |
| batting_average | 1876-2025 | 0 | 0.004935 | .24525 |
| on_base_percentage | 1954-2025 | 0 | 0.006161 | .31515 |
| slugging | 1876-2025 | 0 | 0.01464 | .40381 |
| home_runs_per_game | 1876-2025 | 0 | 0.1056 | 1.1626 |
| strikeout_rate | 1876-2025 | 13 | 0.00512 | .22219 |
| walk_rate | 1876-2025 | 0 | 0.004016 | .084072 |
| steal_attempt_rate | 1877-2025 | 26 | 0.06754 | 0.91132 |
| steal_success_rate | 1888-2025 | 18 | 0.01811 | .7767 |
| double_play_rate | 1933-2025 | 0 | 0.0007519 | .017067 |
| run_distribution_variance | — | — | — | **unavailable** |

Every 2025 figure matches real baseball (4.45 R/G on a .245/.315/.404 line,
22.2% K, 8.4% BB, 77.7% steal success), which is what says the expressions are
right and not merely non-null.

**Verified:** `node tools/run-tests.mjs` → 21/21 files pass, `ngon.test.js`
included, so `data.js`'s published box scores did not move.
