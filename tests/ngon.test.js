/* Classic-mode geometry adapter. Run: node tests/ngon.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const S = require(path.join(__dirname, '..', 'sim.js'));
const N = require(path.join(__dirname, '..', 'ngon.js'));
const F = require(path.join(__dirname, '..', 'fielders.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const ft = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / L.FT2PX;

const LAD = TEAMS[0], NYY = TEAMS[1];

// 1. The N-gon is a real regular polygon with true 90-foot sides.
for (const b of [1, 3, 5, 7]) {
  const lay = L.makeNgon(b, 90);
  const ring = ['H1'].concat(lay.nodes.map((n) => n.id));
  const sides = ring.map((id, i) =>
    ft(L.findNode(lay, id), L.findNode(lay, ring[(i + 1) % ring.length])));
  check(`${b}-base field is a regular ${b + 1}-gon of 90ft sides`,
    sides.every((s) => Math.abs(s - 90) < 0.01),
    sides.map((s) => s.toFixed(1)).join('/'));
  check(`${b}-base lap is ${b + 1} steps`,
    L.validate(lay)[0].steps === b + 1);
}

// 2. The classic diamond really is the diamond: home at the bottom, first
//    off to the right, second up the middle.
const d = L.makeNgon(3, 90);
const h = L.findNode(d, 'H1'), n1 = L.findNode(d, 'N1'), n2 = L.findNode(d, 'N2');
check('home plate sits at the bottom', h.y > n2.y && Math.abs(h.x - L.CX) < 0.01);
check('first base is off to the right', n1.x > h.x && Math.abs(n1.y - L.CY) < 0.01);
check('second base is straight out from home', Math.abs(n2.x - h.x) < 0.01 && n2.y < n1.y);

// 3. Classic staffing: one battery, six in the field.
check('a classic field carries 8 defenders', F.fielderSlots(d).length === 8);

// 4. The adapter is a pure overlay — outcomes must not move at all.
const cfg = { bases: 3, innings: 9, outs: 3 };
const before = S.simGame(NYY, LAD, cfg, 7);
const boxOf = (g) => JSON.stringify({
  away: g.away, home: g.home, winner: g.winner, innings: g.innings,
  plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter, e.basesAfter]),
});
const box = boxOf(before);
N.attachGeometry(before, 7);
check('attaching geometry changes no outcome', boxOf(before) === box);
check('the game keeps its layout', before.layout && before.layout.classic === 3);

// 5. Every play now has a well-formed timeline.
let anim = true, ballFirst = true, mono = true, onNodes = true, fielders = 0;
const ids = new Set(['H1'].concat(before.layout.nodes.map((n) => n.id)));
for (const e of before.log) {
  if (!e.anim || !e.anim.tracks.length) { anim = false; continue; }
  if (e.anim.tracks[0].kind !== 'ball') ballFirst = false;
  for (const tr of e.anim.tracks) {
    if (tr.kind === 'fielder') fielders++;
    for (let i = 1; i < tr.pts.length; i++) {
      if (tr.pts[i].t < tr.pts[i - 1].t - 1e-9) mono = false;
    }
  }
  for (const mv of e.moves || []) {
    for (const id of mv.path) if (!ids.has(id)) onNodes = false;
  }
}
check('every classic play has an animation', anim);
check('ball track leads each play', ballFirst);
check('track times are monotonic', mono);
check('runner paths only touch real bases', onNodes);
check('defenders move on classic plays', fielders > 0, `${fielders} fielder tracks`);

// 6. Movement matches the box score: whoever the log says advanced, moved.
let consistent = true, detail = '';
let prev = new Array(cfg.bases).fill(null), key = '';
for (const e of before.log) {
  const k = e.inning + '|' + e.half;
  if (k !== key) { prev = new Array(cfg.bases).fill(null); key = k; }
  const moved = new Set(e.moves.map((m) => m.name));
  for (let i = 0; i < prev.length; i++) {
    const name = prev[i];
    if (!name) continue;
    const j = e.basesAfter.indexOf(name);
    if (j !== i && !moved.has(name)) { consistent = false; detail = `${name} ${i}→${j}`; }
    if (j === i && moved.has(name)) { consistent = false; detail = `${name} held but moved`; }
  }
  const scoredMoves = e.moves.filter((m) => m.scored).map((m) => m.name).sort();
  if (JSON.stringify(scoredMoves) !== JSON.stringify(e.scorers.slice().sort())) {
    consistent = false; detail = `scorers ${e.scorers} vs ${scoredMoves}`;
  }
  prev = e.basesAfter.slice();
}
check('every base-state change is matched by a runner move', consistent, detail);

// 7. Runners end where the box score says they are.
let occOk = true;
for (const e of before.log) {
  const want = e.basesAfter
    .map((n, i) => (n ? `N${i + 1}:${n}` : null)).filter(Boolean).join('|');
  const got = e.occupancyAfter.map((o) => `${o.node}:${o.name}`).join('|');
  if (want !== got) occOk = false;
}
check('occupancy matches the box score', occOk);

// 8. Every base count animates, and the adapter is deterministic.
for (const b of [1, 4, 7]) {
  const g = S.simGame(NYY, LAD, { bases: b, innings: 5, outs: 3 }, 11);
  N.attachGeometry(g, 11);
  check(`${b}-base game animates end to end`,
    g.log.every((e) => e.anim && e.anim.tracks.length && e.anim.dur > 0));
}
const a1 = S.simGame(NYY, LAD, cfg, 99); N.attachGeometry(a1, 99);
const a2 = S.simGame(NYY, LAD, cfg, 99); N.attachGeometry(a2, 99);
check('same seed reproduces the geometry',
  JSON.stringify(a1.log) === JSON.stringify(a2.log));

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
