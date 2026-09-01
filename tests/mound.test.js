/* Mound-distance adjustment checks. Run: node tests/mound.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const S = require(path.join(__dirname, '..', 'sim.js'));
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];
const judge = NYY.lineup[2];

// 1. Zero delta is bit-identical to the legacy path (same RNG stream).
let identical = true;
const r1 = S.mulberry32(7), r2 = S.mulberry32(7);
for (let i = 0; i < 5000; i++) {
  if (S.plateAppearance(judge, r1) !== S.plateAppearance(judge, r2, 0)) identical = false;
}
check('delta 0 leaves outcomes untouched', identical);

// 2. Direction of the adjusted rates matches the sources:
//    farther mound → fewer K, fewer BB (Atlantic League), more hits.
const reg = S.adjustedRates(judge, 0);
const back = S.adjustedRates(judge, 3);   // 63.5 ft
const close = S.adjustedRates(judge, -3); // 57.5 ft
const hits = (a) => a.hr + a.d3 + a.d2 + a.s1;
check('farther: strikeouts fall', back.k < reg.k,
  `${(reg.k * 100).toFixed(1)}% → ${(back.k * 100).toFixed(1)}%`);
check('farther: hits rise', hits(back) > hits(reg),
  `${(hits(reg) * 100).toFixed(1)}% → ${(hits(back) * 100).toFixed(1)}%`);
check('farther: walks dip (AL 2021 result)', back.bb < reg.bb);
check('closer: strikeouts rise, hits fall', close.k > reg.k && hits(close) < hits(reg));
// per-foot magnitude stays modest, as the Atlantic League found at ±1 ft
const one = S.adjustedRates(judge, 1);
check('±1 ft effect is small (<1.5pp K shift)', Math.abs(one.k - reg.k) < 0.015,
  `${((one.k - reg.k) * 100).toFixed(2)}pp`);

// 3. Probabilities stay sane at the extremes.
for (const d of [-15, -8, 8, 15]) {
  const a = S.adjustedRates(judge, d);
  const total = a.bb + a.hr + a.d3 + a.d2 + a.s1 + a.k;
  const sane = total < 1 && Object.values(a).every((v) => v >= 0);
  check(`delta ${d} ft keeps probabilities valid`, sane, `sum=${total.toFixed(3)}`);
}

// 4. Full games respond: runs go up as the mound backs off, K count down.
const cfg = { innings: 9, outs: 3 };
const N = 600;
function measure(moundDist) {
  const lay = Object.assign({}, L.makeStarter(250), { moundDist, pitchMode: 'seq' });
  let runs = 0, ks = 0;
  for (let i = 0; i < N; i++) {
    const g = G.simGameGraph(NYY, LAD, lay, cfg, (100 + i * 7919) >>> 0);
    runs += g.away.runs + g.home.runs;
    ks += g.log.filter((e) => e.type === 'K').length;
  }
  return { runs: runs / N, ks: ks / N };
}
const m55 = measure(55), m605 = measure(60.5), m66 = measure(66);
check('runs: 55 ft < 60.5 ft < 66 ft',
  m55.runs < m605.runs && m605.runs < m66.runs,
  `${m55.runs.toFixed(1)} / ${m605.runs.toFixed(1)} / ${m66.runs.toFixed(1)} per game`);
check('strikeouts: 55 ft > 60.5 ft > 66 ft',
  m55.ks > m605.ks && m605.ks > m66.ks,
  `${m55.ks.toFixed(1)} / ${m605.ks.toFixed(1)} / ${m66.ks.toFixed(1)} per game`);

// 5. The rendered mound tracks the configured distance (px = ft × scale).
const lay = L.makeStarter(250);
lay.moundDist = 66;
const m = L.moundPositions(lay)[0];
const h = lay.homes[0];
const distPx = Math.hypot(m.x - h.x, m.y - h.y);
check('mound renders at its true distance', Math.abs(distPx - 66 * L.FT2PX) < 0.5,
  `${distPx.toFixed(1)}px vs ${(66 * L.FT2PX).toFixed(1)}px`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
