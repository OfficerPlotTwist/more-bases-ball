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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
