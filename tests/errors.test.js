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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
