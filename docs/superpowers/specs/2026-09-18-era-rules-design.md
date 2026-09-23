# Era rules — design

**Date:** 2026-09-18
**Status:** approved, not yet implemented
**Scope:** apply the significant MLB rules changes of 1876–2026 to the simulator, on modern player pools, with per-rule calibration.

## 1. What this builds

A rules layer that lets a player say "1968 rulebook" (or hand-pick individual
rules) and have the simulation respond the way history says it should.

Two decisions are already settled and the design depends on both:

- **Rules only, modern players.** `data.js` holds 2021–2025 rosters. Era mode
  changes the *rulebook*, not the *population*. The spine has real 1927 players
  (`teamLineup({year:1927, team:'NYY'})` returns Ruth at 60 HR today), but
  shipping them to the browser means regenerating `data.js`, which AGENTS.md
  gates behind a golden-run identity test. That is a separate sub-project.
  The rules layer is designed so it slots in later without rework (§4.4).
- **Calibrated, validated per rule.** Every rate coefficient traces to a
  sourced before/after measurement. Rules history never quantified ship with no
  rate effect rather than an invented one.

### 1.1 The catalog

112 rules, 1876–2026, from 27 sources, in
`docs/decisions/2026-09-18-era-rules/rules-catalog.json` (moved there from the
research scratchpad as part of phase 1).

| Category | Count |
|---|---|
| PLATE_OUTCOME | 28 |
| EQUIPMENT_FIELD | 28 |
| ADMINISTRATIVE | 24 |
| GAME_STRUCTURE | 11 |
| FIELDING | 6 |
| PACE | 6 |
| LINEUP | 5 |
| BASERUNNING | 4 |

69 carry a quantified effect. 58 are modelable per plate appearance, 25
partially, 29 not at all. The intersection — quantified **and** modelable — is
**43 rules**, and those are the ones that get coefficients.

## 2. The three tiers

The engine's own structure sorts the catalog. Tiers are a property of what
moreBasesBall can represent, not of how important a rule was.

### Tier A — structural (5 catalog rules)

Expressible as game state, not as a rate. The first three rows below are
existing engine knobs rather than catalog entries — they are listed because an
era bundle sets them, but they are not among the 112 and are not counted in the
partition.

| Rule | Year | Implementation |
|---|---|---|
| Innings per game | various | `cfg.innings`, already wired (`sim.js:259`) |
| Outs per inning | various | `cfg.outs`, already wired (`sim.js:185`) |
| Lineup length | various | `side.lineup.length` is already generic (`sim.js:186`) |
| All runs count on a game-ending HR | 1920 | walkoff branch, `sim.js:229` |
| Automatic runner on second in extras | 2020 | state init at top of `playHalfInning` |
| Seven-inning doubleheaders | 2020 | `cfg.innings = 7` |
| Designated hitter | 1973 AL / 2022 all | lineup-slot substitution, §4.3 |

The ghost runner is the one worth calling out: it is **pure state
initialization**, seeding `bases[1]` with the previous half-inning's last
batter when `ctx.inning > cfg.innings`. `ctx` already carries `inning`
(`sim.js:201`) and `side.spot` (`sim.js:185`) identifies the batter. It costs
**zero** new random draws, so it cannot perturb the stream.

### Tier B — rate perturbation (43 rules)

`adjustedRates(p, deltaFt)` at `sim.js:55-73` is already a complete, tested,
documented rate-perturbation engine. It serves exactly one rule (mound
distance) and it is the template for all of Tier B: take the batter's season
rates, apply multipliers to `{bb, k, s1, d2, d3, hr}`, renormalize under the
existing safety clamps.

This is the highest-leverage part of the project. Roughly half of all
scoring-relevant era rules — the 1880→1889 walk-count ladder, 1893's rubber,
1901/1903 foul-strike, 1910 cork, 1920 clean ball, 1931 deadened ball, 1963 and
1969 zone changes, 1969 mound, 2001 QuesTec, 2021 sticky stuff — are the same
shape, differing only in which of the six rates they move and by how much.

### Tier C — declared, not simulated (64 rules)

Replay, mound-visit limits, pine tar, pitch timers, the reserve clause, the
1965 draft, postseason structure. These ship in the catalog and appear in the
UI marked **in effect · no simulated effect**, each with the reason it cannot
be modeled.

Tier C is larger than it first looks, and the breakdown matters: 29 rules are
flatly unmodelable per plate appearance, 25 are partially modelable (the engine
can represent some of what they changed but not all), and 10 are modelable in
principle but were never quantified by any source. That last group is the one
worth re-reading later — each is a rule the engine could carry if someone finds
the numbers. Tiers partition the catalog exactly: 5 + 43 + 64 = 112, asserted by
`tests/rules-catalog.test.js`.

This is deliberate and follows the precedent AGENTS.md sets for
`coverage.json`: *never omit an unavailable KPI — an absent key reads as "not a
KPI", which is a different and wrong statement from "we have no data for it",
and only the second tells the next person what to build.* A rule silently
missing from an era would read as a rule that did not exist. Tier C is the
same refusal, applied to rules.

## 3. The determinism invariant

`tests/ngon.test.js:44-52` JSON-stringifies the full play log — `[type, sub,
runs, outsAfter, basesAfter]` for every plate appearance of
`simGame(NYY, LAD, {bases:3, innings:9, outs:3}, 7)` — and asserts it is
byte-identical before and after geometry is attached. AGENTS.md names this as
the contract that keeps the published README run environment honest.

> **Every era rule is a branch whose predicate is a config value. Never a
> re-weighting of the `events` array, never a restructuring of a short-circuit.
> Rules off ⇒ zero new random draws ⇒ byte-identical output.**

Three specific places make this fragile. They are listed here because the
implementer will be tempted by all three.

1. **`sim.js:96` — the stretch roll.**
   `(hitValue === 1 && rnd() < 0.32) || (hitValue === 2 && rnd() < 0.22)`
   consumes one draw on a single, one on a double, and **zero** on a triple or
   a home run, because JS short-circuits. Hoisting it to
   `const a = rnd(), b = rnd()` changes a single from 1 draw to 2 and a homer
   from 0 to 2. The whole game diverges from that plate appearance on.
   Parameterizing the two *thresholds* is safe — the draw count is unchanged.
   Restructuring the expression is not.

2. **`sim.js:75-81` — the event array.** Inserting a row (say `['HBP', rate]`)
   re-partitions the unit interval for every bucket after it. At a literal rate
   of `0` the arithmetic is identical, but any nonzero rate shifts every
   downstream comparison. New outcomes must be **branch-gated**, not
   rate-gated.

3. **`sim.js:61` — the mound guard.** `if (moundDeltaFt)` relies on `0` and
   `undefined` being falsy. `adjustedRates(p, 0)` is *empirically* equal to the
   legacy path (`tests/mound.test.js:19-24` proves it over 5000 draws for one
   batter) but it is not proven for all players — it recomputes `k` through
   `Math.min(k, 1 - sum - 0.02)` at `sim.js:53` rather than
   `(p.so/p.pa)/outShare` at `:88`. **A rules object must never be
   truthy-by-default on the classic path.** The default config takes the
   legacy branch literally, not equivalently.

### 3.1 Where new draws may safely go

Gated on a config flag that is false by default, these locations consume
nothing today and are therefore free:

- Before the plate-appearance roll (`sim.js:136`) — nothing precedes it.
- Inside the `type === 'BB'` branch (`sim.js:143-146`) — consumes zero draws.
- Inside `walkAdvance` (`sim.js:113-125`) — takes no `rnd` at all today.
- The prologue of `playHalfInning` — for the ghost runner.

## 4. Architecture

### 4.1 New module: `rules.js`

A new IIFE hanging off `window.MBB_RULES`, matching every other non-module file
in the project (`field3d.js` remains the only ES module).

Pure data and pure functions. No engine dependencies, so it is testable in
isolation and cannot perturb a simulation by being loaded.

```
MBB_RULES.CATALOG            // the 112 rules, frozen
MBB_RULES.forYear(year)      // -> { active: [...], tierA, tierB, tierC }
MBB_RULES.resolve(selection) // -> { structural:{}, modifiers:{}, declared:[] }
MBB_RULES.TIER               // 'A' | 'B' | 'C' per rule id
```

`resolve()` returns a plain object. `modifiers` is the merged multiplier set
for the six rates; `structural` carries innings/outs/lineup/ghost-runner;
`declared` is the Tier C list the UI renders.

Multiple active rules compose **multiplicatively per rate**, in year order.
Composition is associative and order-independent for multipliers, which is why
this is safe; the spec records it explicitly so nobody later adds an additive
coefficient and breaks that property.

### 4.2 Engine changes

| File | Change |
|---|---|
| `sim.js:60` | `plateAppearance(p, rnd, moundDeltaFt, rules)` — **appended** 4th param |
| `sim.js:93` | `hitAdvance(bases, batter, hitValue, rnd, rules)` — appended |
| `sim.js:113` | `walkAdvance(bases, batter, rules)` — appended |
| `sim.js:20` | `DEFAULT_CFG` gains `rules: null` (falsy ⇒ legacy branch) |
| `sim.js:96,158,163` | the literals `0.32 / 0.22 / 0.26 / 0.13` read from `rules` when present, keeping their values as defaults |
| `sim.js` (new) | `applyModifiers(rates, modifiers)` beside `adjustedRates`, not replacing it |
| `graphsim.js:668`, `trisim.js:84` | mirror `rules` onto the existing `geo` object |
| `graphsim.js:676`, `trisim.js:110` | forward `cfg.rules` to `plateAppearance` |
| `ui.js:237` | `readCfg()` gains `rules` — the single chokepoint |

Appending parameters is test-safe: no test asserts arity, and
`tests/mound.test.js:22` is the only direct caller of `plateAppearance`.
`adjustedRates(p, deltaFt)` keeps its exact signature — it is separately
asserted nine times in that file.

`geo` is the chosen carrier for the graph and tri engines because it already
exists at two construction sites and reaches all six advancement functions.
Threading a new parameter instead would mean six signature changes in
`graphsim.js` alone.

### 4.3 The DH

The DH is Tier A, not Tier B, and it is the one structural rule that needs data
the browser bundle does not have.

The lineup is always the top 9 batters by plate appearance
(`tools/build-data.mjs:127`). There is no pitcher in the batting order to
remove, so **DH-on is the current state** and DH-off is what must be built.

Implementation: `rules.js` carries a synthetic pitcher-batting line — the
sourced 2021 NL pitcher aggregate, `.110/.149/.140` with a 44.1% strikeout
rate — and DH-off substitutes it into the 9th lineup slot. This is a league
aggregate, not a real player, and the UI labels it as such ("replacement
pitcher, 2021 NL aggregate"). It is honest about being a stand-in and it
requires no `data.js` change.

### 4.4 Forward compatibility with era players

Every era bundle carries a `playerSeason` field. Today it always resolves to a
year present in `MBB_DATA.YEARS` (2021–2025). When `data.js` is later
regenerated from the spine, the same field resolves to the era's own year and
nothing else in the rules layer changes.

### 4.5 One spine addition

`tools/lib/spine.mjs` exports no league-line function today — `seasonLines` is
player-grain and `sigma()` returns only a scalar. The calibration harness needs
league totals per year, so the spine gains:

```
leagueLine(year) -> { year, g, r, pa, ab, h, d2, d3, hr, bb, so, hbp, sf, sb, cs, gidp }
```

Thin, follows `sigma()`'s existing pattern, and subject to the same `checkYear`
guard. This matters because AGENTS.md is explicit that nothing but `spine.mjs`
reads Parquet — that is what keeps the storage layout swappable. The
calibration harness must not open Parquet directly.

## 5. Calibration

### 5.1 Relative deltas on a fixed pool, never absolute levels

The sim cannot *be* 1968. 1968's K/PA was .158; 2025's is about .222. That gap
is players, not rules. Asserting the sim hits 1968's 3.42 runs/game would be a
false positive — a coefficient can always be tuned to hit one number.

So every calibration test holds the player pool fixed at a modern season and
asserts the **proportional** shift:

```
apply(ruleSet) to 2025 pool  ->  runs/game moves by the ratio history moved
1969 mound:   3.42 -> 4.07 in history  =>  +19%  expected in sim
1963 zone:    4.46 -> 3.95 in history  =>  -11%  expected in sim
1931 ball:    5.68 -> 4.48 in history  =>  -21%  expected in sim
```

### 5.2 Five constraints per rule, not one

Each calibrated rule asserts against the full per-PA event vector — 1B, 2B, 3B,
HR, BB, K — not runs alone. Six constraints cannot be satisfied by overfitting
one coefficient, which is exactly the failure mode a single runs/game check
invites.

### 5.3 Tolerance comes from the spine, measured not guessed

σ of year-over-year runs/game deltas, computed from the league parquet:

- **0.2538** runs/game over 1950–2025 (the baked value in `coverage.json`)
- **0.371** runs/game over 1876–2025

Inside 1σ is indistinguishable from ordinary year-to-year noise. Past 2σ is a
real miss. Tests assert 2σ as the failing threshold and report the 1σ position.

Monte Carlo error is not the binding constraint: at roughly 10 runs² per game
of variance, 5000 games gives a standard error near 0.045 runs/game, well
inside σ. Calibration runs use 5000 games per arm.

### 5.4 Confounded years get a band, not a point

This is the part a naive implementation gets wrong. Several marquee rules
landed in seasons that changed more than one thing:

| Year | Rule | Confound |
|---|---|---|
| 1969 | mound lowered | same-season strike-zone shrink **and** four-team expansion |
| 1893 | rubber to 60'6" | 1894 also adds the foul-bunt strike |
| 1910 | cork ball | effect reverses by 1914 as pitchers adapt |
| 2022 | universal DH | deadened ball swamps it — NL runs/game **fell** 4.46 → 4.34 |
| 1920 | clean ball | spitball ban lands the same year |

Three rules for handling this, applied in order:

1. **Prefer an isolated estimate where a study provides one.** 1973's DH has a
   natural control — the unchanged NL moved 3.91 → 4.15 the same year the AL
   moved 3.47 → 4.28, isolating roughly 0.6 runs/game. 2023's shift ban has a
   difference-in-differences study (arXiv 2411.15075) isolating about +9 points
   of BABIP and OBP for left-handed batters.
2. **Where no isolated estimate exists, the two confounded rules are
   calibrated as a pair** and the test asserts the *combined* effect. 1969's
   mound and zone changes are calibrated jointly; neither carries a solo
   coefficient.
3. **Where a rule is confounded with something outside the catalog** (1969's
   expansion, 2022's ball), the test asserts **direction and a magnitude band**,
   not a point value, and the catalog entry carries `confounded: true` with the
   confounding factor named. 2022's universal DH must **increase** simulated
   offense even though the real 2022 season saw offense fall — the test asserts
   the sim's DH-on-vs-DH-off delta is positive, and the catalog records why the
   raw year-over-year number disagrees.

A rule that is quantified but irreducibly confounded and has no isolated
estimate is demoted to Tier C rather than given a guessed coefficient.

## 6. Testing

Three new files, joining the existing 22.

### `tests/rules-identity.test.js` — the freeze guard

- With `rules: null`, `simGame` output is byte-identical to the pre-change
  engine for a fixed set of seeds. The expected strings are captured from the
  current `main` before any engine edit and committed as fixtures.
- `plateAppearance(p, rnd)` and `plateAppearance(p, rnd, 0, null)` consume
  identical streams over 5000 draws — the `mound.test.js:19-24` pattern
  extended to the new parameter.
- With every Tier C rule active, output is still byte-identical. Tier C must
  provably do nothing.
- The default `cfg` merge at `sim.js:192` still produces a falsy `rules` when
  the caller passes `{bases:3}` — the exact call
  `tests/sim.test.js:24-25` relies on.

### `tests/rules-direction.test.js` — per-rule sanity

For each of the 48 calibrated rules, over 600 games: the rule moves each
affected rate in the documented direction, and rates it should not touch stay
within noise. Cheap, fast, catches sign errors.

### `tests/rules-calibration.test.js` — the historical claim

For each calibrated rule or confounded pair, 5000 games per arm, asserting the
proportional shift against the sourced figure at the 2σ threshold from §5.3.
Skips cleanly when `data/` is absent, matching the existing spine tests, since
it needs `leagueLine()` for the σ denominator.

The existing Tier 2 aggregate bands must also still pass unchanged with rules
off: classic runs/team in 3.0–7.0 (`tests/sim.test.js:29-31`), base-count
monotonicity (`:36-41`), `cw` > `own` × 1.3 (`tests/graphsim.test.js:54-59`),
mound monotonicity (`tests/mound.test.js:52-70`).

## 7. UI

One new control in the deck and one new panel.

- **Era select** — a year, plus "no era rules (current)" as the default. The
  default must remain the current behavior so the page loads into the published
  run environment.
- **Rules panel** — lists what the chosen year has in effect, grouped by tier.
  Tier A and B entries show the rule and its modeled effect. Tier C entries
  show the rule and the reason it is not simulated. Each entry links its
  sources.

The panel is the honest surface: it is where a player learns that the 1923
rulebook included things this simulator cannot represent, and why.

Mobile: the panel follows the existing pattern — it is a `.panel` with a
scrolling body, capped like `.pbp-panel` at 360px on phones.

## 8. Phasing

**Phase 1 — foundation, nothing user-visible.**
`rules.js` with all 112 rules; catalog committed to
`docs/decisions/2026-09-18-era-rules/`; `leagueLine()` added to `spine.mjs`;
`tests/rules-identity.test.js` green with rules off; engine parameters appended
but every default taking the legacy branch. Exit: 25 test files pass (22 existing plus catalog, resolve and identity
guard), and the identity fixtures prove the engine is untouched in its default configuration.

**Phase 2 — Tier A plus the 12 largest Tier B rules.**
The era select works. Calibration covers the twelve biggest documented effects
(1889 walk count, 1893 rubber, 1901/1903 foul-strike, 1910 cork, 1920 clean
ball, 1931 deadened ball, 1963 zone, 1969 mound+zone pair, 1973 DH, 2001
QuesTec, 2022 universal DH, 2023 shift ban). Exit: calibration test green at
2σ for all twelve.

**Phase 3 — the remaining 31 Tier B rules and the Tier C surface.**
Full timeline in the UI, every rule visible with its tier and sources.
Exit: all 112 rules reachable from the UI, 27 test files pass.

## 9. What this explicitly does not do

- It does not make the simulator pitch-level. There is no count, no ball, no
  strike, no foul. Rules that are inherently count-based (the foul-strike rule,
  every strike-zone change) are approximated as rate perturbations, which is
  the same approximation the existing mound rule already makes.
- It does not add stolen bases, hit-by-pitch as a distinct event, errors,
  pitcher identity, handedness, or park factors. Several Tier C rules are Tier C
  precisely because those concepts are absent; adding any of them is its own
  sub-project.
- It does not regenerate `data.js`, and it does not change the published run
  environment in the README.
- It does not claim any simulated season *is* that season. Every calibration is
  a delta on a modern player pool, and the UI says so.

---

Generated by claude-opus-5 · task completed
