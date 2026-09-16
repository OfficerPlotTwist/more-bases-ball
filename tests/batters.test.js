/* Every delivery is visible. A plate appearance that never puts the ball in
 * play used to animate as a ball crossing an empty plate: no batter, and a
 * pitch that stopped in mid-air. And with several plates live, the batters
 * waiting at the other plates are the format, so they are drawn too.
 */
const assert = require('assert');
const L = require('../layout.js');
const T = require('../trisim.js');
const G = require('../graphsim.js');
const D = require('../data.js');
const { TEAMS } = D;

const cfg = { innings: 9, outs: 3 };
const away = TEAMS[0], home = TEAMS[1];

const ball = (e) => e.anim.tracks.find((t) => t.kind === 'ball');
const batters = (e) => e.anim.tracks.filter((t) => t.kind === 'batter');
const runners = (e) => e.anim.tracks.filter((t) => t.kind === 'runner');

// The three engines that build a timeline, and how many boxes each fills.
const cases = [
  { tag: 'multi 5 bases', game: () => T.simGameTri(away, home, L.makeNgonMulti(5, 90), cfg, 7), boxes: 6 },
  { tag: 'multi 1 base', game: () => T.simGameTri(away, home, L.makeNgonMulti(1, 90), cfg, 7), boxes: 2 },
  { tag: 'custom tri-pitch', game: () => T.simGameTri(away, home, L.makeStarter(250), cfg, 7), boxes: 3 },
  { tag: 'custom sequential', game: () => G.simGameGraph(away, home, L.makeStarter(250), cfg, 7), boxes: 1 },
];

for (const c of cases) {
  const g = c.game();
  let sawK = 0;

  for (const e of g.log) {
    const bs = batters(e);
    const names = bs.map((b) => b.name);

    // nobody is drawn twice, and a man who reaches base hands his box off
    // to his runner track at exactly the moment he breaks -- never both at
    // once, and never a gap where he is on neither
    assert.strictEqual(new Set(names).size, names.length, `${c.tag}: duplicate batter body`);
    const moving = new Set(runners(e).map((r) => r.name));
    for (const box of bs) {
      if (!moving.has(box.name)) {
        assert.ok(!box.handsOff, `${c.tag}: ${box.name} hands off to nobody`);
        continue;
      }
      const run = runners(e).find((r) => r.name === box.name);
      assert.ok(box.handsOff, `${c.tag}: ${box.name} runs but is not marked`);
      assert.strictEqual(
        +box.pts[box.pts.length - 1].t.toFixed(4), +run.pts[0].t.toFixed(4),
        `${c.tag}: ${box.name} box/run handoff is not seamless`);
    }

    // exactly one man is at bat; the rest are waiting at the other plates
    const atBat = bs.filter((b) => b.atBat);
    assert.ok(atBat.length <= 1, `${c.tag}: more than one batter at bat`);
    for (const b of bs) {
      assert.ok(b.pts.length >= 2, `${c.tag}: batter needs a start and an end`);
      assert.strictEqual(b.pts[0].x, b.pts[1].x, `${c.tag}: batter holds the box`);
      if (!b.atBat) assert.notStrictEqual(b.plate, e.plate, `${c.tag}: waiter on the live plate`);
    }

    // every plate in the window is accounted for: at bat, waiting, or running
    assert.strictEqual(bs.length + moving.size >= 1, true, `${c.tag}: nobody on screen`);
    assert.ok(bs.length <= c.boxes, `${c.tag}: at most ${c.boxes} boxes`);

    // there is always a pitch, from the rubber to the plate
    const b = ball(e);
    assert.ok(b && b.pts.length >= 2, `${c.tag}: no ball track`);
    assert.strictEqual(b.pts[0].leg, 'pitch', `${c.tag}: play opens on a pitch`);
    assert.strictEqual(b.pts[1].leg, 'pitch', `${c.tag}: pitch reaches the plate`);

    if (e.type === 'K') {
      sawK++;
      // the batter is there to strike out, and the pitch is caught rather
      // than stopping dead over the plate
      assert.strictEqual(atBat.length, 1, `${c.tag}: struck-out batter not drawn`);
      assert.strictEqual(atBat[0].name, e.batter, `${c.tag}: wrong man in the box`);
      assert.ok(b.pts.length >= 3, `${c.tag}: strikeout pitch was never caught`);
      const last = b.pts[b.pts.length - 1];
      assert.strictEqual(last.leg, 'pitch', `${c.tag}: last leg of a K is the pitch`);
      assert.ok(last.t > b.pts[1].t, `${c.tag}: glove comes after the plate`);
    }
  }

  assert.ok(sawK > 0, `${c.tag}: no strikeouts in the sample to check`);

  // in a shared window every live plate has a body in its box on some play
  if (c.boxes > 1) {
    const filled = Math.max(...g.log.map((e) => batters(e).length + runners(e).length));
    assert.ok(filled >= c.boxes, `${c.tag}: only ${filled} of ${c.boxes} boxes ever filled`);
  }
}

// Runners break on any plate's hit by default, on both field kinds.
assert.strictEqual(L.makeStarter(250).runMode, 'any', 'starter default');
assert.strictEqual(L.makeNgonMulti(3, 90).runMode, 'any', 'all-plates default');

console.log('batters.test.js OK');

/* The animation runs on the engine's own clock.
 * Runners no longer share a speed -- each carries his measured Statcast
 * sprint speed and home-to-first time -- so "everyone moves alike" is no
 * longer the invariant. What must hold is stronger: every runner's time on
 * screen is exactly what runSec() predicted for him, once the one broadcast
 * squeeze the window was given is divided back out. That still catches the
 * bug this replaced (merging plays that had each been squeezed by a
 * different factor put runners on screen at 3.3x each other's pace).
 */
{
  const I = G._internals;
  const legs = (tr) => {
    let want = 0;
    for (let i = 1; i < tr.pts.length; i++) {
      const ft = Math.hypot(tr.pts[i].x - tr.pts[i - 1].x,
        tr.pts[i].y - tr.pts[i - 1].y) / 1.2;
      want += I.runSec(tr, ft, i === 1 && tr.fromPlate);
    }
    return want;
  };

  for (const b of [1, 3, 5, 7]) {
    const g = T.simGameTri(away, home, L.makeNgonMulti(b, 90), cfg, 7 + b);
    let checked = 0, windows = 0;
    for (const e of g.log) {
      if (!e.cycleAnim) continue;
      const sq = e.cycleAnim.squeeze || 1;
      const rs = e.cycleAnim.tracks.filter((t) => t.kind === 'runner');
      if (rs.length > 1) windows++;
      for (const tr of rs) {
        const got = (tr.pts[tr.pts.length - 1].t - tr.pts[0].t) / sq;
        const want = legs(tr);
        if (want < 0.01) continue;
        checked++;
        assert.ok(Math.abs(got - want) < 1e-6,
          `bases ${b}: ${tr.name} on screen ${got.toFixed(4)}s, model ${want.toFixed(4)}s`);
      }
    }
    assert.ok(windows > 0 && checked > 0, `bases ${b}: nothing to check`);
  }
}

/* Real running data reaches the engine, and it actually varies. */
{
  const teams = D.teamsFor(2024);
  const flat = [];
  for (const t of teams) for (const p of t.lineup) {
    assert.ok(p.spd > 15 && p.spd < 35, `${p.name}: implausible sprint speed ${p.spd}`);
    assert.ok(p.hp1 > 3.5 && p.hp1 < 6, `${p.name}: implausible home-to-first ${p.hp1}`);
    // the model is calibrated so a 90 ft leg out of the box IS his hp1
    assert.ok(Math.abs(G._internals.runSec(p, 90, true) - p.hp1) < 1e-9,
      `${p.name}: model does not reproduce his measured home-to-first`);
    flat.push(p.spd);
  }
  assert.strictEqual(flat.length, 270, '30 teams x 9 batters');
  assert.ok(Math.max(...flat) - Math.min(...flat) > 4,
    'sprint speeds should differ across the league, not be one constant');
}

console.log('pace check OK');
