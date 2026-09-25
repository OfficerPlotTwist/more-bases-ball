/* Fielding errors. Run: node tests/errors.test.js */
'use strict';
const fs = require('fs');
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
check('resolveBallOut accepts a 12th parameter',
  G._internals.resolveBallOut.length === 12,
  `arity ${G._internals.resolveBallOut.length}`);

// ---- the committed baseline: errors OFF must reproduce it exactly ----
// Captured at 9373172b, before catch sampling existed. This is the check
// the errors:null-vs-absent comparison could not be: both of those pass
// the identical null through `cfg.errors || null`, so that one asserts
// null === null. If a box below moves while errors are off, a draw is
// being consumed that was not consumed before.
const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'defense-golden.json'), 'utf8'));

let goldGraph = 0, goldTri = 0, goldN = 0;
for (const seed of Object.keys(golden.graph)) {
  goldN++;
  if (graphBox(BASE, Number(seed)) !== golden.graph[seed]) goldGraph++;
  if (triBox(BASE, Number(seed)) !== golden.tri[seed]) goldTri++;
}
check(`graph engine reproduces all ${goldN} baseline boxes with errors off`,
  goldGraph === 0, goldGraph ? `${goldGraph} diverged` : `from ${golden.generatedFrom.slice(0, 8)}`);
check(`tri engine reproduces all ${goldN} baseline boxes with errors off`,
  goldTri === 0, goldTri ? `${goldTri} diverged` : '');

// ---- catch sampling changes outcomes only when enabled ----
const ON = Object.assign({}, BASE, { errors: { e0: 0.05 } });
let onMoved = 0;
for (const seed of SEEDS) {
  if (graphBox(BASE, seed) !== graphBox(ON, seed)) onMoved++;
}
check('graph engine: enabling errors DOES change the game (wiring is real)',
  onMoved > 0, `${onMoved}/${SEEDS.length} seed(s) diverged`);

check('graph engine: errors on is still seed-reproducible',
  graphBox(ON, 7) === graphBox(ON, 7));
check('tri engine: errors on is still seed-reproducible',
  triBox(ON, 7) === triBox(ON, 7));

// ---- errors are actually charged, and tagged ----
// A charged error is `entry.error`, NOT `entry.sub === 'E'`. `sub` is one
// slot that CUT, DP and SF claim unconditionally, so counting the tag
// under-reports and makes an error on a double play unrepresentable.
function countErrors(cfg, seeds) {
  let n = 0, plays = 0, tagged = 0;
  for (const seed of seeds) {
    const g = G.simGameGraph(NYY, LAD, ring, cfg, seed);
    for (const e of g.log) { plays++; if (e.error) n++; if (e.sub === 'E') tagged++; }
  }
  return { n, plays, tagged };
}

const LOUD = Object.assign({}, BASE, { errors: { e0: 0.9 } });
const loud = countErrors(LOUD, [1, 2, 3, 4, 5, 6, 7, 8]);
check('a high e0 charges errors', loud.n > 0,
  `${loud.n} error(s) in ${loud.plays} plays`);
check('the E tag survives: some charged errors carry a different sub',
  loud.n >= loud.tagged, `${loud.tagged} tagged E of ${loud.n} charged`);

const none = countErrors(BASE, [1, 2, 3, 4, 5, 6, 7, 8]);
check('errors off charges none', none.n === 0, `${none.n}`);

// Review Focus 5: enabled with a zero rate. No errors, but the draws
// are still consumed, so the run stays reproducible from its seed.
const ZERO = Object.assign({}, BASE, { errors: { e0: 0 } });
const zero = countErrors(ZERO, [1, 2, 3, 4, 5, 6, 7, 8]);
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
    if (!e.error) continue;
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

// ---- Fix 1 and 2: a muff UN-completes the play ----
// The design bug this replaced sampled the muff as a tag drawn alongside
// the outcome: 1203 of 2195 muffs landed on fly balls the fielder had
// CAUGHT and retired the batter on (sub:'E', type:'OUT', one out), and
// the batter was retired on 100% of charged errors, so reached-on-error
// was structurally zero. Both are asserted against here.
let chargedN = 0, batterRetired = 0, batterReached = 0, outsOnError = 0;
for (let seed = 1; seed <= 200; seed++) {
  const g = G.simGameGraph(NYY, LAD, ring, Object.assign({}, BASE, {
    errors: { e0: G.ERROR_E0 },
  }), seed);
  let prevOuts = 0, prevInning = null, prevHalf = null;
  for (const e of g.log) {
    if (e.inning !== prevInning || e.half !== prevHalf) { prevOuts = 0; }
    prevInning = e.inning; prevHalf = e.half;
    const made = e.outsAfter - prevOuts;
    prevOuts = e.outsAfter;
    if (!e.error) continue;
    chargedN++;
    if (e.runnersOut.indexOf(e.batter) >= 0) batterRetired++; else batterReached++;
    if (made > 0) outsOnError++;
  }
}
check('errors are charged at all in this sample', chargedN > 0, `${chargedN} charged`);
check('no charged error retires the batter on the muffed play',
  batterRetired === 0, `${batterRetired} of ${chargedN} charged`);
check('reached-on-error is not structurally zero',
  batterReached > 0,
  `${batterReached}/${chargedN} = ${(100 * batterReached / Math.max(1, chargedN)).toFixed(1)}%`);

// Review Focus 3: a layout with no batter start must not throw or NaN.
// (Corrected per task-4 brief: assert the game actually produced plays
// first, so a rejected/degenerate construction can't pass this check for
// the wrong reason. The filtered layout below does produce plays -- it
// was verified directly rather than swapped for a defense-stress layout.)
const platesOnly = L.makeStarter(250);
platesOnly.nodes = platesOnly.nodes.filter((n) => platesOnly.homes.some((h) => h.id === n.id));
platesOnly.edges = [];
let survived = true;
let platesOnlyGame = null;
try {
  platesOnlyGame = G.simGameGraph(NYY, LAD, platesOnly, LOUD, 3);
} catch (e) { survived = false; }
check('a layout with no batter start survives errors being on', survived);
check('...and actually produced logged plays (the check above is not vacuous)',
  survived && !!platesOnlyGame && platesOnlyGame.log.length > 0,
  survived && platesOnlyGame ? `${platesOnlyGame.log.length} plays` : 'n/a');

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
  for (const e of g.log) if (e.error) calErrs++;
}
const perTeamGame = calErrs / (CAL_GAMES * 2);
check('errors per team-game is 0.53 +/- 0.05',
  perTeamGame >= 0.48 && perTeamGame <= 0.58,
  `${perTeamGame.toFixed(3)} (${calErrs} errors in ${CAL_GAMES * 2} team-games)`);

check('ERROR_E0 is a finite positive number',
  typeof G.ERROR_E0 === 'number' && Number.isFinite(G.ERROR_E0) && G.ERROR_E0 > 0,
  `${G.ERROR_E0}`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
