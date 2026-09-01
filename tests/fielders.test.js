/* Defensive alignment checks. Run: node tests/fielders.test.js */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'layout.js'));
const F = require(path.join(__dirname, '..', 'fielders.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const ftBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / L.FT2PX;

const ring = L.makeStarter(250);

// 1. Staffing: a pitcher and a catcher per plate, plus the fixed pool.
const slots = F.fielderSlots(ring);
const byRole = (r) => slots.filter((s) => s.role === r);
check('one pitcher per plate', byRole('P').length === 3);
check('one catcher per plate', byRole('C').length === 3);
check('shared pool is six deep',
  byRole('IF').length + byRole('OF').length === F.POOL);
check('three-plate field carries 12 defenders', slots.length === 12,
  String(slots.length));
check('every slot id is unique',
  new Set(slots.map((s) => s.id)).size === slots.length);

// 2. The pool does not grow when the field does — that is the scarcity.
const big = L.makeStarter(250);
for (let i = 0; i < 12; i++) {
  L.addNodeSym(big, L.CX + 120 + i * 9, L.CY - 40 - i * 5);
}
const bigSlots = F.fielderSlots(big);
check('extra bases add no fielders',
  bigSlots.filter((s) => s.role === 'IF' || s.role === 'OF').length === F.POOL,
  `${big.nodes.length} bases`);

// 3. Pitchers sit on their own rubbers, catchers behind their own plates.
const mounds = {};
for (const m of L.moundPositions(ring)) mounds[m.plate] = m;
check('pitchers stand on the rubber',
  byRole('P').every((s) => ftBetween(s, mounds[s.plate]) < 0.5));
const c = L.basesCentroid(ring);
check('catchers set up behind the plate',
  byRole('C').every((s) => {
    const h = L.findNode(ring, s.plate);
    return ftBetween(s, c) > ftBetween(h, c) &&
      Math.abs(ftBetween(s, h) - F.CATCHER_FT) < 0.5;
  }));

// 4. Depth alternates: outfielders play behind the infielders.
const meanR = (rs) => rs.reduce((a, s) => a + ftBetween(s, c), 0) / rs.length;
check('outfielders play deeper than infielders',
  meanR(byRole('OF')) > meanR(byRole('IF')),
  `${meanR(byRole('OF')).toFixed(0)}ft vs ${meanR(byRole('IF')).toFixed(0)}ft`);

// 5. Assignment: nearest man runs the ball down, nobody covers two bags.
const contact = { x: L.CX + 60, y: L.CY - 30 };
const nodeIds = ring.nodes.slice(0, 3).map((n) => n.id).concat(['H1']);
const a = F.assignPlay(ring, slots, contact, nodeIds);
const minD = Math.min(...slots.map((s) => ftBetween(s, contact)));
check('the nearest fielder runs the ball down',
  Math.abs(ftBetween(a.fielder, contact) - minD) < 1e-9);
check('every node in the play gets a coverer',
  a.coverers.length === nodeIds.length, `${a.coverers.length}/${nodeIds.length}`);
const used = a.coverers.map((x) => x.slot.id).concat([a.fielder.id]);
check('no fielder is in two places at once',
  new Set(used).size === used.length, used.join(','));
check('a plate is covered by its own catcher',
  F.covererFor(a, 'H1').slot.id === 'C-H1',
  F.covererFor(a, 'H1').slot.id);

// 6. Travel time grows with distance and includes the read-and-break beat.
const near = { x: a.fielder.x, y: a.fielder.y };
check('reaching your own spot still costs the break',
  Math.abs(F.travelSec(a.fielder, near) - 0.25) < 1e-9);
const far = { x: L.CX + 500, y: L.CY + 500 };
check('distant balls take longer', F.travelSec(a.fielder, far) > a.tReach);

// 7. Arc splitting is even and covers everything exactly once.
const g = F.splitEvenly(14, 6);
check('arcs tile the ring with no gaps or overlap',
  g[0][0] === 0 && g[5][1] === 14 && g.every((p, i) => i === 0 || p[0] === g[i - 1][1]));
check('arc sizes differ by at most one',
  Math.max(...g.map((p) => p[1] - p[0])) - Math.min(...g.map((p) => p[1] - p[0])) <= 1);

// 8. Fewer bases than fielders still yields six distinct spots.
const tiny = L.makeStarter(200);
tiny.nodes = tiny.nodes.slice(0, 2);
const tinySlots = F.fielderSlots(tiny).filter((s) => s.role === 'IF' || s.role === 'OF');
check('a two-base field still fields six', tinySlots.length === F.POOL);
check('sparse alignments are still spread out',
  new Set(tinySlots.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`)).size === F.POOL);

// 8b. Outfielders stand on fair ground at a real depth. On a one-plate
//     field that means all three out past the bases on the far side, the
//     way left, centre and right do — never loitering behind the plate.
{
  const cls = L.makeNgon(3, 90);
  const h = L.findNode(cls, 'H1'), cc = L.basesCentroid(cls);
  const of = F.fielderSlots(cls).filter((s) => s.role === 'OF');
  const depths = of.map((s) => ftBetween(s, h));
  check('a classic diamond fields three outfielders', of.length === 3);
  check('they play at real outfield depth',
    depths.every((d) => d > 240 && d < 360), depths.map((d) => d.toFixed(0)).join('/') + 'ft');
  check('none of them stands behind home plate',
    of.every((s) => (s.x - h.x) * (cc.x - h.x) + (s.y - h.y) * (cc.y - h.y) > 0));
  // and the outfield does not collapse onto one spot
  const spread = Math.max(...of.map((s, i) =>
    Math.max(...of.map((t) => ftBetween(s, t)))));
  check('the outfield is spread across fair ground', spread > 120, `${spread.toFixed(0)}ft apart`);
}

// 9. In a real game the defense decides plays, and the ground it has to
//    cover shows up in the numbers.
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));

function scout(spacingFt, games) {
  const lay = L.makeStarter(spacingFt);
  let plays = 0, reach = 0, gap = 0, assigned = 0;
  for (let s = 0; s < games; s++) {
    for (const e of T.simGameTri(TEAMS[1], TEAMS[0], lay, { innings: 9, outs: 3 }, s).log) {
      if (!e.defense) continue;
      plays++;
      reach += e.defense.tReach;
      if (e.defense.tReach > e.contact.distFt / 110) gap++; // ball beat the fielder there
      if (e.defense.coverers.length) assigned++;
    }
  }
  return { plays, reach: reach / plays, gap: gap / plays, assigned };
}

const tight = scout(150, 20), tuned = scout(250, 20), sprawl = scout(400, 20);
check('balls in play record a defensive assignment',
  tuned.plays > 100 && tuned.assigned === tuned.plays);
check('the defense is aligned to the base ring, so a mid-size field covers best',
  tuned.reach < tight.reach && tuned.reach < sprawl.reach,
  `150ft=${tight.reach.toFixed(2)}s 250ft=${tuned.reach.toFixed(2)}s 400ft=${sprawl.reach.toFixed(2)}s`);
check('a sprawling field leaves the most gaps',
  sprawl.gap > tuned.gap,
  `${(100 * sprawl.gap).toFixed(0)}% vs ${(100 * tuned.gap).toFixed(0)}%`);
check('most balls have to be run down, not caught where they land',
  tuned.gap > 0.25, `${(100 * tuned.gap).toFixed(0)}%`);

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
