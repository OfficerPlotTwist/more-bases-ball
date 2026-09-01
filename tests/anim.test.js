/* Distance physics + animation timeline checks. Run: node tests/anim.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.5);

const LAD = TEAMS[0], NYY = TEAMS[1];
const cfg = { innings: 9, outs: 3 };
const ring = L.makeStarter(250);

// 1. Every play carries a well-formed animation timeline.
const g = T.simGameTri(NYY, LAD, ring, cfg, 42);
let haveAnim = true, ballFirst = true, timesOk = true, durOk = true;
for (const e of g.log) {
  if (!e.anim || !e.anim.tracks.length) { haveAnim = false; continue; }
  if (e.anim.tracks[0].kind !== 'ball') ballFirst = false;
  if (e.anim.dur > 5.5) durOk = false;
  for (const tr of e.anim.tracks) {
    for (let i = 1; i < tr.pts.length; i++) {
      if (tr.pts[i].t < tr.pts[i - 1].t - 1e-9) timesOk = false;
    }
  }
}
check('every entry has an animation', haveAnim);
check('ball track leads each play', ballFirst);
check('track times are monotonic', timesOk);
check('plays compressed to ≤5s', durOk);

// 2. The ball starts on the batting plate's mound and passes over the plate.
const mounds = {};
for (const m of L.moundPositions(ring)) mounds[m.plate] = m;
let moundOk = true, plateOk = true;
for (const e of g.log) {
  const bp = e.anim.tracks[0].pts;
  const m = mounds[e.plate];
  const h = ring.homes.find((x) => x.id === e.plate);
  if (!near(bp[0].x, m.x) || !near(bp[0].y, m.y)) moundOk = false;
  if (!near(bp[1].x, h.x) || !near(bp[1].y, h.y)) plateOk = false;
}
check('pitch leaves the correct mound', moundOk);
check('pitch crosses its home plate', plateOk);

// 3. Runner tracks follow real node positions along their paths.
const posOf = (id) => {
  const n = L.findNode(ring, id);
  return { x: n.x, y: n.y };
};
let runnersOnNodes = true, ballOnHits = true;
for (const e of g.log) {
  for (const tr of e.anim.tracks) {
    if (tr.kind !== 'runner') continue;
    for (const p of tr.pts) {
      const onSome = [...ring.homes, ...ring.nodes]
        .some((n) => near(p.x, n.x, 1) && near(p.y, n.y, 1));
      if (!onSome) runnersOnNodes = false;
    }
  }
  if (['1B', '2B', '3B', 'HR', 'OUT'].includes(e.type)) {
    if (e.anim.tracks[0].pts.length < 3) ballOnHits = false; // must reach contact
  }
}
check('runner waypoints sit on layout nodes', runnersOnNodes);
check('batted balls fly to a contact point', ballOnHits);

// 4. Running distance matters: identical rules, small field vs huge field.
//    Short edges → more stretches/advances → more runs.
const N = 500;
const small = L.makeStarter(120);
const big = L.makeStarter(380);
const runsOf = (lay) => {
  const a = G.simManyGraph(NYY, LAD, lay, cfg, N, 77);
  return (a.awayRuns + a.homeRuns) / N;
};
const rSmall = runsOf(small), rBig = runsOf(big);
check('small field outscores big field (distance physics)', rSmall > rBig,
  `120ft spacing=${rSmall.toFixed(1)} vs 380ft=${rBig.toFixed(1)} runs/game`);

// 5. Throw target recorded when the defense makes a play.
let throwsOk = true, sawCut = false;
for (let s = 0; s < 20; s++) {
  const gg = T.simGameTri(NYY, LAD, ring, cfg, 1200 + s);
  for (const e of gg.log) {
    if (e.sub === 'CUT' || e.sub === 'DP') {
      sawCut = true;
      if (!e.throwTo) throwsOk = false;
    }
  }
}
check('defensive plays carry a throw target for the ball track', sawCut && throwsOk);

/* The defense has to actually handle the ball. The engine decides a play
 * off when a fielder reaches it (max of flight time and his run), so the
 * animation has to use that same number — otherwise the ball leaves on
 * pure flight time, the fielder arrives at an empty patch of grass, and
 * the throw comes from nobody. Regression: this was true of 58% of throws.
 */
{
  let plays = 0, early = 0, orphan = 0, idle = 0, held = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const e of T.simGameTri(NYY, LAD, ring, cfg, seed).log) {
      if (!e.contact || e.type === 'HR') continue;
      const ball = e.anim.tracks[0].pts;
      const chase = e.anim.tracks.find((t) => t.kind === 'fielder' && t.chasing);
      const thrown = ball.find((p) => p.leg === 'throw');
      if (!chase) continue;
      plays++;
      const arrives = chase.pts[1].t;
      if (thrown) {
        if (thrown.t < arrives - 1e-9) early++;
        // he stands over it until he lets go of it
        if (chase.pts[chase.pts.length - 1].t < ball.find((p) => p.leg === 'field').t - 1e-9) held++;
      } else {
        idle++;
      }
      if (thrown && !chase) orphan++;
    }
  }
  check('a fielder runs down every ball in play', plays > 200, `${plays} plays`);
  check('the ball is never thrown before the fielder reaches it', early === 0, `${early} early`);
  check('no throw comes from an empty patch of grass', orphan === 0);
  check('a fielder never picks the ball up and just stands there', idle === 0, `${idle} idle`);
  check('the man on the ball holds it until it is released', held === 0);
}

// The ball waits on the ground where it came down, then goes.
{
  const g = T.simGameTri(NYY, LAD, ring, cfg, 9);
  const e = g.log.find((x) => x.defense && x.throwTo);
  const ball = e.anim.tracks[0].pts;
  const land = ball.find((p) => p.leg === 'batted');
  const got = ball.find((p) => p.leg === 'field');
  check('the ball holds where it landed until it is fielded',
    got && got.x === land.x && got.y === land.y && got.t >= land.t - 1e-9,
    `landed ${land.t.toFixed(2)}s, fielded ${got.t.toFixed(2)}s`);
  check('the wait matches the engine own fielding time',
    Math.abs((got.t - land.t) - (e.defense.tSecure - e.contact.distFt / 110)) < 1e-6);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
