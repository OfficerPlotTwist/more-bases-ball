# Fielding errors — design

**Date:** 2026-09-23
**Status:** approved in chat, spec awaiting review
**Scope:** fielding errors in the graph and tri engines, derived from the
defense's existing travel-time margin rather than a flat per-chance rate.

## 1. What this builds

Today the defense is deterministic geometry. A fly ball is caught if the
fielder gets under it and dropped if he does not:

```js
// graphsim.js:349
const caught = !grounder && assign.tReach <= contact.distFt / HIT_FTS;
```

That line already computes the two quantities a real difficulty model needs —
how long the ball hangs and how long the fielder takes to get there — and then
throws the margin between them away by thresholding at zero. This design keeps
the quantity and replaces the threshold.

Define **slack**, in seconds:

```
slack = contact.distFt / HIT_FTS  -  assign.tReach
        └─ hang time ─┘             └─ fielder's travel ─┘
```

Positive slack means the fielder is waiting for the ball. Negative means he is
still running when it lands. This is the same input Statcast's Catch
Probability is built on: ground to cover against time available.

## 2. The finding that reshaped the design

The obvious model — error probability rises as the play gets harder — is
wrong, and MLB's own scoring rule is why.

Rule 9.12 charges an error only on a play **ordinary effort** would have made,
judged against an average fielder. Anything beyond ordinary effort is scored a
hit *no matter how badly it was botched*. A fielder who gets a glove on a
diving stop and drops it is charged nothing. A fielder who boots a routine
two-hopper is charged an error.

So official errors are structurally capped at the **easy** end of the
difficulty range. A single monotonic curve from difficulty to error would
produce shortstops booting diving stops and almost never muffing routine
grounders — exactly backwards.

**Therefore: two curves, from the same slack number, with different shapes.**

| | Governs | Shape in slack | A failure is scored |
|---|---|---|---|
| `catchChance(slack)` | does he come up with it | rises monotonically | **hit** |
| `muffChance(slack)` | does he butcher a play he had | zero below ordinary effort, peaks just above it, decays | **error** |

The two are sampled independently. Catch chance replaces the binary threshold
at `graphsim.js:349`. Muff chance is new.

## 3. The curves

### 3.1 `catchChance(slack)` — logistic

```
catchChance(slack) = 1 / (1 + exp(-K * slack))     K = 5.2
```

Anchored to MLB's published 5-star bands (5★ = 0-25% catch probability,
4★ = 26-50%, 3★ = 51-75%, 2★ = 76-90%, 1★ = 91-95%, no-star > 95%) and to the
one hard observed figure available: of 2,688 five-star opportunities in 2025,
192 were caught — **7.1%**.

| slack | catchChance | star band | reading |
|---|---|---|---|
| −0.50 s | 0.069 | 5★ | he is half a second late; 7% matches the observed 7.1% |
| −0.25 s | 0.214 | 5★ | |
| 0.00 s | 0.500 | 3★/4★ edge | arrives exactly as it lands |
| +0.25 s | 0.786 | 2★ | |
| +0.50 s | 0.931 | 1★ | |
| +1.00 s | 0.995 | no-star | routine |

`K = 5.2` is chosen so that slack = −0.5 s lands on the observed 5★ rate. It is
the only free parameter in this curve and it is pinned by a measurement.

### 3.2 `muffChance(slack)` — gated decay

```
muffChance(slack) = 0                                        if slack < ORDINARY
                  = E0 * exp(-(slack - ORDINARY) / DECAY)     otherwise

ORDINARY = 0.25 s      DECAY = 0.90 s      E0 = calibrated, see §4
```

Below `ORDINARY` the play is not one an average fielder routinely makes, so by
Rule 9.12 no error can be charged; a failure there is already handled by
`catchChance` and scored a hit. Above it, the muff risk is highest right at the
edge of ordinary effort and decays as the play gets easier — a fielder camped
under a lazy fly is far safer than one arriving just in time to be expected to
make it.

This is monotone decreasing above the gate rather than a symmetric hump. That
is deliberate: a hump needs a third parameter and the data does not support
locating a peak. The gate itself supplies the asymmetry the scoring rule
requires.

### 3.3 Grounders have no hang time

`slack` as defined needs a ball in the air. For a grounder
(`contact.distFt < 150`, `graphsim.js:283`) the analogous quantity is the
defense's spare time at the bag:

```
groundSlack = batterRunSec - playTime(bs.first)
```

Both terms already exist — `playTime` at `graphsim.js:337`, and the batter's
run time is computed the same way the relay check computes `bT` at
`graphsim.js:413`. Positive means the defense has time in hand, which is what
"routine" means on a ground ball. The same two curves apply to it unchanged.

## 4. Calibration

**Target: 0.53 errors per team-game** (2024; 0.52 in 2023, a record low). This
is the primary and only binding target. It is well sourced and directly
countable in a simulated game.

`E0` is the single free parameter and is fitted to that number: simulate
N = 2000 games on the classic 3-base starter layout, count charged errors,
divide by team-games, and solve for `E0`.

**Tolerance is +/- 0.05 errors per team-game.** Two things set it. Monte Carlo
noise at 2000 games is small — 4000 team-games at a rate of 0.53 gives a
Poisson standard error of 0.0115, so +/- 0.05 is 4.3 SE and will not flap.
Real season-to-season movement is the larger term: the league ran 0.52, 0.53
and 0.53 across 2022-2024, so a band narrower than about +/- 0.03 would be
asserting more precision than the sport itself has. 0.05 clears both.

**Reached-on-error is a sanity check only, not a target.** The research
produced ~1.1-1.2% of plate appearances, but that figure is a division
performed by the researching agent rather than a published statistic, and it is
recorded here as unverified. A test may assert ROE is in a loose band; it must
not drive calibration.

**The historical arc is noted and deliberately not built.** Errors per
team-game ran 3.04 (1894) → 1.71 (1908) → 1.5 (1917) → 0.53 (2024), roughly
sixfold. That arc is glove and groundskeeping history, and it belongs to the
era-rules layer as a future Tier B rule scaling `E0`. This design ships the
modern value only. Wiring it to the era catalog is out of scope.

## 5. What an error does

The research could not find a base-advancement distribution following an error,
nor a throwing-versus-fielding split. So this design invents neither.

**An error adds time.** A muffed play adds `BOBBLE_S = 0.8 s` to the moment the
defense can act, and everything downstream flows through the `playTime` and
`margin` machinery that already exists. Runners advance exactly as far as the
existing physics lets them against a defense that has lost most of a second.
Nothing about advancement is fabricated; the field decides it.

`BOBBLE_S = 0.8` is the one number here without a source. It is set as a
declared modelling assumption — comparable in size to `TRANSFER_S = 0.3`
(`graphsim.js:63`) plus a re-gather — and the calibration in §4 is run against
errors charged, not runs allowed, so an imperfect bobble time changes how much
damage an error does without changing how often one occurs.

The play carries `entry.sub = 'E'`, joining the existing `CUT`, `FC`, `DP`,
`SF`, `ITP`, `CROWD` and `NOPATH` tags, so the play-by-play and the box score
can report it with no new plumbing.

## 6. Where the code goes, and the invariant it must not break

`fielders.js:238` states: *"No randomness anywhere: the same layout and the
same bags always give the same assignment."* That invariant is load-bearing —
`tests/fielders.test.js` and `tests/defense-stress.test.js` both depend on the
assignment being a pure function of geometry.

**It stays true.** The split:

- **`fielders.js` gains the two curves as pure functions** — `catchChance(slack)`
  and `muffChance(slack)`. Numbers in, number out, no `rnd`. The file remains
  deterministic and its comment remains accurate.
- **`graphsim.js` does the sampling.** It already owns every random draw in the
  defense — three of them, at `graphsim.js:389`, `:399` and `:416`.

So the determinism boundary does not move. One file decides how likely, the
other decides what happened.

## 7. Determinism and the default

New `rnd()` calls in `resolveBallOut` shift the graph and tri engines' random
streams. Every aggregate assertion over those engines would move: the
`cw > own × 1.3` band (`tests/graphsim.test.js`), `any` outscoring `origin`
(`tests/trisim.test.js`), the sac-fly rate band and tag-up ceiling
(`tests/runners.test.js`), the small-field-outscores-big check
(`tests/anim.test.js`), and the eight pathological layouts in
`tests/defense-stress.test.js`.

**So errors ship behind a config flag, default off**, exactly as the era-rules
layer did. With the flag off, zero new draws are consumed and all 25 existing
test files pass unchanged. The classic engine (`sim.js`) does not use
`resolveBallOut` at all, so the frozen box scores and
`tests/fixtures/identity-golden.json` are untouched by construction.

**The default is decided after measurement, not now.** Once the flag works and
`E0` is calibrated, a follow-up step re-runs the existing aggregate bands with
errors on and reports which move and by how much. Flipping the default is that
step's decision, made against numbers. Turning it on blind would either break
five test files or, worse, quietly shift a run environment nobody re-measured.

## 8. Testing

One new file, `tests/errors.test.js`, joining the existing 25.

- **Curve shape, pure and cheap.** `catchChance` is monotone increasing, lands
  on 0.069 at slack −0.5 and 0.5 at slack 0. `muffChance` is exactly 0 below
  `ORDINARY`, positive immediately above it, monotone decreasing above that, and
  never exceeds `E0`.
- **The scoring rule holds.** Over a long run, no play with slack below
  `ORDINARY` is ever charged an error, and plays above it are. This is the Rule
  9.12 property stated as a test.
- **Calibration.** 2000 games on the starter layout with errors on yields
  errors per team-game in 0.48-0.58 (0.53 +/- 0.05, per §4).
- **Off is inert.** With the flag off, a fixed seed produces byte-identical
  output to the pre-change engine, and the existing 25 files pass.
- **On does something.** With the flag on, at least one charged error appears
  across a modest number of games, and a deliberately high `E0` visibly moves
  the error count — the wiring-is-real proof the era-rules work established as
  the house pattern.

## 9. What this explicitly does not do

- **No per-fielder skill.** `oaa` and `arm` are the obvious next layer —
  `FIELD_FTS = 24` (`fielders.js:32`) gives every fielder identical speed and
  `THROW_FTS = 135` (`graphsim.js:20`) gives every fielder an identical arm. Both
  should become per-player, and `docs/superpowers/plans/2026-09-23-statcast-coverage.md`
  identifies them as claimed by this work. They are deliberately not in this
  design: the league-average curves have to be right before a skill term is
  layered on one, or the two will be fitted against each other.
- **No throwing-versus-fielding error distinction.** Unsourced; one error type.
- **No per-position error rates.** The research could not produce citable
  magnitudes, only the qualitative ordering that shortstop and third base run
  highest. Positions are not modelled here.
- **No era scaling.** §4 records the arc and leaves it to the era layer.
- **No change to the classic engine.** `sim.js` has no defense to err.

---

Generated by claude-opus-5 · task completed
