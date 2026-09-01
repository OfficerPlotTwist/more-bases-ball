/* Graph-engine sanity checks. Run: node tests/graphsim.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];
const cfg = { innings: 9, outs: 3 };

// 1. Starter ring validates under both scoring rules.
const ring = L.makeStarter(250);
let v = L.validate(ring);
check('cw rule: every plate reaches next in 3 steps',
  v.every((r) => r.steps === 3), JSON.stringify(v));
ring.scoreRule = 'own';
v = L.validate(ring);
check('own rule: every plate laps home in 9 steps',
  v.every((r) => r.steps === 9), JSON.stringify(v));
ring.scoreRule = 'cw';

// 2. A game runs, balances, and reproduces from its seed.
const g = G.simGameGraph(NYY, LAD, ring, cfg, 42);
check('game produces a winner', g.winner === 'home' || g.winner === 'away');
const sum = (line) => line.reduce((a, x) => a + (x === 'X' ? 0 : x), 0);
check('line scores sum to totals',
  sum(g.away.line) === g.away.runs && sum(g.home.line) === g.home.runs);
check('log runs match totals',
  g.log.reduce((a, e) => a + e.runs, 0) === g.away.runs + g.home.runs);
check('same seed reproduces the game',
  JSON.stringify(G.simGameGraph(NYY, LAD, ring, cfg, 42).log) === JSON.stringify(g.log));

// 3. Occupancy invariants: one runner per node, only real nodes, never a scoring plate.
let occOk = true, nodeOk = true;
const ids = new Set([...ring.homes, ...ring.nodes].map((n) => n.id));
for (let s = 0; s < 40; s++) {
  const gg = G.simGameGraph(NYY, LAD, ring, cfg, 900 + s);
  for (const e of gg.log) {
    const nodes = e.occupancyAfter.map((o) => o.node);
    if (new Set(nodes).size !== nodes.length) occOk = false;
    if (!nodes.every((n) => ids.has(n))) nodeOk = false;
  }
}
check('never two runners on one node (40 games)', occOk);
check('runners only stand on layout nodes', nodeOk);

// 4. Shorter trips score more: cw (3 steps) vs own-plate lap (9 steps).
const N = 800;
const cw = G.simManyGraph(NYY, LAD, ring, cfg, N, 5);
const own = G.simManyGraph(NYY, LAD, Object.assign({}, ring, { scoreRule: 'own' }), cfg, N, 5);
const per = (a) => (a.awayRuns + a.homeRuns) / N;
check('cw scoring beats own-plate lap', per(cw) > per(own) * 1.3,
  `cw=${per(cw).toFixed(1)} own=${per(own).toFixed(1)} runs/game`);
check('no ties, wins add up', cw.ties === 0 && cw.awayWins + cw.homeWins === N);

// 5. Editing the graph changes it: cut one ring edge and H3 loses its route.
const cut = JSON.parse(JSON.stringify(ring));
const lastLeg = cut.edges.find((e) => e.to === 'H1');
L.removeEdge(cut, lastLeg.from, lastLeg.to);
v = L.validate(cut);
check('validator flags a severed route',
  v.some((r) => r.steps == null) && v.filter((r) => r.steps != null).length === 2,
  JSON.stringify(v));

// 6. A custom layout built through the API plays fine: express lane H1→H2
//    (1 base), scenic routes elsewhere.
const custom = L.makeStarter(250);
const shortcut = L.addNode(custom, 360, 200);
L.addEdge(custom, 'H1', shortcut.id);
L.addEdge(custom, shortcut.id, 'H2');
v = L.validate(custom);
check('shortcut shortens H1 trip to 2 steps', v.find((r) => r.home === 'H1').steps === 2);
const gc = G.simGameGraph(NYY, LAD, custom, cfg, 7);
check('custom layout game terminates', gc.innings <= cfg.innings + 30 && gc.log.length > 0,
  `${gc.away.runs}-${gc.home.runs} in ${gc.innings}`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
