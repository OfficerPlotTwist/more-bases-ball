/* The freeze guard. Run: node tests/rules-identity.test.js
 *
 * These fixtures were captured from the engine before the era-rules
 * parameters existed. If a case fails, the default simulation moved --
 * that is a regression, not a fixture to regenerate. */
'use strict';
const fs = require('fs');
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const S = require(path.join(__dirname, '..', 'sim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];

function boxOf(g) {
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter, e.basesAfter]),
  });
}

const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'identity-golden.json'), 'utf8'));

let moved = 0;
for (const c of golden.cases) {
  if (boxOf(S.simGame(NYY, LAD, c.cfg, c.seed)) !== c.box) moved++;
}
check(`${golden.cases.length} golden box scores unchanged`, moved === 0,
  moved ? `${moved} case(s) diverged` : `captured from ${golden.generatedFrom.slice(0, 8)}`);

// plateAppearance must consume the same stream however the trailing
// no-op arguments are spelled.
const judge = NYY.lineup[2];
const variants = [
  ['(p, rnd)', (p, r) => S.plateAppearance(p, r)],
  ['(p, rnd, 0)', (p, r) => S.plateAppearance(p, r, 0)],
  ['(p, rnd, 0, null)', (p, r) => S.plateAppearance(p, r, 0, null)],
  ['(p, rnd, undefined, null)', (p, r) => S.plateAppearance(p, r, undefined, null)],
];
for (let v = 1; v < variants.length; v++) {
  const a = S.mulberry32(7), b = S.mulberry32(7);
  let same = true;
  for (let i = 0; i < 5000; i++) {
    if (variants[0][1](judge, a) !== variants[v][1](judge, b)) { same = false; break; }
  }
  check(`stream identical: ${variants[0][0]} vs ${variants[v][0]}`, same);
}

// The exact call tests/sim.test.js:24-25 relies on must still merge to a
// falsy rules value.
const merged = Object.assign({}, S.DEFAULT_CFG, { bases: 3 });
check('DEFAULT_CFG merge leaves rules falsy', !merged.rules,
  `rules = ${JSON.stringify(merged.rules)}`);

// ---- tunables: the four bare literals become rule-addressable ----
const def = S.tunables(null);
check('tunables(null) returns the historical literals',
  def.stretch1B === 0.32 && def.stretch2B === 0.22 &&
  def.sacFly === 0.26 && def.doublePlay === 0.13,
  JSON.stringify(def));

const over = S.tunables({ tunables: { stretch1B: 0.5 } });
check('tunables override one value and keep the rest',
  over.stretch1B === 0.5 && over.stretch2B === 0.22 && over.sacFly === 0.26,
  JSON.stringify(over));

check('tunables treat 0 as a real value, not as missing',
  S.tunables({ tunables: { doublePlay: 0 } }).doublePlay === 0);

// An all-identity rules object must leave the game exactly where it was.
const R = require(path.join(__dirname, '..', 'rules.js'));
const inert = R.resolve({ ids: [] });
let inertMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: inert });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) inertMoved++;
}
check('an identity rules object does not move any golden box score',
  inertMoved === 0, inertMoved ? `${inertMoved} case(s) diverged` : '');

// ---- applyModifiers ----
const baseRates = { bb: 0.09, hr: 0.04, d3: 0.004, d2: 0.05, s1: 0.14, k: 0.23 };
const same = S.applyModifiers(baseRates, { bb: 1, hr: 1, d3: 1, d2: 1, s1: 1, k: 1 });
check('identity modifiers return the same rates',
  Object.keys(baseRates).every((k) => Math.abs(same[k] - baseRates[k]) < 1e-12),
  JSON.stringify(same));

const doubled = S.applyModifiers(baseRates, { hr: 2 });
check('a single multiplier moves only its own rate',
  Math.abs(doubled.hr - 0.08) < 1e-12 && Math.abs(doubled.bb - 0.09) < 1e-12,
  `hr ${doubled.hr}`);

// The clamps that keep a game playable, inherited from adjustedRates.
const absurd = S.applyModifiers(baseRates, { bb: 9, hr: 9, d2: 9, s1: 9 });
const nonOut = absurd.bb + absurd.hr + absurd.d3 + absurd.d2 + absurd.s1;
check('non-out share is clamped at 0.92', nonOut <= 0.92 + 1e-9, nonOut.toFixed(4));
check('strikeouts never go below 2%', absurd.k >= 0.02 - 1e-9, absurd.k.toFixed(4));

check('applyModifiers does not mutate its input',
  Math.abs(baseRates.hr - 0.04) < 1e-12);

// The whole point of Tier C: it is real, it is listed, and it does nothing.
const tierC = R.resolve({ ids: R.TIERS.C });
let cMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: tierC });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) cMoved++;
}
check(`all ${R.TIERS.C.length} tier C rules active changes nothing`,
  cMoved === 0, cMoved ? `${cMoved} case(s) diverged` : '');

// A full historical year, with every coefficient still at identity.
const y1968 = R.resolve({ year: 1968 });
let yMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: y1968 });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) yMoved++;
}
check('the 1968 rule set at identity coefficients changes nothing',
  yMoved === 0, yMoved ? `${yMoved} case(s) diverged` : '');

// Wiring check: a non-identity modifier must actually move at least one
// golden box score, or cfg.rules never reached plateAppearance and the
// identity checks above would be vacuous.
const loud = { modifiers: { hr: 3, bb: 1, k: 1, s1: 1, d2: 1, d3: 1 } };
let loudMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: loud });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) loudMoved++;
}
check('a non-identity modifier DOES move the box score (wiring is real)',
  loudMoved > 0, `${loudMoved} case(s) diverged`);

// ---- graph and tri engines accept rules without moving ----
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));

const lay = L.makeStarter(250);
function graphBox(cfg, seed) {
  const g = G.simGameGraph(NYY, LAD, lay, cfg, seed);
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter]),
  });
}
let graphMoved = 0;
for (const seed of [7, 42, 99]) {
  const plain = graphBox({ innings: 9, outs: 3 }, seed);
  const withRules = graphBox({ innings: 9, outs: 3, rules: R.resolve({ year: 1968 }) }, seed);
  if (plain !== withRules) graphMoved++;
}
check('graph engine: an identity rule set changes nothing', graphMoved === 0,
  graphMoved ? `${graphMoved} seed(s) diverged` : '');

// Wiring check, same shape as the sim.js loud-modifier proof above: identity
// coefficients are indistinguishable from no coefficients at all, so the
// check above could pass vacuously if cfg.rules never reached
// CORE.plateAppearance through the graph engine. A non-identity modifier
// must actually move the box for at least one seed.
let graphLoudMoved = 0;
for (const seed of [7, 42, 99]) {
  const plain = graphBox({ innings: 9, outs: 3 }, seed);
  const withLoud = graphBox({ innings: 9, outs: 3, rules: loud }, seed);
  if (plain !== withLoud) graphLoudMoved++;
}
check('graph engine: a non-identity modifier DOES move the box (wiring is real)',
  graphLoudMoved > 0, `${graphLoudMoved} seed(s) diverged`);

function triBox(cfg, seed) {
  const g = T.simGameTri(NYY, LAD, lay, cfg, seed);
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter]),
  });
}
let triMoved = 0;
for (const seed of [7, 42, 99]) {
  const plain = triBox({ innings: 9, outs: 3 }, seed);
  const withRules = triBox({ innings: 9, outs: 3, rules: R.resolve({ year: 1968 }) }, seed);
  if (plain !== withRules) triMoved++;
}
check('tri engine: an identity rule set changes nothing', triMoved === 0,
  triMoved ? `${triMoved} seed(s) diverged` : '');

let triLoudMoved = 0;
for (const seed of [7, 42, 99]) {
  const plain = triBox({ innings: 9, outs: 3 }, seed);
  const withLoud = triBox({ innings: 9, outs: 3, rules: loud }, seed);
  if (plain !== withLoud) triLoudMoved++;
}
check('tri engine: a non-identity modifier DOES move the box (wiring is real)',
  triLoudMoved > 0, `${triLoudMoved} seed(s) diverged`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
