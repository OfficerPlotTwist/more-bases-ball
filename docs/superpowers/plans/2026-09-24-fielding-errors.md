# Fielding Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fielding errors emerge from the travel-time margin the defense already computes, so a fielder camped under a lazy fly is safe and one arriving just in time is not — calibrated to 0.53 errors per team-game.

**Architecture:** Two pure curves in `fielders.js` map a seconds-of-slack number to a catch probability (rising) and a muff probability (gated at zero below ordinary effort, then decaying). `graphsim.js` — which already owns every random draw in the defense — samples them. The whole thing sits behind a config flag that is null by default, so with errors off not one extra `rnd()` is consumed and all 25 existing test files pass untouched.

**Tech Stack:** Vanilla ES2020 in browser-compatible IIFEs (CommonJS `module.exports` fallback for tests), Node 20+ test scripts using the project's hand-rolled `check()` harness.

**Spec:** `docs/superpowers/specs/2026-09-23-fielding-errors-design.md`

## Global Constraints

- **`fielders.js` stays deterministic.** Its comment at `fielders.js:238` reads *"No randomness anywhere: the same layout and the same bags always give the same assignment."* That must remain true. The curves go there as pure functions; every `rnd()` call stays in `graphsim.js`.
- **Errors off ⇒ zero new random draws.** With `cfg.errors` falsy the engines must consume exactly the draws they consume today, in the same order. This is what keeps the 25 existing test files green.
- **`sim.js` is not touched.** The classic engine has no defense; `tests/fixtures/identity-golden.json` and `tests/ngon.test.js` are untouched by construction.
- **`data.js` is not touched.**
- **No new runtime dependencies.** `package.json` gains nothing.
- **Do not reorder or restructure the three existing random draws** in `resolveBallOut` at `graphsim.js:389`, `:399` and `:416`.
- **Calibration target: 0.53 errors per team-game, tolerance ±0.05** (band 0.48–0.58). From the spec §4: 4.3σ of Monte Carlo noise at 2000 games, and wider than the league's own 2022–2024 spread of 0.52/0.53/0.53.
- **Curve constants, verbatim from spec §3:** `CATCH_K = 5.2`, `ORDINARY_S = 0.25`, `MUFF_DECAY_S = 0.90`, `BOBBLE_S = 0.8`.
- **Write LF line endings.** This repo has `core.autocrlf=true`; verify LF in committed content (`sed -i 's/\r$//'` if needed).
- **Test style:** CommonJS `require`, the local `check(label, ok, detail)` helper, `process.exit(failures === 0 ? 0 : 1)` at the end. Copy the shape from `tests/mound.test.js`.
- **Test count goes 25 → 26.** One new file, `tests/errors.test.js`.

## Review Focus

Five conditions the spec implies but does not test. Each has a test assigned to the task that owns the code.

1. **No fielder available.** `fielders.js:245` returns `tReach: Infinity` when there is nobody to send. Slack becomes `-Infinity`. Both curves must return a clean `0`, never `NaN`. A `NaN` here silently becomes "not caught, not an error" and would be invisible. → Task 1.
2. **NaN coordinates.** `tests/defense-stress.test.js` feeds layouts with NaN positions. Slack becomes `NaN`. Both curves must return `0` rather than propagating. → Task 1.
3. **A grounder with no batter start.** On a plates-only layout `L.batterStart()` returns null, so there is no bag to compute ground slack against. The value must be `null`, and `muffChance(null)` must be `0`, not a throw. → Task 4.
4. **Extreme layouts.** The 80 ft and 900 ft fields in `tests/defense-stress.test.js` produce enormous positive and negative slack. `muffChance` must stay within `[0, E0]` and `catchChance` within `[0, 1]` across that whole range. → Task 1.
5. **Errors on with `e0: 0`.** A caller may enable the flag with a zero rate. No error may be charged, but the draws must still be consumed so the stream stays deterministic and reproducible from a seed. → Task 5.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `fielders.js` | modify | Gains `catchChance(slack)` and `muffChance(slack, e0)` as pure functions plus their three constants. Stays free of `rnd`. |
| `graphsim.js` | modify | `resolveBallOut` gains a 12th parameter, computes slack, samples both curves, applies the bobble. `playHalf` forwards `cfg.errors`. |
| `trisim.js` | modify | `playHalfTri` forwards `cfg.errors` to the same shared `resolveBallOut`. |
| `tests/errors.test.js` | create | Curve shape, the Rule 9.12 property, inertness when off, wiring proof when on, calibration. |

`trisim.js` destructures `resolveBallOut` from `graphsim.js` at `trisim.js:21`, so there is one implementation to change and two call sites to update.

---

### Task 1: The two curves, pure

**Files:**
- Modify: `fielders.js` (add constants and two functions; extend the exported `API` object at `fielders.js:305-309`)
- Test: `tests/errors.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `F.catchChance(slack)` → number in `[0, 1]`. `slack` in seconds.
  - `F.muffChance(slack, e0)` → number in `[0, e0]`.
  - `F.CATCH_K` = 5.2, `F.ORDINARY_S` = 0.25, `F.MUFF_DECAY_S` = 0.90.

- [ ] **Step 1: Write the failing test**

Create `tests/errors.test.js`:

```js
/* Fielding errors. Run: node tests/errors.test.js */
'use strict';
const path = require('path');
const F = require(path.join(__dirname, '..', 'fielders.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---- catchChance: anchored on Statcast's published 5-star bands ----
// The one hard figure available: 192 of 2688 five-star chances were
// caught in 2025, 7.1%. That is what pins CATCH_K at slack = -0.5s.
const CATCH_TABLE = [
  [-0.50, 0.069], [-0.25, 0.214], [0.00, 0.500],
  [0.25, 0.786], [0.50, 0.931], [1.00, 0.995],
];
let tableOk = true;
for (const [slack, want] of CATCH_TABLE) {
  if (Math.abs(F.catchChance(slack) - want) > 0.001) tableOk = false;
}
check('catchChance matches the calibrated table', tableOk,
  CATCH_TABLE.map(([s]) => F.catchChance(s).toFixed(3)).join(' '));

let mono = true;
for (let s = -3; s < 3; s += 0.05) {
  if (F.catchChance(s + 0.05) < F.catchChance(s)) mono = false;
}
check('catchChance is monotone increasing', mono);

check('catchChance stays inside [0,1] over a wide range',
  [-50, -5, 0, 5, 50].every((s) => {
    const v = F.catchChance(s);
    return Number.isFinite(v) && v >= 0 && v <= 1;
  }));

// ---- muffChance: Rule 9.12 -- no error below ordinary effort ----
const E0 = 0.05;
check('muffChance is exactly 0 below ordinary effort',
  [0, 0.1, 0.2, 0.249].every((s) => F.muffChance(s, E0) === 0));

check('muffChance is positive at and just above ordinary effort',
  F.muffChance(F.ORDINARY_S, E0) > 0 && F.muffChance(0.3, E0) > 0);

check('muffChance peaks at the ordinary-effort edge',
  Math.abs(F.muffChance(F.ORDINARY_S, E0) - E0) < 1e-12,
  `${F.muffChance(F.ORDINARY_S, E0)}`);

let decays = true;
for (let s = F.ORDINARY_S; s < 6; s += 0.05) {
  if (F.muffChance(s + 0.05, E0) > F.muffChance(s, E0)) decays = false;
}
check('muffChance decays above the gate', decays);

check('muffChance never exceeds e0',
  [-10, 0, 0.25, 1, 10, 100].every((s) => F.muffChance(s, E0) <= E0 + 1e-12));

// ---- Review Focus 1, 2 and 4: degenerate and extreme inputs ----
// fielders.js returns tReach: Infinity when nobody can be sent, and
// defense-stress feeds layouts with NaN coordinates. A NaN leaking out
// of either curve would read as "not caught, not an error" and be
// invisible rather than loud.
check('no fielder (slack -Infinity): catch 0, muff 0',
  F.catchChance(-Infinity) === 0 && F.muffChance(-Infinity, E0) === 0);

check('unbounded time (slack +Infinity): catch 1, muff 0',
  F.catchChance(Infinity) === 1 && F.muffChance(Infinity, E0) === 0);

check('NaN slack yields 0 from both curves, never NaN',
  F.catchChance(NaN) === 0 && F.muffChance(NaN, E0) === 0);

check('null and undefined slack yield 0, never NaN',
  F.catchChance(null) === 0 && F.muffChance(null, E0) === 0 &&
  F.catchChance(undefined) === 0 && F.muffChance(undefined, E0) === 0);

check('missing e0 means no muff', F.muffChance(1, undefined) === 0);

// extreme layouts: 80ft and 900ft fields produce huge slack either way
let extremeOk = true;
for (const s of [-200, -50, 50, 200]) {
  const c = F.catchChance(s), m = F.muffChance(s, E0);
  if (!Number.isFinite(c) || c < 0 || c > 1) extremeOk = false;
  if (!Number.isFinite(m) || m < 0 || m > E0) extremeOk = false;
}
check('extreme layouts keep both curves in range', extremeOk);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/errors.test.js
```

Expected: FAIL — `F.catchChance is not a function`

- [ ] **Step 3: Implement the curves**

In `fielders.js`, add immediately above the `const API = {` line (`fielders.js:305`):

```js
  /* ---- fielding difficulty -------------------------------------------
   * Both functions are PURE: numbers in, a number out, no rnd. The
   * sampling lives in graphsim.js, which already owns every random draw
   * in the defense. That is what keeps the "No randomness anywhere"
   * contract above true, and tests/fielders.test.js and
   * tests/defense-stress.test.js both depend on it.
   *
   * `slack` is seconds to spare: the ball's hang time minus the time the
   * fielder needs to reach it. Positive means he is waiting for it.
   */
  const CATCH_K = 5.2;        // pinned by the observed 5-star catch rate
  const ORDINARY_S = 0.25;    // below this, Rule 9.12 forbids an error
  const MUFF_DECAY_S = 0.90;  // how fast a routine play gets safe

  /* Probability he comes up with it. Anchored on Statcast's published
   * 5-star bands (5* = 0-25% caught, 4* = 26-50%, 3* = 51-75%, 2* =
   * 76-90%, 1* = 91-95%) and on the one hard figure published: 192 of
   * 2688 five-star chances were caught in 2025, 7.1%. CATCH_K = 5.2 is
   * chosen so slack = -0.5s lands on that 7.1%. A failure here is a HIT.
   */
  function catchChance(slack) {
    if (typeof slack !== 'number' || Number.isNaN(slack)) return 0;
    if (slack === Infinity) return 1;
    if (slack === -Infinity) return 0;
    return 1 / (1 + Math.exp(-CATCH_K * slack));
  }

  /* Probability he butchers a play he actually had. Zero below ordinary
   * effort: MLB Rule 9.12 charges an error only where ordinary effort
   * would have made the play, so a failure on anything harder is scored
   * a hit and never an error. That gate is why this curve is not simply
   * the inverse of catchChance -- real errors concentrate at the EASY
   * end. Above the gate the risk is highest right at the edge of
   * ordinary effort and decays as the play gets more routine.
   * A failure here is an ERROR.
   */
  function muffChance(slack, e0) {
    if (typeof e0 !== 'number' || !Number.isFinite(e0) || e0 <= 0) return 0;
    if (typeof slack !== 'number' || !Number.isFinite(slack)) return 0;
    if (slack < ORDINARY_S) return 0;
    return e0 * Math.exp(-(slack - ORDINARY_S) / MUFF_DECAY_S);
  }
```

Then extend the exported API at `fielders.js:305-309` — add to the existing object, do not replace it:

```js
    fielderSlots, assignPlay, covererFor, travelSec, splitEvenly,
    catchChance, muffChance, CATCH_K, ORDINARY_S, MUFF_DECAY_S,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/errors.test.js
```

Expected: PASS on all checks.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `26/26 test files passed`. Nothing else changed, so the other 25 must be untouched.

- [ ] **Step 6: Commit**

```bash
git add fielders.js tests/errors.test.js
git commit -m "feat: add the two fielding-difficulty curves

catchChance rises with the seconds a fielder has to spare; its failures
are hits. muffChance is zero below ordinary effort, peaks at that edge
and decays; its failures are errors.

They are not inverses of each other, and that is the point. Rule 9.12
charges an error only where ordinary effort would have made the play,
so a botched diving stop is a hit and a booted routine grounder is an
error -- real errors concentrate at the easy end of the range.

Both are pure. fielders.js keeps its no-randomness contract; the
sampling will live in graphsim.js, which already owns every random draw
in the defense.

CATCH_K = 5.2 is pinned by the one hard published figure: 192 of 2688
five-star chances caught in 2025, 7.1%, at slack = -0.5s."
```

---

### Task 2: Thread the flag, inert

Plumbing only. After this task the flag exists, reaches `resolveBallOut`, and does nothing.

**Files:**
- Modify: `graphsim.js:281` (signature), `:717-718` (call site), `:668` (geo — no change needed, documented below)
- Modify: `trisim.js:156-157` (call site)
- Test: `tests/errors.test.js` (append)

**Interfaces:**
- Consumes: `cfg.errors` — either `null`/`undefined` (off) or `{ e0: number }`.
- Produces: `resolveBallOut(occ, batter, plate, target, layout, paths, entry, rnd, canMove, contact, slots, errCfg)` — `errCfg` appended as the 12th parameter.

- [ ] **Step 1: Write the failing test**

Append to `tests/errors.test.js`, before its final `console.log`:

```js
// ---- the flag reaches the engines without changing anything ----
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));

const LAD = TEAMS[0], NYY = TEAMS[1];
const ring = L.makeStarter(250);

function graphBox(cfg, seed) {
  const g = G.simGameGraph(NYY, LAD, ring, cfg, seed);
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter]),
  });
}
function triBox(cfg, seed) {
  const g = T.simGameTri(NYY, LAD, ring, cfg, seed);
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter]),
  });
}

const SEEDS = [7, 42, 99, 1234, 20260924];
const BASE = { innings: 9, outs: 3 };

let graphMoved = 0, triMoved = 0;
for (const seed of SEEDS) {
  if (graphBox(BASE, seed) !== graphBox(Object.assign({}, BASE, { errors: null }), seed)) graphMoved++;
  if (triBox(BASE, seed) !== triBox(Object.assign({}, BASE, { errors: null }), seed)) triMoved++;
}
check('graph engine: errors:null is identical to no errors key', graphMoved === 0,
  graphMoved ? `${graphMoved} seed(s) diverged` : '');
check('tri engine: errors:null is identical to no errors key', triMoved === 0,
  triMoved ? `${triMoved} seed(s) diverged` : '');

// The 12th parameter must exist so later tasks can use it.
check('resolveBallOut accepts a 12th parameter', G.resolveBallOut.length === 12,
  `arity ${G.resolveBallOut.length}`);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/errors.test.js
```

Expected: FAIL on `resolveBallOut accepts a 12th parameter` — arity is 11.

- [ ] **Step 3: Thread the parameter**

In `graphsim.js`, change the signature at line 281 from:

```js
  function resolveBallOut(occ, batter, plate, target, layout, paths, entry, rnd, canMove, contact, slots) {
```

to:

```js
  function resolveBallOut(occ, batter, plate, target, layout, paths, entry, rnd, canMove, contact, slots, errCfg) {
```

Leave the body completely alone in this task.

At the call site, `graphsim.js:717-718`, change:

```js
        outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
          rnd, () => true, entry.contact, slots);
```

to:

```js
        outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
          rnd, () => true, entry.contact, slots, cfg.errors || null);
```

In `trisim.js:156-157`, change:

```js
          outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
            rnd, canMove, entry.contact, slots);
```

to:

```js
          outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
            rnd, canMove, entry.contact, slots, cfg.errors || null);
```

`cfg` is already in scope at both call sites — `graphsim.js`'s `playHalf` receives it as its fifth parameter and `trisim.js`'s `playHalfTri` as its sixth. No other signature changes.

Note `geo` at `graphsim.js:668` and `trisim.js:84` needs no change: `resolveBallOut` does not take `geo`, it takes explicit parameters.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/errors.test.js
```

Expected: PASS on all checks, including the arity check.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `26/26 test files passed`. The parameter is accepted and unused, so no behaviour can have changed.

- [ ] **Step 6: Commit**

```bash
git add graphsim.js trisim.js tests/errors.test.js
git commit -m "refactor: thread an errors config to resolveBallOut

Appended as a 12th parameter and not yet read, so that when behaviour
does change in the next tasks the cause is unambiguous. Both engines
forward cfg.errors; trisim shares graphsim's implementation, so there
is one function to change and two call sites.

26/26 test files pass; the parameter is inert."
```

---

### Task 3: Catch probability replaces the binary threshold

**Files:**
- Modify: `graphsim.js:349` and the `tCatch` line at `:304`
- Test: `tests/errors.test.js` (append)

**Interfaces:**
- Consumes: `F.catchChance(slack)` from Task 1; `errCfg` from Task 2.
- Produces: a `slack` local in `resolveBallOut`, available to Task 4.

- [ ] **Step 1: Write the failing test**

Append to `tests/errors.test.js`, before its final `console.log`:

```js
// ---- catch sampling changes outcomes only when enabled ----
const ON = Object.assign({}, BASE, { errors: { e0: 0.05 } });
let onMoved = 0;
for (const seed of SEEDS) {
  if (graphBox(BASE, seed) !== graphBox(ON, seed)) onMoved++;
}
check('graph engine: enabling errors DOES change the game (wiring is real)',
  onMoved > 0, `${onMoved}/${SEEDS.length} seed(s) diverged`);

// Same seed, same config, twice -- the added draws must be deterministic.
check('graph engine: errors on is still seed-reproducible',
  graphBox(ON, 7) === graphBox(ON, 7));
check('tri engine: errors on is still seed-reproducible',
  triBox(ON, 7) === triBox(ON, 7));
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/errors.test.js
```

Expected: FAIL on `enabling errors DOES change the game` — 0 seeds diverge, because `errCfg` is still unused.

- [ ] **Step 3: Sample the catch**

In `graphsim.js`, the line at `:349` currently reads:

```js
    const caught = !grounder && assign.tReach <= contact.distFt / HIT_FTS;
```

Replace it with:

```js
    /* How many seconds the fielder has to spare. This is the same number
     * the old binary test compared against zero -- Statcast's catch
     * probability is built on exactly this: ground to cover against time
     * available. With errors off the threshold behaves as it always did
     * and consumes no draw. */
    const hangSec = contact.distFt / HIT_FTS;
    const slack = hangSec - assign.tReach;
    const caught = !grounder && (errCfg
      ? rnd() < F.catchChance(slack)
      : assign.tReach <= hangSec);
```

The `errCfg ?` guard is load-bearing: with errors off no `rnd()` is called, so the stream is untouched.

`tCatch` at `graphsim.js:304` already computes `Math.max(contact.distFt / HIT_FTS, assign.tReach) + GLOVE_S`. Leave it exactly as it is in this task; Task 4 adds the bobble to it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/errors.test.js
```

Expected: PASS, with several seeds diverging when errors are on.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `26/26 test files passed`. If `tests/graphsim.test.js`, `tests/trisim.test.js`, `tests/runners.test.js`, `tests/anim.test.js` or `tests/defense-stress.test.js` goes red, the `errCfg ?` guard is missing or inverted — a draw is being consumed with errors off.

- [ ] **Step 6: Commit**

```bash
git add graphsim.js tests/errors.test.js
git commit -m "feat: sample catch probability from the fielder's slack

The binary test at graphsim.js:349 already subtracted the fielder's
travel time from the ball's hang time and then threw the difference
away. It is kept now and called slack, and with errors enabled the
catch is sampled from it rather than thresholded at zero.

With errors off the old comparison runs and no draw is consumed, so
every existing aggregate band is untouched."
```

---

### Task 4: The muff, the bobble, and the E tag

**Files:**
- Modify: `graphsim.js` — add `BOBBLE_S`, compute ground slack, sample the muff, feed the bobble into `tCatch`
- Test: `tests/errors.test.js` (append)

**Interfaces:**
- Consumes: `F.muffChance(slack, e0)` from Task 1; `slack` from Task 3.
- Produces: plays tagged `entry.sub = 'E'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/errors.test.js`, before its final `console.log`:

```js
// ---- errors are actually charged, and tagged ----
function countSubs(cfg, seeds, tag) {
  let n = 0, plays = 0;
  for (const seed of seeds) {
    const g = G.simGameGraph(NYY, LAD, ring, cfg, seed);
    for (const e of g.log) { plays++; if (e.sub === tag) n++; }
  }
  return { n, plays };
}

const LOUD = Object.assign({}, BASE, { errors: { e0: 0.9 } });
const loud = countSubs(LOUD, [1, 2, 3, 4, 5, 6, 7, 8], 'E');
check('a high e0 charges errors, tagged E', loud.n > 0,
  `${loud.n} error(s) in ${loud.plays} plays`);

const none = countSubs(BASE, [1, 2, 3, 4, 5, 6, 7, 8], 'E');
check('errors off charges none', none.n === 0, `${none.n}`);

// Review Focus 5: enabled with a zero rate. No errors, but the draws
// are still consumed, so the run stays reproducible from its seed.
const ZERO = Object.assign({}, BASE, { errors: { e0: 0 } });
const zero = countSubs(ZERO, [1, 2, 3, 4, 5, 6, 7, 8], 'E');
check('e0 of 0 charges no error', zero.n === 0, `${zero.n}`);
check('e0 of 0 is still seed-reproducible', graphBox(ZERO, 7) === graphBox(ZERO, 7));

// Rule 9.12 as a property: an error is only ever charged on a play the
// defense had time for. A charged error on a ball nobody could reach
// would be a scoring impossibility.
const bigE0 = Object.assign({}, BASE, { errors: { e0: 0.9 } });
let impossible = 0, charged = 0, inspected = 0;
for (let seed = 1; seed <= 25; seed++) {
  const g = G.simGameGraph(NYY, LAD, ring, bigE0, seed);
  for (const e of g.log) {
    if (e.sub !== 'E') continue;
    charged++;
    // NOTE: tReach lives on entry.defense (graphsim.js:309-312), NOT on
    // the entry itself. Reading e.tReach yields undefined, the guard
    // below goes false for every play, and this check passes while
    // asserting nothing. That is the failure mode this comment exists
    // to prevent.
    const d = e.defense;
    if (e.contact && d && Number.isFinite(d.tReach)) {
      inspected++;
      const sl = e.contact.distFt / 110 - d.tReach;
      const ground = e.contact.distFt < 150;
      if (!ground && sl < F.ORDINARY_S) impossible++;
    }
  }
}
// The guard must actually have fired, or the check above is vacuous.
check('Rule 9.12 check actually inspected some plays', inspected > 0,
  `inspected ${inspected} of ${charged} charged`);
check('no fly-ball error is charged below ordinary effort (Rule 9.12)',
  impossible === 0, `${impossible} impossible of ${inspected} inspected`);

// Review Focus 3: a layout with no batter start must not throw or NaN.
const platesOnly = L.makeStarter(250);
platesOnly.nodes = platesOnly.nodes.filter((n) => platesOnly.homes.some((h) => h.id === n.id));
platesOnly.edges = [];
let survived = true;
try {
  G.simGameGraph(NYY, LAD, platesOnly, LOUD, 3);
} catch (e) { survived = false; }
check('a layout with no batter start survives errors being on', survived);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/errors.test.js
```

Expected: FAIL on `a high e0 charges errors, tagged E` — no play is ever tagged `E`.

- [ ] **Step 3: Implement the muff**

In `graphsim.js`, add to the constants near `:63` (`const GLOVE_S = 0.15, TRANSFER_S = 0.3;`):

```js
  /* What a muff costs in seconds. No base-advancement distribution for
   * errors was sourceable, so none is invented: a botched play simply
   * costs the defense most of a second and the runners take whatever the
   * existing margin machinery then gives them. Comparable in size to
   * TRANSFER_S plus a re-gather. Calibration is against errors CHARGED,
   * not runs allowed, so this number changes how much an error hurts
   * rather than how often one happens. */
  const BOBBLE_S = 0.8;
```

In `resolveBallOut`, immediately after the `const slack = ...` line added in Task 3, insert:

```js
    /* A grounder has no hang time, so its "routine-ness" is the seconds
     * the defense has in hand at the batter's bag instead. Computed from
     * the same pieces playTime uses, but without depending on tCatch --
     * the bobble feeds tCatch, so this must be knowable first. Null when
     * there is no bag to throw to, and muffChance treats null as zero. */
    const groundSlack = (grounder && bs)
      ? runSec(batter, ftBetween(posOf(layout, plate), posOf(layout, bs.first)), true)
        - (assign.tReach + TRANSFER_S + throwSec(ftBetween(contact, posOf(layout, bs.first))))
      : null;

    const muffed = !!errCfg &&
      rnd() < F.muffChance(grounder ? groundSlack : slack, errCfg.e0);
    if (muffed) entry.sub = 'E';
```

`bs` is already in scope — it is computed at `graphsim.js:284`.

**One consequence worth knowing about.** `entry.defense.tSecure` is set to
`tCatch` at `graphsim.js:313`, and AGENTS.md is explicit that `buildAnim` must
time every throw off `tSecure` rather than off raw flight time — that coupling
is what stopped the ball leaving before the fielder arrived on 58% of throws,
and `tests/anim.test.js` guards it. Adding the bobble to `tCatch` therefore
flows into the animation automatically: a muffed play visibly delays the throw.
That is correct and wanted. Do not try to keep `tSecure` free of the bobble.

Then feed the bobble into the clock. `graphsim.js:304` currently reads:

```js
    const tCatch = Math.max(contact.distFt / HIT_FTS, assign.tReach) + GLOVE_S;
```

Change it to:

```js
    const tCatch = Math.max(contact.distFt / HIT_FTS, assign.tReach) + GLOVE_S
      + (muffed ? BOBBLE_S : 0);
```

**Ordering matters.** `tCatch` at `:304` is computed before `slack` at `:349` in the current file. Move the `slack` / `groundSlack` / `muffed` block to sit immediately *before* the `tCatch` line, and leave the `caught` line at `:349` reading the `slack` computed above. Everything between is untouched. Verify by reading the function top to bottom after editing: `assign` → `slack` → `groundSlack` → `muffed` → `tCatch` → `playTime` → `caught`.

Also record the two values the Rule 9.12 test reads, next to the existing `tReach` on the entry at `graphsim.js:312`:

```js
      tReach: assign.tReach,
```

is already there, and `entry.contact` is already set by the caller. No change needed.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/errors.test.js
```

Expected: PASS on all checks.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `26/26 test files passed`. With errors off, `muffed` is `false` without calling `rnd()` — the `!!errCfg &&` short-circuit is what guarantees that. If other files go red, that short-circuit was written the other way round.

- [ ] **Step 6: Commit**

```bash
git add graphsim.js tests/errors.test.js
git commit -m "feat: charge fielding errors, tagged E

A muffed play costs the defense BOBBLE_S and nothing else. No
advancement distribution for errors was sourceable, so none is
invented -- runners take whatever the existing margin machinery gives
them against a defense that lost most of a second.

Grounders have no hang time, so their slack is the seconds the defense
has in hand at the batter's bag, computed without depending on tCatch
because the bobble feeds tCatch.

The Rule 9.12 property is asserted directly: no fly-ball error is ever
charged below ordinary effort."
```

---

### Task 5: Calibrate e0 to 0.53 errors per team-game

**Files:**
- Modify: `graphsim.js` (export a default `ERROR_E0`)
- Test: `tests/errors.test.js` (append)

**Interfaces:**
- Consumes: everything above.
- Produces: `G.ERROR_E0` — the fitted default rate, a number.

- [ ] **Step 1: Find the value**

This step is measurement, not implementation. Run a sweep:

```bash
node -e "
const L=require('./layout.js'), G=require('./graphsim.js'), {TEAMS}=require('./data.js');
const ring=L.makeStarter(250), LAD=TEAMS[0], NYY=TEAMS[1];
for (const e0 of [0.01,0.02,0.03,0.04,0.05,0.07,0.10]) {
  let errs=0, teamGames=0;
  for (let s=1;s<=400;s++){
    const g=G.simGameGraph(NYY,LAD,ring,{innings:9,outs:3,errors:{e0}},s);
    for (const e of g.log) if (e.sub==='E') errs++;
    teamGames+=2;
  }
  console.log('e0',e0.toFixed(3),'->',(errs/teamGames).toFixed(3),'errors/team-game');
}
"
```

Pick the `e0` whose rate is nearest 0.53 and refine with a second sweep at finer spacing around it. Record the chosen value and its measured rate in the commit message. 400 games is enough to choose; the test below uses 2000 to assert.

- [ ] **Step 2: Write the failing test**

Append to `tests/errors.test.js`, before its final `console.log`:

```js
// ---- calibration: 0.53 errors per team-game, +/- 0.05 ----
// Target and tolerance from the spec: 0.53 is the 2024 league rate
// (0.52 in 2023). The band is 4.3 sigma of Monte Carlo noise at 2000
// games and wider than the league's own 2022-2024 spread, so it will
// not flap but would catch a real miscalibration.
const CAL_GAMES = 2000;
let calErrs = 0;
for (let seed = 1; seed <= CAL_GAMES; seed++) {
  const g = G.simGameGraph(NYY, LAD, ring, {
    innings: 9, outs: 3, errors: { e0: G.ERROR_E0 },
  }, seed);
  for (const e of g.log) if (e.sub === 'E') calErrs++;
}
const perTeamGame = calErrs / (CAL_GAMES * 2);
check('errors per team-game is 0.53 +/- 0.05',
  perTeamGame >= 0.48 && perTeamGame <= 0.58,
  `${perTeamGame.toFixed(3)} (${calErrs} errors in ${CAL_GAMES * 2} team-games)`);

check('ERROR_E0 is a finite positive number',
  typeof G.ERROR_E0 === 'number' && Number.isFinite(G.ERROR_E0) && G.ERROR_E0 > 0,
  `${G.ERROR_E0}`);
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node tests/errors.test.js
```

Expected: FAIL — `G.ERROR_E0` is `undefined`.

- [ ] **Step 4: Export the fitted value**

In `graphsim.js`, beside `BOBBLE_S`, add — substituting the number found in Step 1 for `<FITTED>`:

```js
  /* Fitted so the graph engine charges 0.53 errors per team-game, the
   * 2024 league rate (0.52 in 2023, a record low). Measured over 2000
   * games on the 250ft starter ring; tests/errors.test.js re-measures it
   * and fails outside 0.48-0.58.
   *
   * The historical arc is steep and deliberately NOT modelled here:
   * 3.04 errors per team-game in 1894, 1.71 in 1908, 1.5 in 1917, 0.53
   * today. That is glove and groundskeeping history and it belongs to
   * the era-rules layer as a rule that scales this constant. */
  const ERROR_E0 = <FITTED>;
```

Add `ERROR_E0` and `BOBBLE_S` to the exported API object near `graphsim.js:822`, extending the existing list rather than replacing it.

- [ ] **Step 5: Run the test to verify it passes**

```bash
node tests/errors.test.js
```

Expected: PASS, printing the measured rate. If it lands outside the band, return to Step 1 and refine `e0` — do **not** widen the band.

- [ ] **Step 6: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `26/26 test files passed`.

- [ ] **Step 7: Commit**

```bash
git add graphsim.js tests/errors.test.js
git commit -m "feat: calibrate the error rate to 0.53 per team-game

Fitted over 2000 games on the 250ft starter ring against the 2024
league rate. The test re-measures and fails outside 0.48-0.58, which is
4.3 sigma of Monte Carlo noise at that sample size and wider than the
league's own 2022-2024 spread of 0.52/0.53/0.53.

The 1894-to-today arc -- 3.04 errors per team-game down to 0.53 -- is
recorded in a comment and left to the era-rules layer, which is where a
rule that scales this constant belongs."
```

---

## What this plan does NOT do

- **It does not flip the default.** `cfg.errors` stays null unless a caller sets it. Turning errors on by default would move the aggregate bands in `tests/graphsim.test.js`, `tests/trisim.test.js`, `tests/runners.test.js`, `tests/anim.test.js` and `tests/defense-stress.test.js`, and the spec (§7) is explicit that this decision is made after measuring which move and by how much. That measurement is a follow-up, not a task here.
- **It does not add per-fielder skill.** `oaa` and `arm` stay unused. `FIELD_FTS = 24` still gives every fielder the same speed and `THROW_FTS = 135` the same arm. The league-average curves must be right before a skill term is layered on one.
- **It does not add a UI control.** Nothing in `index.html` or `ui.js` changes; the flag is reachable from code and tests only.
- **It does not distinguish throwing from fielding errors,** model per-position rates, or scale by era. All three are unsourced or out of scope per spec §9.

## Self-review notes

**Spec coverage.** §2 two curves → Task 1. §3.1 catchChance → Tasks 1, 3. §3.2 muffChance → Tasks 1, 4. §3.3 ground slack → Task 4. §4 calibration → Task 5. §5 bobble and the E tag → Task 4. §6 purity split → Task 1 (curves in `fielders.js`, sampling in `graphsim.js` at Tasks 3 and 4). §7 flag and default → Task 2, and the default is explicitly deferred above. §8 testing → all five tasks.

**Naming consistency.** `catchChance(slack)` and `muffChance(slack, e0)` are defined in Task 1 and called with exactly those signatures in Tasks 3 and 4. `errCfg` is the parameter name from Task 2 onward. `slack`, `hangSec`, `groundSlack`, `muffed` are introduced in Tasks 3 and 4 and used nowhere earlier. `ERROR_E0` and `BOBBLE_S` are exported from `graphsim.js`.

**Review Focus coverage.** 1, 2 and 4 (degenerate and extreme slack) → Task 1 Step 1. 3 (no batter start) → Task 4 Step 1. 5 (`e0: 0`) → Task 4 Step 1.

**One bug caught in self-review.** The Rule 9.12 test first read `e.tReach`,
which is always `undefined` — the value lives at `entry.defense.tReach`. The
guard would have gone false for every play and the check would have passed
while inspecting nothing. Fixed, and an `inspected > 0` assertion now sits
beside it so the same class of vacuity cannot come back silently.

**One known soft spot.** `ORDINARY_S = 0.25` decides whether a failed play is an error or a hit, and no source gives that boundary in seconds — it is judgement. It sets the ratio of errors to hits among failures, so if Task 5's calibration cannot reach 0.53 at any sensible `e0`, this constant is the first thing to suspect, not `e0`.

---

Generated by claude-opus-5 · task completed
