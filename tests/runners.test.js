/* Runner rules against real baseball. Run: node tests/runners.test.js
 *
 * The two that matter, and that the engine used to get wrong:
 *
 *   Force. A runner only has to run when the base behind him is being
 *   taken. The engine used to shove every runner off on any ground ball,
 *   which is not a rule — it is why runners were being doubled up off
 *   bases they never had to leave.
 *
 *   Tagging up. On a ball caught in the air nobody is forced anywhere, and
 *   a runner who goes cannot leave until the catch. The engine used to let
 *   everyone break at contact, so runners were halfway to the next base
 *   while the ball was still in the air.
 */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));
const T = require(path.join(__dirname, '..', 'trisim.js'));
const F = require(path.join(__dirname, '..', 'fielders.js'));
const { resolveBallOut, buildAnim } = G._internals;

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];
const HIT_FTS = 110;

/* ---------------- a controlled situation ---------------- */

const diamond = L.makeNgon(5, 90);
const dPaths = L.buildPaths(diamond);
const dSlots = F.fielderSlots(diamond);
const batter = { name: 'Batter Up', pos: 'DH' };
const coin = () => 0.5;                       // kills the ±0.4s judgement noise

// A point `ft` from home plate along the line to the middle of the field.
function outAt(ft) {
  const h = L.findNode(diamond, 'H1');
  const c = L.basesCentroid(diamond);
  const dx = c.x - h.x, dy = c.y - h.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: h.x + (dx / len) * ft * L.FT2PX, y: h.y + (dy / len) * ft * L.FT2PX, distFt: ft };
}

/* A ground ball hit straight at an infielder. This has to be a ball the
 * defense handles cleanly: a grounder into a gap takes so long to run down
 * that every runner advances on merit, which tells you nothing about who
 * was obliged to run.
 */
function grounderAt() {
  const h = L.findNode(diamond, 'H1');
  for (const s of dSlots) {
    if (s.role !== 'IF') continue;
    const d = Math.hypot(s.x - h.x, s.y - h.y) / L.FT2PX;
    if (d > 55 && d < 145) return { x: s.x, y: s.y, distFt: d };
  }
  return null;
}

// A ball dropped right on a fielder, so it is definitely caught.
function caughtAt() {
  const h = L.findNode(diamond, 'H1');
  let best = null, bd = 0;
  for (const s of dSlots) {
    const d = Math.hypot(s.x - h.x, s.y - h.y) / L.FT2PX;
    if (d > bd && s.role !== 'C') { bd = d; best = s; }
  }
  return { x: best.x, y: best.y, distFt: bd };
}

function situation(onBases, contact) {
  const occ = new Map();
  for (const node of onBases) {
    occ.set(node, { name: 'Runner ' + node, target: 'H1', origin: 'H1' });
  }
  const entry = {
    inning: 1, half: 'top', team: 'NYY', batter: batter.name, pos: 'DH',
    plate: 'H1', type: 'OUT', sub: null,
    runs: 0, scorers: [], runnersOut: [], moves: [], contact, throwTo: null,
  };
  const outs = resolveBallOut(occ, batter, 'H1', 'H1', diamond, dPaths, entry,
    coin, () => true, contact, dSlots);
  return { entry, occ, outs, moved: (n) => entry.moves.some((m) => m.path[0] === n) };
}

const grounder = grounderAt();
const fly = caughtAt();
check('the test fixture really is a ground ball, fielded cleanly',
  grounder && grounder.distFt < 150, grounder ? `${grounder.distFt.toFixed(0)}ft` : 'none');
check('the test fixture really is a catch',
  fly.distFt >= 150, `${fly.distFt.toFixed(0)}ft to a fielder standing there`);

/* ---------------- force ---------------- */

// The batter is running at first, so the man on first has to vacate.
const forcedMan = situation(['N1'], grounder);
check('a runner whose base the batter is taking must run', forcedMan.moved('N1'));

// The force runs down the chain: first is taken, so second must go too.
const chain = situation(['N1', 'N2'], grounder);
check('the force carries down the chain', chain.moved('N1') && chain.moved('N2'));

/* Force is only ever provable as a differential on one play. An unforced
 * runner still advances whenever it is a good idea — a bag nobody can get
 * to in time is a free base, by design — so "he did not move" on its own
 * proves nothing. Comparing two runners on the same ball does: the man
 * being pushed off has to go, the man behind the gap does not.
 */
const broken = situation(['N1', 'N3'], grounder);
check('the force stops at the first empty base',
  broken.moved('N1') && !broken.moved('N3'),
  'N1 pushed off, N3 left alone');

// A ground ball to the infield with the catcher standing on the plate is
// not a contact play: the man on third stays where he is, and so does
// everyone else who is not being pushed. This is the case the old engine
// got wrong by shoving every runner off on any ground ball.
check('an infield grounder does not send the runner on third home',
  !broken.moved('N3') && !situation(['N5'], grounder).moved('N5'));

/* ---------------- the catch removes the force ---------------- */

const flyForce = situation(['N1'], fly);
check('a catch removes the force — the man on first holds', !flyForce.moved('N1'));

const flyChain = situation(['N1', 'N2'], fly);
check('a catch removes it for everyone', !flyChain.moved('N1') && !flyChain.moved('N2'));

// Same men, same bases, ground ball instead: now they have to run. This is
// the whole difference a catch makes.
const groundChain = situation(['N1', 'N2'], grounder);
check('the same runners must run when the ball is on the ground',
  groundChain.moved('N1') && groundChain.moved('N2'));

/* ---------------- tagging up, on a field big enough for it ---------------- */

const ring = L.makeStarter(250);
let tagged = 0, early = 0, beforeContact = 0, taggedScored = 0, tagFar = 0;
let caughtWithRunners = 0, groundersRun = 0;

for (let s = 0; s < 40; s++) {
  const g = T.simGameTri(NYY, LAD, ring, { innings: 9, outs: 3 }, s);
  let prev = [], key = '';
  for (const e of g.log) {
    const k = e.inning + '|' + e.half;
    if (k !== key) { prev = []; key = k; }
    if (e.defense && e.contact) {
      const flight = e.contact.distFt / HIT_FTS;
      const isCaught = e.contact.distFt >= 150 && e.defense.tReach <= flight;
      if (isCaught && prev.length) caughtWithRunners++;
      for (const mv of e.moves || []) {
        if (mv.name === e.batter) continue;
        const tGo = mv.tGo || 0;
        if (tGo < -1e-9) beforeContact++;
        if (isCaught && tGo > 0) {
          tagged++;
          if (mv.scored) taggedScored++;
          const bagP = L.findNode(ring, mv.path[mv.path.length - 1]);
          if (bagP && Math.hypot(bagP.x - e.contact.x, bagP.y - e.contact.y) / L.FT2PX > 150) tagFar++;
          // he cannot leave before the ball is in the glove
          if (tGo < e.defense.tSecure - 1e-6) early++;
        }
        if (!isCaught && tGo > 0) groundersRun++;
      }
    }
    prev = e.occupancyAfter || [];
  }
}

check('no runner ever leaves before contact', beforeContact === 0);
check('runners do tag up when it pays', tagged > 0, `${tagged} tag-ups`);
check('a tagging runner never leaves before the catch', early === 0);
// Rate is a property of the geometry; what has to hold is that a runner
// only tags when the throw is genuinely long enough to beat.
check('every tag-up is taken on a long throw, never a routine one',
  tagFar === tagged, `${tagged} attempts, ${tagFar} on throws over 150ft`);
check('nobody waits for a catch that never happened', groundersRun === 0);
check('most caught flies freeze the runners, as they should',
  tagged / Math.max(1, caughtWithRunners) < 0.25,
  `${tagged} went of ${caughtWithRunners} chances`);

/* The willingness to gamble for a run is a real modelled behaviour, and
 * where it shows up is the sacrifice fly. Real baseball runs about one sac
 * fly per nine runs scored; the rate here is checked against that rather
 * than against a raw count, because this game scores far more than MLB and
 * the count would drift with any rules change.
 */
let sacs = 0, totalRuns = 0;
for (let s = 0; s < 40; s++) {
  const g = T.simGameTri(NYY, LAD, ring, { innings: 9, outs: 3 }, s);
  totalRuns += g.away.runs + g.home.runs;
  for (const e of g.log) if (e.sub === 'SF') sacs++;
}
const perRun = sacs / totalRuns;
check('runners cash in from a step away at about the real rate',
  perRun > 0.05 && perRun < 0.25,
  `${(perRun).toFixed(3)} sac flies per run (MLB ~0.11)`);

/* ---------------- the animation shows what the engine decided ---------------- */

let animEarly = 0, animChecked = 0;
for (let s = 0; s < 20; s++) {
  for (const e of T.simGameTri(NYY, LAD, ring, { innings: 9, outs: 3 }, s).log) {
    if (!e.defense || !e.contact) continue;
    const ball = e.anim.tracks[0].pts;
    const fielded = ball.find((p) => p.leg === 'field');
    if (!fielded) continue;
    for (const mv of e.moves || []) {
      if (!(mv.tGo > 0)) continue;
      const tr = e.anim.tracks.find((t) => t.kind === 'runner' && t.name === mv.name);
      if (!tr) continue;
      animChecked++;
      // on screen he is still standing on the bag when the ball is caught
      if (tr.pts[0].t < fielded.t - 1e-6) animEarly++;
    }
  }
}
check('a tagging runner is still on the bag when the catch happens on screen',
  animEarly === 0, `${animChecked} checked`);

/* ---------------- throws behave like throws ---------------- */

const ts = G._internals.throwSec;
check('a short infield throw is essentially pure flight',
  Math.abs(ts(60) - 60 / 135) < 0.1, `${ts(60).toFixed(2)}s`);
check('a 300ft throw goes through the cutoff man and takes ~3s',
  ts(300) > 2.7 && ts(300) < 3.5, `${ts(300).toFixed(2)}s`);
check('throw time rises monotonically with distance',
  [40, 90, 150, 200, 260, 330, 420].every((d, i, a) => i === 0 || ts(d) > ts(a[i - 1])));
check('a relayed throw is slower per foot than a short one',
  ts(400) / 400 > ts(100) / 100);

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
