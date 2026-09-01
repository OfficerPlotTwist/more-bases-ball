/* The defense against awkward custom layouts.
 * Run: node tests/defense-stress.test.js
 *
 * The designer lets you build fields the engine was never shaped around:
 * forty bases, two bases, every base stacked on one spot, plates wired
 * straight to each other, dead-end spurs, wildly lopsided geometry. The
 * defensive logic has to stay coherent on all of them — no crashes, no
 * NaN, no ball thrown before somebody picked it up, and the same game out
 * of the same seed every time.
 */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));
const F = require(path.join(__dirname, '..', 'fielders.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];
const cfg = { innings: 6, outs: 3 };

/* ---------------- layouts that make life hard ---------------- */

// A ring with `k` bases between each pair of plates.
function ringWith(k, spacing) {
  const lay = L.makeStarter(spacing);
  lay.nodes = []; lay.edges = []; lay.nextId = 1;
  for (let i = 0; i < 3; i++) {
    const A = lay.homes[i], B = lay.homes[(i + 1) % 3];
    let prev = A.id;
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      const n = L.addNode(lay, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
      L.addEdge(lay, prev, n.id);
      prev = n.id;
    }
    L.addEdge(lay, prev, B.id);
  }
  return lay;
}

function lopsided() {
  const lay = ringWith(3, 250);
  // drag one arc's bases far out and crush another in on itself
  lay.nodes[0].x += 520; lay.nodes[0].y -= 380;
  lay.nodes[1].x += 610; lay.nodes[1].y -= 120;
  lay.nodes[3].x = L.CX + 3; lay.nodes[3].y = L.CY + 3;
  lay.nodes[4].x = L.CX - 3; lay.nodes[4].y = L.CY - 2;
  return lay;
}

function stacked() {
  const lay = ringWith(2, 220);
  // every base on this arc sits on exactly the same spot
  for (const n of lay.nodes.slice(0, 4)) { n.x = L.CX + 40; n.y = L.CY - 40; }
  return lay;
}

function platesOnly() {
  // no bases at all: the plates are wired straight to each other
  const lay = L.makeStarter(200);
  lay.nodes = []; lay.edges = []; lay.nextId = 1;
  for (let i = 0; i < 3; i++) {
    L.addEdge(lay, lay.homes[i].id, lay.homes[(i + 1) % 3].id);
  }
  return lay;
}

function withSpurs() {
  const lay = ringWith(2, 260);
  // dead ends hanging off the ring: reachable, but they go nowhere
  for (let i = 0; i < 3; i++) {
    const anchor = lay.nodes[i * 2];
    const spur = L.addNode(lay, anchor.x + 90, anchor.y + 70);
    L.addEdge(lay, anchor.id, spur.id);
  }
  return lay;
}

const LAYOUTS = [
  ['40-base ring', ringWith(13, 300)],
  ['2-base ring', ringWith(0, 150)],
  ['bases stacked on one spot', stacked()],
  ['plates wired straight together', platesOnly()],
  ['lopsided: one arc flung out, one crushed in', lopsided()],
  ['ring with dead-end spurs', withSpurs()],
  ['tiny field (80ft plates)', ringWith(2, 80)],
  ['enormous field (900ft plates)', ringWith(2, 900)],
];

/* ---------------- one invariant sweep per layout ---------------- */

function sweep(name, lay) {
  const issues = [];
  const note = (m) => { if (issues.length < 4 && !issues.includes(m)) issues.push(m); };

  for (const engine of ['graph', 'tri']) {
    for (let seed = 0; seed < 6; seed++) {
      let g;
      try {
        g = engine === 'tri'
          ? T.simGameTri(NYY, LAD, lay, cfg, seed)
          : G.simGameGraph(NYY, LAD, lay, cfg, seed);
      } catch (err) {
        note(`${engine} threw: ${err.message}`);
        continue;
      }
      if (!g || !g.log) { note(`${engine} produced no log`); continue; }

      for (const e of g.log) {
        if (!Number.isFinite(e.runs) || e.runs < 0) note('non-finite runs');
        if (!e.anim || !e.anim.tracks.length) { note('play with no animation'); continue; }
        if (!Number.isFinite(e.anim.dur)) note('non-finite duration');

        const ball = e.anim.tracks[0];
        if (ball.kind !== 'ball') note('ball track is not first');

        for (const tr of e.anim.tracks) {
          for (let i = 0; i < tr.pts.length; i++) {
            const p = tr.pts[i];
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.t)) {
              note(`non-finite waypoint on a ${tr.kind} track`);
            }
            if (i && p.t < tr.pts[i - 1].t - 1e-9) note(`${tr.kind} track goes back in time`);
          }
        }

        // the ball must not leave before whoever throws it has it
        const chase = e.anim.tracks.find((t) => t.kind === 'fielder' && t.chasing);
        const throwPt = ball.pts.find((p) => p.leg === 'throw');
        if (chase && throwPt && throwPt.t < chase.pts[1].t - 1e-9) {
          note('ball thrown before the fielder reached it');
        }
        // ...and somebody must be holding it when it goes
        if (throwPt && !chase) note('a throw with nobody to make it');

        // defensive assignment has to be coherent
        if (e.defense) {
          const used = e.defense.coverers.map((c) => c.slot);
          if (new Set(used).size !== used.length) note('a fielder covers two bags at once');
          if (used.includes(e.defense.fielder)) note('the man on the ball also covers a bag');
          if (!Number.isFinite(e.defense.tReach)) note('non-finite reach');
          if (!Number.isFinite(e.defense.tSecure)) note('non-finite secure time');
          if (e.defense.tSecure < e.defense.tReach - 1e-9) note('secured before arriving');
          for (const c of e.defense.coverers) {
            if (!Number.isFinite(c.tArrive) || c.tArrive < 0) note('bad coverer arrival');
          }
        }

        // never two runners on one base
        const nodes = (e.occupancyAfter || []).map((o) => o.node);
        if (new Set(nodes).size !== nodes.length) note('two runners on one base');
      }
    }
  }

  check(name, issues.length === 0, issues.join(' · '));
}

console.log('--- invariants across awkward layouts ---');
for (const [name, lay] of LAYOUTS) sweep(name, lay);

/* ---------------- determinism ---------------- */

console.log('\n--- same seed, same game ---');
for (const [name, lay] of LAYOUTS) {
  const a = JSON.stringify(T.simGameTri(NYY, LAD, lay, cfg, 4242).log);
  const b = JSON.stringify(T.simGameTri(NYY, LAD, lay, cfg, 4242).log);
  check(`${name} reproduces`, a === b);
}

/* ---------------- assignment quality ---------------- */

console.log('\n--- assignment ---');

// Shortest-distance-first matching, not first-come: the man standing next
// to a bag should get it even when that bag is asked for last.
const ring = ringWith(3, 250);
const slots = F.fielderSlots(ring);
const bags = ring.nodes.slice(0, 5).map((n) => n.id);
const fwd = F.assignPlay(ring, slots, { x: L.CX, y: L.CY }, bags);
const rev = F.assignPlay(ring, slots, { x: L.CX, y: L.CY }, bags.slice().reverse());
const asMap = (a) => JSON.stringify(
  a.coverers.map((c) => [c.node, c.slot.id]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
check('assignment does not depend on the order bags are asked for',
  asMap(fwd) === asMap(rev));

const totalFwd = fwd.coverers.reduce((s, c) => s + c.tArrive, 0);
let naive = 0;
const used = new Set([fwd.fielder.id]);
for (const id of bags) { // first-come-first-served, the old behaviour
  const p = L.findNode(ring, id);
  let best = null, bd = Infinity;
  for (const s of slots) {
    if (used.has(s.id)) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y) / L.FT2PX;
    if (d < bd) { bd = d; best = s; }
  }
  if (best) { used.add(best.id); naive += F.travelSec(best, p); }
}
check('shortest-first covers the bags no slower than first-come',
  totalFwd <= naive + 1e-9, `${totalFwd.toFixed(2)}s vs ${naive.toFixed(2)}s`);

// More bags than spare fielders: the leftovers must be reported, not
// silently dropped or crashed on.
const many = ringWith(13, 300);
const manySlots = F.fielderSlots(many);
const allBags = many.nodes.map((n) => n.id);
const strained = F.assignPlay(many, manySlots, { x: L.CX, y: L.CY }, allBags);
check('runs out of fielders without falling over',
  strained.coverers.length + strained.uncovered.length === allBags.length,
  `${strained.coverers.length} covered, ${strained.uncovered.length} left open`);
check('never assigns more coverers than it has fielders',
  strained.coverers.length <= manySlots.length - 1);
check('an uncovered bag is left uncovered, not doubled up',
  new Set(strained.coverers.map((c) => c.slot.id)).size === strained.coverers.length);

// A bag nobody covers is a free base — that is the design, so prove the
// engine actually treats it that way rather than crashing on the null.
check('an uncovered bag reports no coverer', F.covererFor(strained, strained.uncovered[0]) === null);

/* ---------------- malformed input ---------------- */

console.log('\n--- malformed geometry ---');

const broken = ringWith(2, 240);
broken.nodes[0].x = NaN;
broken.nodes[1].y = Infinity;
let slotsOk = true, assignOk = true;
try {
  const bs = F.fielderSlots(broken);
  slotsOk = bs.length > 0 && bs.every((s) => F.finite(s));
  const a = F.assignPlay(broken, bs, { x: L.CX + 50, y: L.CY }, broken.nodes.map((n) => n.id));
  assignOk = !!a.fielder && a.coverers.every((c) => Number.isFinite(c.tArrive));
} catch (err) {
  slotsOk = false; assignOk = false;
  console.log('    threw: ' + err.message);
}
check('a NaN base does not poison the alignment', slotsOk);
check('a NaN base is skipped rather than assigned to', assignOk);

const noSlots = F.assignPlay(ringWith(2, 240), [], { x: L.CX, y: L.CY }, ['N1']);
check('no fielders at all degrades instead of throwing',
  noSlots.fielder === null && noSlots.uncovered.length === 1);

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
