/* Radial-symmetry checks. Run: node tests/layout-sym.test.js */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const near = (a, b) => Math.abs(a - b) <= 1.5; // node coords are rounded

// 1. Home plates map into each other under 120° rotation.
const lay = L.makeStarter(250);
check('rot(H1,1)=H2, rot(H2,1)=H3, rot(H3,1)=H1',
  L.rotCounterpart(lay, 'H1', 1) === 'H2' &&
  L.rotCounterpart(lay, 'H2', 1) === 'H3' &&
  L.rotCounterpart(lay, 'H3', 1) === 'H1');
const h1 = lay.homes[0], h2 = lay.homes[1];
const rp = L.rotatePoint(h1.x, h1.y, 1);
check('rotating H1 position lands on H2', near(rp.x, h2.x) && near(rp.y, h2.y),
  `(${rp.x.toFixed(1)},${rp.y.toFixed(1)}) vs (${h2.x.toFixed(1)},${h2.y.toFixed(1)})`);

// 2. addNodeSym creates a triple: same center distance, siblings at ±120°.
const before = lay.nodes.length;
const n0 = L.addNodeSym(lay, 360, 180);
const trio = lay.nodes.filter((n) => n.grp === n0.grp);
check('symmetric add creates 3 grouped nodes', lay.nodes.length === before + 3 && trio.length === 3);
const dist = (n) => Math.hypot(n.x - L.CX, n.y - L.CY);
check('all three sit at the same radius',
  trio.every((n) => near(dist(n), dist(n0))),
  trio.map((n) => dist(n).toFixed(1)).join('/'));
const sib1 = trio.find((n) => n.rotIdx === 1);
const exp1 = L.rotatePoint(n0.x, n0.y, 1);
check('slot-1 sibling is the 120° rotation', near(sib1.x, exp1.x) && near(sib1.y, exp1.y));

// 3. addEdgeSym wires all three copies, with plate endpoints rotating too.
const eBefore = lay.edges.length;
L.addEdgeSym(lay, 'H1', n0.id);
check('symmetric connect adds 3 edges', lay.edges.length === eBefore + 3);
const sib2 = trio.find((n) => n.rotIdx === 2);
check('rotated edges use rotated endpoints',
  lay.edges.some((e) => e.from === 'H2' && e.to === sib1.id) &&
  lay.edges.some((e) => e.from === 'H3' && e.to === sib2.id));

// 4. moveNodeSym drags the whole trio.
L.moveNodeSym(lay, n0.id, 360, 150);
const exp = L.rotatePoint(360, 150, 2);
check('moving one node repositions its siblings',
  near(sib2.x, exp.x) && near(sib2.y, exp.y));

// 5. removeNodeSym erases the trio and every edge touching it.
L.removeNodeSym(lay, sib1.id);
check('symmetric erase removes all 3 nodes',
  lay.nodes.every((n) => n.grp !== n0.grp));
check('and their edges', lay.edges.length === eBefore);

// 6. End-to-end: a symmetric shortcut keeps the game fair for all plates.
const fair = L.makeStarter(250);
const cut = L.addNodeSym(fair, 360, 190);       // between H1 and H2, mirrored
L.addEdgeSym(fair, 'H1', cut.id);
const cutSibs = fair.nodes.filter((n) => n.grp === cut.grp);
L.addEdgeSym(fair, cut.id, 'H2');
const v = L.validate(fair);
check('every plate gets the same 2-step shortcut',
  v.every((r) => r.steps === 2), JSON.stringify(v));
const g = G.simGameGraph(TEAMS[1], TEAMS[0], fair, { innings: 9, outs: 3 }, 11);
check('symmetric layout plays a full game',
  g.log.length > 0 && (g.winner === 'home' || g.winner === 'away'),
  `${g.away.runs}-${g.home.runs}`);
check('starter ring bases carry symmetry groups',
  L.makeStarter(250).nodes.every((n) => n.grp != null && n.rotIdx != null));
void cutSibs;

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
