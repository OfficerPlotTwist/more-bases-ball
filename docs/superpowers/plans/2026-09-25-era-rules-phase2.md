# Era Rules — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the era-rules machinery move a number, honestly. Close the two
seams phase 1 left open, give the calibration harness a yardstick it does not
currently have, and calibrate the Tier B effects that the spine can actually
verify — while the default configuration stays byte-identical to the published
run environment.

**Architecture:** Phase 1 built two empty seams and proved the engine untouched.
This phase fills them. `composeModifiers` gains a Tier A branch; `resolve()`
stops returning a second, disconnected bucket; `sim.js` reads the one that
remains. Tier B coefficients go into the catalog JSON, so `rules.js` is
regenerated rather than edited. A new harness in `tools/` measures the sim
against `leagueLine()` and writes a committed report.

**Tech Stack:** Vanilla ES2020 in browser-compatible IIFEs (CommonJS
`module.exports` fallback for tests), Node 20+ tests using the project's
hand-rolled `check()` harness, DuckDB via `tools/lib/spine.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-18-era-rules-design.md` — §5.2 (the
per-rule constraints), §5.3 (the 2σ threshold), §5.4 (the confound policy), §8
(phase 2's scope, which this plan corrects).

**Phase 1 plan:** `docs/superpowers/plans/2026-09-18-era-rules-phase1.md`

---

## Read this before starting: five things that are not what the handoff said

Each of these was verified in code or measured against the built spine. Each one
changes a task. Two of them would have shipped a wrong number silently.

### 1. The two buckets are not "two names for one bucket". They are two dead ends.

`composeModifiers` (`rules.js:1774-1794`) builds `const structural = {}`, never
populates it, and returns it. `resolve()` (`rules.js:1796-1820`) destructures
that `structural` and then returns **a different object**: `{ ids, structural,
tunables: {}, modifiers, declared }`, where `tunables` is a bare literal derived
from nothing. `sim.js:45-52` reads `rules.tunables` — the literal.

| seam | written by | read by | carries |
|---|---|---|---|
| `structural` | `composeModifiers` | **nothing** | nothing |
| `tunables` | `resolve()`, as `{}` | `sim.js` `tunables()` | nothing |

A Tier A setting written into `structural` today is discarded by `resolve()`
before any engine sees it. No throw, no red test, and the rule still appears in
`ids`, so the UI would list it as active while it does nothing. That is a worse
failure than a rename.

### 2. `adjustedRates → applyModifiers` is unreachable, not merely untested.

`plateAppearance` (`sim.js:100-124`) chains them only when `moundDeltaFt` is
truthy AND `hasMods` is true. `sim.js:188` passes a hardcoded literal `0`, so the
classic engine cannot reach the chain. In the graph and tri engines
`ctx.moundDelta` can be non-zero, but every test that sets a non-regulation
`moundDist` (`mound.test.js`) omits `rules`, and every test that sets `rules` uses
`L.makeStarter(250)`, whose `moundDist` is hardcoded `60.5` (`layout.js:191`).
A fixture case alone would have tested nothing.

### 3. The two DH rules are Tier A, so they get no coefficient at all — and the
### mechanism they need does not exist.

`1973-designated-hitter` and `2022-universal-designated-hitter` are both
`tier: "A"`, category `LINEUP`. They are a lineup-slot substitution, not a rate
perturbation. But `data.js` ships **nine real batters per club and no pitcher
batting line**, so there is no pitcher slot to substitute for. The DH's entire
modelled effect is "replace a .110-hitting pitcher with a league-average bat",
and this simulator has no .110-hitting pitcher to replace.

**So the DH cannot be calibrated in this phase without first inventing a
synthetic replacement-pitcher line.** That is its own sub-project with its own
sourcing question (what line? whose?), and folding it in here would put the two
highest-confidence rules in the catalog behind the largest unsolved dependency.
Task 11 scopes it and defers it.

### 4. `so` is NULL for 1900-1909, which breaks the rule I would otherwise have
### calibrated first.

Measured from the spine: `so` returns NULL for 1900, 1901, 1902, 1903 and 1909.
The foul-strike rule (NL 1901, AL 1903) is the cleanest natural experiment in the
entire catalog — staggered adoption two years apart, near-identical published
effect — and **its effect is on strikeout rate, which the spine cannot measure
for either year.** The sourced x1.58/x1.56 K figures come from K/9 in secondary
sources; `leagueLine()` returns null.

It is still worth calibrating, on the rates that ARE observable (BA and runs:
catalog cites NL BA .279→.267 and runs/team-game ~5.2→4.6). But the K
coefficient it carries cannot be validated against the spine, and the
calibration test must say so rather than skip silently. **The premise "a wrong
coefficient here has nowhere to hide" was exactly backwards.**

### 5. Measured per-PA multipliers disagree with the published ones, because
### per-game and raw-count multipliers are not per-PA multipliers.

This is the finding with the widest blast radius. `RATE_KEYS` are per-PA. Nearly
every published effect size is a per-game rate, a raw league total, or a rate per
9 innings. Converting by eye does not work, because games, PA-per-game and
schedule length all moved too.

Computed from `leagueLine()` on the built spine — **these are the numbers to
calibrate against, and the ones in the research are not:**

| rule (year pair) | `bb` | `k` | `hr` | `d2` | `d3` | `s1` | r/g |
|---|---|---|---|---|---|---|---|
| 1889 (1888→89) | **1.481** | 1.810 | 1.234 | 1.178 | 0.985 | 1.056 | 1.224 |
| 1893 (1892→93) | 1.103 | 0.621 | 1.220 | 1.215 | 1.147 | 1.109 | 1.285 |
| 1910 cork (1910→11) | 1.044 | 1.074 | **1.410** | 1.145 | 1.128 | 1.039 | 1.177 |
| 1920 (1919→21) | 1.006 | 0.721 | **1.774** | 1.141 | 1.136 | 1.055 | 1.274 |
| 1931 (1930→31) MLB | 1.026 | 1.141 | **0.712** | 0.983 | 0.810 | 0.983 | 0.870 |
| 1963 (1962→63) | **0.893** | **1.088** | 0.917 | 0.968 | 0.956 | 0.973 | 0.885 |
| 1969 (1968→69) | **1.195** | **0.958** | 1.273 | 1.022 | 0.983 | 1.012 | 1.191 |
| 2001 (2000→01) | 0.881 | 1.052 | 0.977 | 1.006 | 1.000 | 0.983 | 0.929 |
| 2023 (2022→23) | 1.053 | 1.014 | 1.115 | 1.025 | 1.114 | 0.995 | 1.078 |

Four corrections fall straight out of this table, and each one is a coefficient
that would otherwise have shipped wrong:

- **1889's walk effect is x1.481 per PA, not the x1.73 the raw walk counts give**
  (NL walks 2,093 → 3,612). The count ratio is inflated by PA growth. x1.48 is
  the number; the sourced band of 1.5–1.75 brackets it but its midpoint does not.
- **1889's `k` x1.810 and 1893's `k` x0.621 are data artifacts, not effects.**
  1888 `so`/PA is .0501, 1889 is .0907, 1890 is back to .0521. A walk-count
  change cannot raise strikeouts 81% and then give it back. Pre-1900 strikeout
  tabulation is unstable, and neither rule may carry a `k` coefficient.
- **1931's `hr` is x0.712 MLB-wide but the catalog cites x0.553, because the
  catalog figure is NL-only.** The NL deadened its ball and the AL did not —
  which is what makes 1931 the one true diff-in-diff in the catalog, and it is
  unusable until `leagueLine()` can filter by league. It cannot today. Task 5.
- **2023's `hr` x1.115 is not the shift ban.** The shift ban moved BABIP. The
  home-run rise is the ball rebounding from 2022's deadening. A coefficient
  fitted to the year-over-year `hr` delta would attribute a ball change to a
  fielding rule.

And one direct contradiction to resolve rather than paper over: the catalog's own
`measured_effect` for 2001 QuesTec says "the walk drop is the cleanest signal of
a taller enforced zone" (and the spine confirms `bb` x0.881). But the park-level
natural experiment — QuesTec parks against non-QuesTec parks in the same season,
~1,500 games — measures K/BF 17.44% vs 17.63% and BB/BF 8.84% vs 8.75%, about one
altered call per 475 pitches, not significant. **The league-level walk drop is
real and QuesTec is not why.** The catalog sentence is wrong and Task 8 corrects
it.

---

## Global Constraints

- **Byte-identity remains the hard gate.** With `rules` falsy, every engine's
  output must still match `tests/fixtures/identity-golden.json`. A task that
  reddens `tests/rules-identity.test.js` is rejected, not patched, and the
  fixture is never regenerated to make a failure go away.
- **`rules.js` is GENERATED. Never hand-edit it.** Coefficients go into
  `docs/decisions/2026-09-18-era-rules/rules-catalog.json`, then
  `node tools/build-rules.mjs`. Note the catalog JSON has **no `id` field** —
  ids are synthesised in `rules.js` as a truncated slug of year plus name, so a
  rule is addressed in the catalog by its `year` and `name`, and the id is an
  output. Renaming a rule changes its id.
- **Calibrate against the spine's per-PA rates, never against a published
  per-game or raw-count figure.** Finding 5 is why. Every coefficient's catalog
  entry records both: the published effect with its source, and the per-PA
  multiplier actually fitted.
- **A coefficient that is not sourced is not written.** Where the honest answer
  is "this cannot be isolated", the rule gets a direction-only assertion or stays
  Tier C. §5.4 is the policy and this plan does not relax it.
- **`composeModifiers` must never sort its input.** `tests/rules-resolve.test.js`
  proves order-independence with forward, reversed and shuffled orderings.
- **Calibration asserts PROPORTIONAL deltas on the modern player pool**, never
  absolute historical levels. The sim cannot be 1968 — most of the gap is
  players — and a single runs/game match is a false positive, because a knob can
  always be tuned to hit one number.
- **`data.js` is not regenerated.** Its eleven shipped values are frozen.
- **No new runtime dependencies.** Write LF line endings, forward-slash paths,
  no `C:\` literals.
- **All test files must pass** via `node tools/run-tests.mjs`. Count goes
  27 → 29 (direction, calibration).

## Measure the output distribution before believing the implementation

The fielding-errors branch shipped a design in which 55% of charged errors landed
on balls the fielder caught and the batter was out on 100% of them. Five
task-scoped reviews passed it; every task had built exactly what its brief
specified. Only a whole-branch reviewer who **instrumented the engine and counted
outcomes** found it.

This phase is more exposed than that one, because a miscalibrated coefficient
produces a plausible box score by construction. Finding 5 above is that same
lesson applied to the research itself: four sourced multipliers were wrong for
this model and only measuring showed it. So every rate-touching task carries its
own distribution check, and **Task 12 is a mandatory measurement pass that
cannot be satisfied by reading code.**

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/decisions/2026-09-18-era-rules/rules-catalog.json` | modify | Coefficients, `confounded`, `effectWindow`, corrected `measured_effect`. The source of truth. |
| `rules.js` | regenerate | Tier A branch; one settings bucket; `effectWindow` honoured. |
| `tools/build-rules.mjs` | modify | Emit the above; carry `rates`/`settings` through. |
| `sim.js` | modify | Read the one settings bucket; make `moundDeltaFt` reachable. |
| `tools/lib/spine.mjs` | modify | `leagueLine(year, league)`; four missing per-PA KPIs; an era-window sigma. |
| `tools/calibrate-era.mjs` | create | The harness. Runs arms, measures, writes the report. |
| `docs/decisions/2026-09-18-era-rules/calibration-2026-09-25.md` | create | The committed measurement, with every band and refusal named. |
| `tests/rules-direction.test.js` | create | Per-rule sign check, 600 games. |
| `tests/rules-calibration.test.js` | create | The historical claim at 2σ. Skips without `data/`. |
| `tests/rules-resolve.test.js` | modify | Tier A composition; one-bucket shape; expiry; the dead-key regression. |
| `tests/rules-identity.test.js`, `tests/mound.test.js` | modify | A non-zero mound delta COMBINED with live modifiers. |
| `tests/rules-catalog.test.js` | modify | `rates`/`sources`/`confounded`/`effectWindow`/`engines` integrity. |
| `tests/spine-query.test.js` | modify | The league filter and the new KPIs. |
| `ui.js`, `index.html` | modify | The era select and the rules panel. |

---

## Task 1: Collapse the two dead buckets into one

**Files:** modify `tools/build-rules.mjs`, regenerate `rules.js`, modify
`sim.js`, modify `tests/rules-resolve.test.js`

Three options, and the middle one is the trap:

| option | cost | verdict |
|---|---|---|
| Keep both, wire `structural` → `tunables` inside `resolve()` | one line, but two names for one payload survive and the next reader still has to learn which is which | **no** |
| Keep both as distinct concerns — flags in `structural`, numeric thresholds in `tunables` | two producers, two consumers, two fallback policies, and the distinction is not load-bearing: `sim.js` can read `settings.sacFly` exactly as easily | **no** |
| **One bucket.** `composeModifiers` writes `settings`; `resolve()` returns it; `sim.js` reads it | one rename in one generator, one consumer, three tests | **yes** |

The name is `settings` — not `structural`, not `tunables`. Both existing names
are now attached to a specific wrong memory (one never read, one never written),
and reusing either invites the reader to assume the old behaviour. The rename is
free today because neither key carries data; it costs a migration in phase 3.

**Interfaces:**
- `composeModifiers(ruleList, year)` → `{ modifiers, declared, settings }`
- `resolve(selection)` → `{ ids, settings, modifiers, declared }` — **four keys,
  no `structural`, no `tunables`**
- `sim.js` `settingsFor(rules)` replaces `tunables(rules)`: reads
  `rules.settings`, falls back per key to `TUNABLE_DEFAULTS` (`sim.js:41-43`,
  `{ stretch1B: 0.32, stretch2B: 0.22, sacFly: 0.26, doublePlay: 0.13 }`).

- [ ] **Step 1: Write the failing test.** Append to `tests/rules-resolve.test.js`:

```js
// ---- one settings bucket, and the dead keys stay dead ----
const r1973 = R.resolve({ year: 1973 });
check('resolve returns a settings bucket',
  r1973.settings && typeof r1973.settings === 'object');
check('resolve no longer returns the phase-1 structural key',
  !('structural' in r1973), JSON.stringify(Object.keys(r1973)));
check('resolve no longer returns the phase-1 tunables key',
  !('tunables' in r1973), JSON.stringify(Object.keys(r1973)));

// The regression this task exists to prevent: a Tier A setting composed and
// then dropped on the floor between composeModifiers and resolve. Phase 1
// discarded it silently -- no throw, no red test -- and the rule still
// appeared in `ids`, so the UI would list it as active while it did nothing.
const composed = R.composeModifiers(R.forYear(1973).active, 1973);
for (const k of Object.keys(composed.settings)) {
  check(`composed setting ${k} survives resolve()`,
    Object.hasOwn(r1973.settings, k),
    `composeModifiers produced ${k}; resolve dropped it`);
}
```

- [ ] **Step 2: Run it to verify it fails.** `node tests/rules-resolve.test.js`

- [ ] **Step 3: Implement it.** In `tools/build-rules.mjs`, in the emitted
      `composeModifiers`, rename `structural` to `settings` and replace the
      phase-1 placeholder comment (`rules.js:1791`) with the Tier A branch:

```js
      if (r.tier === 'A' && r.settings) {
        for (const [k, v] of Object.entries(r.settings)) {
          /* Last rule wins, and the list is year-ascending, so a later repeal
           * overrides an earlier enactment. This is the ONE place composition
           * is order-DEPENDENT and it has to be: the 1931 abolition of the
           * sacrifice fly and its 1954 reinstatement are two entries touching
           * one key, and the answer for 1960 is the 1954 one. Tier B
           * multipliers stay order-independent -- do not unify them. */
          settings[k] = v;
        }
      }
```

Then `resolve()` returns `{ ids: active.map((r) => r.id), settings, modifiers,
declared }`. In `sim.js`, rename `tunables(rules)` → `settingsFor(rules)`,
read `rules.settings`, update both call sites (`sim.js:145,179`).

- [ ] **Step 4: Verify.** `node tools/build-rules.mjs && node tools/run-tests.mjs`
      — 27/27, and `tests/rules-identity.test.js` green. This task renames a key
      on an empty object and must not move a box score.

- [ ] **Step 5: Pin the order-dependence.** Add two synthetic Tier A rules
      touching one key in different years and assert the LATER year wins in both
      forward and reversed input order. This asymmetry between the two buckets
      must be pinned, or a future refactor will "fix" it into order-independence
      and quietly restore the 1931 sacrifice-fly rule in 1960.

---

## Task 2: Make `adjustedRates → applyModifiers` reachable, then test it

**Files:** modify `sim.js`, `tests/mound.test.js`, `tools/capture-identity.mjs`,
`tests/fixtures/identity-golden.json`

- [ ] **Step 1: Write the failing test** in `tests/mound.test.js`, using a real
      mound delta AND a live modifier — the combination no existing test makes:

```js
// ---- the composition, end to end ----
// adjustedRates() and applyModifiers() are each unit-tested. Their
// COMPOSITION inside plateAppearance has never run: sim.js passed a literal 0
// for the delta, and every rules test used makeStarter(250), whose moundDist
// is hardcoded 60.5. This is the first call that exercises both.
const loudMods = { hr: 2, k: 1, bb: 1, s1: 1, d2: 1, d3: 1 };
const near = S.adjustedRates(batter, -8);            // mound 8ft closer
const both = S.applyModifiers(near, loudMods);
check('composition differs from either half alone',
  both.hr !== near.hr);
// Written to fail LOUDLY rather than pass vacuously: if the clamp binds, say
// so, because a clamped coefficient makes its own calibration unfalsifiable.
const clamped = Math.abs(both.hr - near.hr * 2) > 1e-9;
check('the clamp is not swallowing the effect', !clamped,
  `expected ${near.hr * 2}, got ${both.hr} -- the non-out clamp bound, so any `
  + 'calibration assertion on this arm is measuring the clamp, not the rule');
```

- [ ] **Step 2: Run it to verify it fails.** `node tests/mound.test.js`
- [ ] **Step 3: Implement it.** Replace the hardcoded `0` at `sim.js:188` with
      the caller's delta; thread `cfg.moundDeltaFt ?? 0`. `DEFAULT_CFG.moundDeltaFt`
      is `0`, so the classic default path is unchanged.
- [ ] **Step 4: Add the golden fixture case** at a non-regulation mound distance
      with rules off. **Append** to `tests/fixtures/identity-golden.json`; never
      rewrite existing entries. If an existing entry moves, stop — `moundDeltaFt`
      is leaking into the default path.
- [ ] **Step 5: Verify.** 27/27, existing golden entries byte-identical.

---

## Task 3: Say where a Tier A setting applies, because it is not everywhere

**Files:** modify catalog, `tests/rules-catalog.test.js`, the spec's §4

`graphsim.js` and `trisim.js` never call `tunables()`/`settingsFor()`. Grep them
for `stretch1B`, `sacFly`, `doublePlay` and nothing comes back. Only `sim.js`'s
classic path reads the bucket — and the graph and tri engines are what the 3D
field and the multi-plate formats use.

| option | blast radius | verdict |
|---|---|---|
| Wire `settingsFor()` into graph/tri advancement | `resolveBallOut` decides advancement from travel times, not a probability threshold. There is no `stretch1B` there — the concept does not exist. Adding one means a second advancement model beside the physical one, and it puts the fielding-errors margin model at risk. Days. | **not this phase** |
| Let Tier A apply in the classic engine only, silently | a user picks 1973, sees the DH listed, switches to the 3D field and it is not in effect. Nothing says so. | **no — the dishonest option** |
| **Apply where modelled, and say where** | one `engines` field per Tier A entry, rendered in the panel. Hours. | **yes** |

The precedent is `coverage.json` refusing to omit an unavailable KPI: an absent
statement reads as "this does not exist", which is different from and worse than
"we do not model this here."

Useful fact from the Tier A audit — two of the five need no engine work at all:
`2020-seven-inning-doubleheader-games-2020-202` is already expressible as
`cfg.innings = 7` (`sim.js:20,259,271`), and
`1920-all-runs-count-on-a-game-ending-home-run` is already the legacy default
(`sim.js:229`) — what does not exist is the PRE-1920 behaviour, which would need
a new branch to truncate scoring at the winning run. Only
`2020-automatic-runner-on-second-base-in-extra` needs a genuinely new state
init (`bases[1]` seeded when `ctx.inning > cfg.innings`, against
`sim.js:182`'s always-empty `bases`).

- [ ] **Step 1:** Add `engines: ["classic"]` (or the true list) to each Tier A
      entry; assert every Tier A entry carries it and every value is one of
      `classic`/`graph`/`tri`.
- [ ] **Step 2:** Render it in the rules panel (Task 10).
- [ ] **Step 3:** Update the spec's §4 to record Tier A as classic-only in phase
      2, with the reason, so phase 3 does not rediscover it.

---

## Task 4: The four missing KPIs — the calibration has no yardstick for two-thirds of its rates

**Files:** modify `tools/lib/spine.mjs`, `tests/spine-query.test.js`

§5.2 wants a constraint per rate. `KPIS` (`tools/lib/spine.mjs:35-78`) maps onto
`RATE_KEYS` like this:

| rate | KPI today | usable? |
|---|---|---|
| `bb` | `walk_rate` = `sum(bb)/sum(pa)` | **yes** |
| `k` | `strikeout_rate` = `sum(so)/sum(pa)` | yes, except 1900-1909 where `so` is NULL |
| `hr` | `home_runs_per_game` = `sum(hr)/sum(g)` | **no — per GAME, not per PA** |
| `s1` | none | **no** |
| `d2` | none (`slugging` blends it with `d3`/`hr`) | **no** |
| `d3` | none | **no** |

Four of six rate keys have no sigma denominator, and `hr`'s is the wrong
denominator in exactly the way Finding 5 describes. Without this task the 2σ
threshold can only be applied to `bb`.

- [ ] **Step 1:** Write failing tests for four new KPIs — `single_rate`,
      `double_rate`, `triple_rate`, `home_run_rate` — each `sum(x)/sum(pa)`, with
      singles as `sum(h - d2 - d3 - hr)/sum(pa)`. Assert `home_run_rate` for 2023
      is ≈ .0319 (the measured value) and that it is NOT equal to
      `home_runs_per_game`.
- [ ] **Step 2:** Add them to `KPIS` with correct `requires` arrays, so
      `requireKpis()` refuses a year that cannot compute them. **`KPIS` is the
      single definition** — `sigma()` computes from it and `build-coverage.mjs`
      measures from it, so adding here updates both. Do not add a second copy.
- [ ] **Step 3:** Re-run `node tools/build-coverage.mjs`; the new KPIs must appear
      in `coverage.json` with honest `missingYears`. Keep the existing eleven's
      reported values unchanged.
- [ ] **Step 4:** Assert `strikeout_rate.missingYears` contains 1901 and 1903, so
      Task 8's refusal for the foul-strike rule is data-driven rather than
      hardcoded.

---

## Task 5: `leagueLine(year, league)` — without it, 1931 is not a diff-in-diff

**Files:** modify `tools/lib/spine.mjs`, `tests/spine-query.test.js`

`leagueLine(year)` sums every club in a season with no league filter. The 1931
deadened ball is the one true natural experiment in the catalog **because the NL
deadened its ball and the AL did not**, while both leagues shared that year's
bounce-HR and sacrifice-fly rule changes. The diff-in-diff is NL's HR decline
against the AL's, and it cannot be computed from a league-wide sum.

The measured gap proves the point: MLB-wide 1930→31 `hr` is x0.712; the catalog
cites x0.553 because that figure is NL-only. Calibrating x0.553 against a
MLB-wide measurement fails by 29% for a reason that has nothing to do with the
coefficient.

- [ ] **Step 1:** Write a failing test: `leagueLine(1931, 'NL')` and
      `leagueLine(1931, 'AL')` return different `clubs` counts, and their `hr`
      sums add to the unfiltered call's.
- [ ] **Step 2:** Add an optional `league` parameter, **validated like every
      other**: an allow-list, not an interpolated string. `spine.mjs` already
      throws rather than interpolating raw input and carries SQL-injection
      payloads as regressions in `tests/spine-query.test.js`; a new parameter
      that skips that is a new hole in the same wall.
- [ ] **Step 3:** Add `leagueLine(1931, "NL' OR '1'='1")` to the injection
      regressions.
- [ ] **Step 4:** Note in the report that pre-1900 league scope is its own
      question (the 1889 rule is `league: "NL and AA"`), and that a single-league
      figure must never be compared against a two-league measurement.

---

## Task 6: Sigma needs an era window, and the default silently gives the wrong one

**Files:** modify `tools/lib/spine.mjs`, `tests/spine-query.test.js`

`sigma(stat, from = 1950, to = 2024)` (`tools/lib/spine.mjs:378`). **Seven of the
twelve rules land before 1950** (1889, 1893, 1901, 1903, 1910, 1920, 1931).
Calling `sigma('walk_rate')` for an 1889 rule does not throw and does not warn —
it returns a real number computed over 1950-2024, measuring modern year-to-year
noise against a rule from an era whose true noise is roughly half again as large
(0.371 runs/game across 1876-2025 against 0.2538 for the modern window, per
§5.3). The rule is then ranked against the wrong yardstick with nothing going
red.

- [ ] **Step 1:** Write a failing test showing `sigma(stat)` and
      `sigma(stat, 1876, 2025)` differ materially for at least one stat, and that
      a calibration caller cannot obtain a sigma without stating a window.
- [ ] **Step 2:** Add `sigmaFor(stat, year, halfWidth)` that picks a window
      around the rule's year and **returns the window alongside the value**. Do
      not change `sigma()`'s existing default out from under its current callers;
      add beside it.
- [ ] **Step 3:** The calibration report records the window for every rule. A
      band without its window is not a result.

---

## Task 7: An effect that expires — the one thing the catalog cannot express

**Files:** modify catalog, `tools/build-rules.mjs`, regenerate `rules.js`,
`tests/rules-catalog.test.js`, `tests/rules-resolve.test.js`

`forYear(year)` (`rules.js:1717-1722`) filters on `r.year <= year`. It is
cumulative with no expiry, so a coefficient on a 1910 rule applies in 2026.

The cork-centre ball raised `hr`/PA by x1.410 in 1911 — and the effect reverts by
1914 as pitchers adapted, which the catalog's own `measured_effect` already
states ("then decayed back to ~3.7 by 1914 as pitchers adapted"). The honest
window is 1911-1913. Attach x1.41 with no window and every season from 1911 to
2026 carries a permanent 41% home-run bonus the real 1914 season had given back.

**The category error to avoid:** a second catalog entry at 1914 that multiplies
`hr` back down. The catalog is a catalog of **rules**, and "pitchers learned to
scuff the ball" is not a rule. A fake 1914 entry would appear in the rules panel,
be listed as in effect, and link to sources describing no such rule — the same
dishonesty as omitting an unavailable KPI, pointed the other way.

| option | cost | verdict |
|---|---|---|
| Fake a 1914 repeal entry | trivial, and it puts a rule in the UI that never existed | **no** |
| Demote 1910 to Tier C | honest, but discards a well-sourced x1.41 that really happened for three seasons | **no** |
| **`effectWindow` on the entry**, honoured in composition | one optional field, one filter clause, two tests. One entry, still Tier B, and the UI can say "modelled 1911-1913, effect reverted by adaptation" | **yes** |

- [ ] **Step 1: Write the failing test** in `tests/rules-resolve.test.js`:

```js
// ---- an effect that expires ----
// forYear is cumulative: r.year <= year, no expiry. A rule whose EFFECT is
// temporary (the 1910 cork ball, given back by 1914 through pitcher
// adaptation rather than by any rule) would carry its coefficient to 2026.
// The RULE stays in effect -- the ball was never un-corked -- but its
// MODELLED coefficient must stop.
const m1912 = R.resolve({ year: 1912 }).modifiers;
const m1920 = R.resolve({ year: 1920 }).modifiers;
check('1912 carries the cork-ball home-run coefficient', m1912.hr > 1.2,
  `hr = ${m1912.hr}`);
check('1920 does NOT still carry it', m1920.hr < m1912.hr,
  `1920 hr = ${m1920.hr}, 1912 hr = ${m1912.hr} -- an expired effect is `
  + 'still applied 8 years later');
check('the cork-ball rule is still listed as in effect in 1920',
  R.resolve({ year: 1920 }).ids.some((id) => id.startsWith('1910-cork')));
```

- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement it.** Add optional `effectWindow: [first, last]`. Skip
      a Tier B rule's `rates` when the resolved year falls outside it — which is
      why `composeModifiers` gains an explicit `year` argument in Task 1. Pass it;
      do not infer it from the rule list, and keep the function pure.
- [ ] **Step 4:** Assert any entry with an `effectWindow` has
      `effectWindow[0] >= year`, carries a `model_note` explaining what ended the
      effect, and that the reason is not described as a rule change.
- [ ] **Step 5:** The panel renders the window.

---

## Task 8: Coefficients into the catalog

**Files:** modify catalog, regenerate `rules.js`, modify
`tests/rules-catalog.test.js`

**Calibrate the per-PA multipliers from Finding 5, not the published figures.**
Each entry records both, plus its sources.

Note the catalog splits several of §8's named "rules" into two entries each, and
the plan must address them as they exist:

- foul-strike is `1901-foul-strike-rule-nl` **and** `1903-foul-strike-rule-al`
- 1920 is `1920-spitball-and-all-doctored-pitches-banned` **and**
  `1920-clean-ball-rule-dead-ball-live-ball-brea`, whose own
  `measured_effect` strings say they are not separable from each other
- 1969 is `1969-mound-lowered-15-in-10-in` **and**
  `1969-strike-zone-shrunk-back-to-armpits-top-o`, which §5.4 rule 2 already
  requires be calibrated jointly with no solo coefficient

**Order of work, easiest-to-verify first** (note this is NOT the order the
research suggested — see Finding 4):

1. **1963 enlarged zone.** `bb` x0.893, `k` x1.088, both observable, single
   variable, and the measured values land within 5% of the published ones. This
   is the soundest starting point and it validates the harness itself.
2. **1969 mound + zone, as a joint pair.** `bb` x1.195, `k` x0.958. Assert the
   signs **mirror** 1963 — they do — but **do not assert the magnitudes mirror**:
   `bb` -10.7% against +19.5%, `k` +8.8% against -4.2%. The asymmetry is
   expected, because 1969 bundles the mound drop, which pushes `bb` up and `k`
   down on its own. Confounded with four-team expansion; band, not point.
3. **1931 deadened ball**, once Task 5 lands. NL against AL is the one true
   diff-in-diff. Fit the NL-only `hr` multiplier and use the AL as the
   rules-only floor.
4. **2023 shift ban.** `s1`/BABIP only. **Explicitly do NOT fit the `hr` x1.115**
   — that is the ball rebounding from 2022's deadening, and attributing it to a
   fielding rule is the confound made concrete. `confounded: true`, ball named.
5. **1889 four balls.** `bb` **x1.481**, not the x1.73 the raw counts imply. **No
   `k` coefficient**: 1888 `so`/PA .0501 → 1889 .0907 → 1890 .0521 is a
   tabulation artifact, not an effect, and a walk-count change cannot do that.
6. **1901/1903 foul-strike.** Its real effect is on `k` and **the spine cannot
   measure `k` for either year** — `so` is NULL 1900-1909. Fit on the observable
   rates; carry the sourced `k` coefficient with an explicit
   `unverifiable_against_spine: true` and a reason. **This must be a stated
   refusal, not a silent skip** — an unasserted coefficient that looks asserted
   is the worst of the three outcomes.
7. **1910 cork ball.** `hr` x1.410 with `effectWindow: [1911, 1913]` from Task 7.
8. **1893 rubber** and **1920 clean ball / spitball ban** — `confounded: true`,
   direction and band only. 1893 is entangled with league contraction, a 150→130
   game schedule change and a roster-age shift; 1920 with ball construction and
   the Ruth-emulation effect, and the grandfathered spitballers' own composite
   ERA barely moved, which argues the ban was not the driver.
9. **2001 QuesTec — x1.00, and correct the catalog's sentence.** The entry
   currently claims "the walk drop is the cleanest signal of a taller enforced
   zone". The spine confirms `bb` x0.881, but the park-level natural experiment
   (QuesTec parks against non-QuesTec parks, same season, ~1,500 games) measures
   K/BF 17.44% vs 17.63% and BB/BF 8.84% vs 8.75% — about one altered call per
   475 pitches, not significant. **The walk drop is real and QuesTec is not why.**
   Fix the `measured_effect` string, ship x1.00 or demote to Tier C, and record
   the park-level experiment as the source. A null result from a real experiment
   is a finding, not a gap.

**The two DH rules are Tier A and are deferred to Task 11.** They carry no rate
coefficient at all.

**So: seven rules get fitted coefficients, three are documented refusals (1893,
1920, 2001), and two are deferred (both DHs). The spec's §8 says twelve; §8 gets
corrected.** Twelve was a target, not a quota, and reaching it by invention is
the failure mode this entire plan is shaped against.

- [ ] **Step 1:** One commit per rule, so a bad coefficient is one `git revert`.
- [ ] **Step 2:** `node tools/build-rules.mjs` after each. Never hand-edit.
- [ ] **Step 3:** Assert every entry with `rates` carries `sources` and
      `confidence_effect`; every `confounded: true` names its confound in
      `model_note`; every `unverifiable_against_spine` names which rate and why.
- [ ] **Step 4: Watch the clamps.** Measured against the 2021-2025 pool: the
      non-out clamp binds at x7.09 on `bb` and x5.10 on `s1` for the average
      batter, but at **x3.09 for Yasmani Grandal** (bb/PA .240) and **x3.04 for
      Luis Arraez** (s1/PA .259). No coefficient here approaches those. But if
      the calibration iterates per-batter rather than per-league-aggregate, an
      extreme-profile regular can clamp while the league average does not — and
      a clamped arm makes its own assertion unfalsifiable. Decide which the
      harness does, and state it.

---

## Task 9: `tests/rules-direction.test.js` — the sign check

600 games per rule. The rates a rule claims move the documented way; the rates it
does not claim stay within noise. Cheap, and it catches an inverted coefficient —
the most likely error in Task 8.

- [ ] **Assert on the rates a rule does NOT claim**, not only the ones it does. A
      coefficient in the wrong key produces an entirely plausible box score and
      nothing else in the suite would notice.
- [ ] 2023 must move `s1` and must **not** move `hr`. That is Finding 5's
      confound turned into an assertion.

---

## Task 10: `tests/rules-calibration.test.js` and the era UI

- [ ] 5000 games per arm, proportional deltas at §5.3's 2σ, against a sigma whose
      window comes from Task 6 and is recorded with the result.
- [ ] A banded rule asserts its band; a `confounded: true` rule asserts direction
      plus band. Record the realised value beside the target **even when green** —
      a pass sitting at the band edge is information, and the verdict alone
      discards it.
- [ ] Era select defaults to "no era rules (current)", so the page loads into the
      published run environment.
- [ ] Panel groups by tier; Tier C shows its decline reason; entries link
      sources; Task 3's `engines` and Task 7's `effectWindow` both render.
- [ ] Mobile: a `.panel` with a scrolling body, capped like `.pbp-panel` at
      360px.
- [ ] **Measure the suite's runtime.** 5000 games per arm across seven rules may
      push `tools/run-tests.mjs` past a minute. If it does, the fix is a seeded
      subset by default and the full sweep behind a flag — decide with a
      measurement, not a guess.

---

## Task 11: Scope the DH, then stop

**Files:** a design note only. No engine change in this phase.

Both DH rules are Tier A `LINEUP`. Their modelled effect is "replace a
.110-hitting pitcher with a league-average bat" — and `data.js` ships nine real
batters per club with **no pitcher batting line**, so there is nothing to
replace. `side.lineup` (`sim.js:236`) has no pitcher slot.

This is the largest unsolved dependency in the catalog and it sits under the two
**highest**-confidence rules in it (1973 DH: AL runs/team-game 3.47→4.28 with the
unchanged NL as a same-year control, isolating roughly 0.6 R/G — as clean an
estimate as this project will ever get).

- [ ] Write the note: what synthetic line, sourced from where, and how it enters
      a lineup without moving the nine real batters or the published run
      environment. The spine has real pitcher batting lines (`role: 'pit'`) for
      every season, which is the obvious source and needs its own sourcing
      decision about which years and what aggregation.
- [ ] Do not implement it here. Folding it in would put two
      high-confidence rules behind the phase's largest unknown, and the seven
      Tier B coefficients do not depend on it.

---

## Task 12: The measurement pass — mandatory, not satisfiable by reading

Instrument the engine and count. Required per calibrated rule:

- [ ] The realised multiplier on **all six** rates, not only the claimed one.
- [ ] The clamp-bind rate, per rate and per batter profile.
- [ ] The share of plate appearances whose outcome actually changed. A rule that
      hits its target rate while changing almost no outcomes is fitting the
      aggregate rather than the mechanism.
- [ ] Runs/game for the default configuration, confirming it has not moved.

A reviewer who only reads diffs cannot sign off this phase.

---

## Phase 2 exit criteria

- [ ] One settings bucket. `structural` and `tunables` appear nowhere in
      `rules.js` or `sim.js`, and a composed Tier A setting provably survives
      `resolve()`.
- [ ] `adjustedRates → applyModifiers` executes in a committed test, with an
      explicit assertion that the clamp is not swallowing the effect.
- [ ] A golden fixture case at a non-zero mound delta, every pre-existing entry
      byte-identical.
- [ ] Four per-PA KPIs (`single_rate`, `double_rate`, `triple_rate`,
      `home_run_rate`) in `KPIS` and in `coverage.json`, with honest
      `missingYears`; the existing eleven's reported values unchanged.
- [ ] `leagueLine(year, league)` with its league value allow-listed and an
      injection regression beside the existing two.
- [ ] An expired effect provably stops: the 1910 coefficient is absent in 1920
      while the 1910 rule is still listed as in effect.
- [ ] Seven rules green at 2σ, each against a sigma whose window is recorded.
- [ ] Three documented refusals (1893, 1920, 2001 QuesTec), each Tier C or
      `confounded: true` with its confound named; the foul-strike rule's `k`
      coefficient explicitly flagged unverifiable against the spine.
- [ ] Two DH rules scoped and deferred, with the synthetic-line question written
      down.
- [ ] The spec's §8 corrected from twelve to seven-plus-three-plus-two, and its
      `measured_effect` for 2001 QuesTec corrected.
- [ ] The measurement pass has run and names the realised multiplier on all six
      rates for every rule.
- [ ] Default configuration byte-identical. 29/29 test files pass.

## Self-review notes

- Five things in the handoff and the spec were wrong or incomplete, and two of
  them would have shipped a wrong number in silence: the 1910 coefficient
  applying for 115 extra seasons, and every per-PA coefficient fitted from a
  per-game published figure. Both were found by measuring, not by reading —
  which is the same way the fielding-errors design error was found, and the
  reason Task 12 exists.
- The biggest single correction is that the research's own multipliers were not
  usable as given. 1889's walk effect is x1.48 per PA against x1.73 on raw
  counts; 1931's HR is x0.712 MLB-wide against the catalog's NL-only x0.553.
  Neither gap is a sourcing error — they are answers to a different question
  than the one `RATE_KEYS` asks.
- The rule I first nominated to calibrate FIRST, on the grounds that a wrong
  coefficient would have nowhere to hide, turns out to be the one rule whose
  effect the spine cannot measure at all. That inversion is worth remembering:
  "cleanest natural experiment in the literature" and "verifiable against our
  data" are independent properties.
- Two `k` multipliers in the measured table (1889's x1.810, 1893's x0.621) are
  almost certainly tabulation artifacts rather than effects, on the evidence of
  the surrounding years. They are excluded rather than modelled. If a later
  phase wants pre-1900 strikeout rates, that is a spine question first.
- Not verified: whether the calibration harness should iterate real rostered
  batters or a synthetic league-average line. It changes whether the clamp binds
  (x3.04 for Arraez against x5.10 for the average), and it is a real fork, not a
  detail. Task 8 Step 4 makes it an explicit decision rather than an accident.

———
Generated by claude-opus-5 · task completed
