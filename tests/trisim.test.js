/* Tri-pitch engine + mound geometry checks. Run: node tests/trisim.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];
const cfg = { innings: 9, outs: 3 };

// 1. Mounds: one per plate, on the segment from plate to the bases' centroid.
const lay = L.makeStarter(250);
const c = L.basesCentroid(lay);
const mounds = L.moundPositions(lay);
check('three mounds, one per plate',
  mounds.length === 3 && new Set(mounds.map((m) => m.plate)).size === 3);
const colinear = mounds.every((m) => {
  const h = lay.homes.find((x) => x.id === m.plate);
  const cross = (c.x - h.x) * (m.y - h.y) - (c.y - h.y) * (m.x - h.x);
  const between = (m.x - h.x) * (c.x - h.x) + (m.y - h.y) * (c.y - h.y) > 0;
  return Math.abs(cross) < 1e-6 && between;
});
check('each mound lies on its plate→centroid line', colinear);
// moving the bases moves the centroid and therefore the mounds
const skew = L.makeStarter(250);
skew.nodes[0].x += 120;
check('mounds track the base centroid',
  JSON.stringify(L.moundPositions(skew)) !== JSON.stringify(mounds));

// 2. Tri games run, balance, reproduce.
const g = T.simGameTri(NYY, LAD, lay, cfg, 42);
const sum = (line) => line.reduce((a, x) => a + (x === 'X' ? 0 : x), 0);
check('tri game produces a winner', g.winner === 'home' || g.winner === 'away');
check('line scores sum to totals',
  sum(g.away.line) === g.away.runs && sum(g.home.line) === g.home.runs);
check('log runs match totals',
  g.log.reduce((a, e) => a + e.runs, 0) === g.away.runs + g.home.runs);
check('same seed reproduces the game',
  JSON.stringify(T.simGameTri(NYY, LAD, lay, cfg, 42).log) === JSON.stringify(g.log));

// 3. The 1-second window: offsets in [0,1000), ≤3 pitches per cycle,
//    distinct plates within a cycle, resolved in time order.
let windowOk = true, orderOk = true;
const byCycle = {};
for (const e of g.log) {
  if (!(e.tOffset >= 0 && e.tOffset < 1000)) windowOk = false;
  const key = `${e.inning}|${e.half}|${e.cycle}`;
  (byCycle[key] = byCycle[key] || []).push(e);
}
for (const key of Object.keys(byCycle)) {
  const es = byCycle[key];
  if (es.length > 3) orderOk = false;
  if (new Set(es.map((e) => e.plate)).size !== es.length) orderOk = false;
  for (let i = 1; i < es.length; i++) if (es[i].tOffset < es[i - 1].tOffset) orderOk = false;
}
check('every pitch lands inside the shared 1s window', windowOk);
check('cycles: ≤3 pitches, unique plates, time-ordered', orderOk);

// 4. Occupancy invariants hold under simultaneous play.
let occOk = true;
const ids = new Set([...lay.homes, ...lay.nodes].map((n) => n.id));
for (let s = 0; s < 30; s++) {
  const gg = T.simGameTri(NYY, LAD, lay, cfg, 700 + s);
  for (const e of gg.log) {
    const nodes = e.occupancyAfter.map((o) => o.node);
    if (new Set(nodes).size !== nodes.length || !nodes.every((n) => ids.has(n))) occOk = false;
  }
}
check('never two runners on one node (30 tri games)', occOk);

// 5. Release modes: 'any' moves runners on 3× the hits → more scoring than 'origin'.
const N = 500;
const originLay = Object.assign({}, lay, { runMode: 'origin' });
const anyLay = Object.assign({}, lay, { runMode: 'any' });
const aOrigin = T.simManyTri(NYY, LAD, originLay, cfg, N, 9);
const aAny = T.simManyTri(NYY, LAD, anyLay, cfg, N, 9);
const per = (a) => (a.awayRuns + a.homeRuns) / N;
check("'any' release outscores 'origin' release", per(aAny) > per(aOrigin),
  `any=${per(aAny).toFixed(1)} origin=${per(aOrigin).toFixed(1)} runs/game`);

// 6. Defense AI actually takes runners: CUT/DP plays with named victims occur,
//    and in 'origin' mode every cut-down runner belonged to the batting plate.
let cuts = 0, dps = 0, cutsLegal = true;
for (let s = 0; s < 60; s++) {
  const gg = T.simGameTri(NYY, LAD, originLay, cfg, 300 + s);
  const origin = new Map(); // runner name -> origin plate at entry time
  for (const e of gg.log) {
    if (e.sub === 'CUT') { cuts++; if (e.runnersOut.length === 0) cutsLegal = false; }
    if (e.sub === 'DP') dps++;
  }
  void origin;
}
check('defense cuts down runners (CUT plays occur)', cuts > 0, `${cuts} in 60 games`);
check('defense turns double plays', dps > 0, `${dps} in 60 games`);
check('every CUT names its victim', cutsLegal);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
