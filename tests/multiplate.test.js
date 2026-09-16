/* All plates live: every vertex of the (B+1)-gon is a home plate, so B+1
 * batters swing inside one shared 1s window. Guards the properties that
 * distinguish this from the classic single-plate game.
 */
const assert = require('assert');
const L = require('../layout.js');
const T = require('../trisim.js');
const F = require('../fielders.js');
const { TEAMS } = require('../data.js');

const cfg = { innings: 9, outs: 3 };
const away = TEAMS[0], home = TEAMS[1];

// 1. geometry: B+1 plates, no separate bases, and a full lap is B+1 steps —
//    exactly the route a classic batter runs, so the route length is not
//    what changes the run environment.
for (let b = 1; b <= 7; b++) {
  const ly = L.makeNgonMulti(b, 90);
  assert.strictEqual(ly.homes.length, b + 1, `bases ${b}: plate count`);
  assert.strictEqual(ly.nodes.length, 0, `bases ${b}: no loose bases`);
  assert.strictEqual(ly.scoreRule, 'own');
  assert.strictEqual(ly.pitchMode, 'tri');
  for (const v of L.validate(ly)) {
    assert.strictEqual(v.steps, b + 1, `bases ${b}: lap length for ${v.home}`);
    assert.strictEqual(v.target, v.home, 'each batter scores at his own plate');
  }
}

// 2. clockwiseNext generalizes past three plates without breaking the
//    hard-coded H1->H2->H3 cycle three-plate fields rely on.
assert.strictEqual(L.clockwiseNext('H1'), 'H2');
assert.strictEqual(L.clockwiseNext('H3'), 'H1');
const hex = L.makeNgonMulti(5, 90);            // 6 plates
assert.strictEqual(L.clockwiseNext('H6', hex), 'H1');
assert.strictEqual(L.clockwiseNext('H2', hex), 'H3');
const tri = L.makeNgonMulti(2, 90);            // 3 plates: legacy path
assert.strictEqual(L.clockwiseNext('H3', tri), 'H1');

// 3. the defense still finds a ring to align on when every vertex is a
//    plate (layout.nodes is empty), and the roster rule still holds:
//    a pitcher and a catcher per plate plus a shared pool of six.
for (const b of [1, 3, 7]) {
  const ly = L.makeNgonMulti(b, 90);
  const slots = F.fielderSlots(ly);
  assert.strictEqual(slots.filter((s) => s.role === 'P').length, b + 1);
  assert.strictEqual(slots.filter((s) => s.role === 'C').length, b + 1);
  assert.strictEqual(slots.length, 2 * (b + 1) + 6, `bases ${b}: roster size`);
  for (const s of slots) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'finite slot');
  }
}

// 4. every plate actually bats: over a game each of the B+1 plates appears
//    in the log, and a cycle never gives one plate two turns.
{
  const b = 5;
  const ly = L.makeNgonMulti(b, 90);
  const g = T.simGameTri(away, home, ly, cfg, 4242);
  const seen = new Set(g.log.map((e) => e.plate));
  assert.strictEqual(seen.size, b + 1, 'all plates bat');
  const byCycle = new Map();
  for (const e of g.log) {
    const k = `${e.inning}|${e.half}|${e.cycle}`;
    if (!byCycle.has(k)) byCycle.set(k, new Set());
    const s = byCycle.get(k);
    assert.ok(!s.has(e.plate), 'one turn per plate per cycle');
    s.add(e.plate);
  }
  // deliveries are staggered inside the shared window, never outside it
  for (const e of g.log) {
    assert.ok(e.tOffset >= 0 && e.tOffset < T.WINDOW_MS, 'delivery in window');
  }
}

// 5. occupancy invariant: one runner per node, and nobody parks on a node
//    that is not on the ring.
for (const b of [1, 3, 6]) {
  const ly = L.makeNgonMulti(b, 90);
  const ids = new Set(ly.homes.map((h) => h.id));
  const g = T.simGameTri(away, home, ly, cfg, 77 + b);
  for (const e of g.log) {
    const nodes = e.occupancyAfter.map((o) => o.node);
    assert.strictEqual(new Set(nodes).size, nodes.length, 'one runner per node');
    for (const n of nodes) assert.ok(ids.has(n), `known node ${n}`);
  }
}

// 6. reproducible, terminating, and the shape of the curve survives: more
//    bases still means fewer runs.
{
  const ly = L.makeNgonMulti(3, 90);
  const a = T.simGameTri(away, home, ly, cfg, 999);
  const c = T.simGameTri(away, home, ly, cfg, 999);
  assert.strictEqual(JSON.stringify(a.log), JSON.stringify(c.log), 'same seed, same game');

  const runs = [1, 3, 7].map((b) => {
    const agg = T.simManyTri(away, home, L.makeNgonMulti(b, 90), cfg, 40, 2024);
    return (agg.awayRuns + agg.homeRuns) / agg.games;
  });
  assert.ok(runs[0] > runs[1], `1 base (${runs[0]}) outscores 3 (${runs[1]})`);
  assert.ok(runs[1] >= runs[2], `3 bases (${runs[1]}) outscores 7 (${runs[2]})`);
}

console.log('multiplate.test.js OK');
