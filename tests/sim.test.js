/* Engine sanity checks. Run: node tests/sim.test.js */
'use strict';
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const SIM = require(path.join(__dirname, '..', 'sim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS.find((t) => t.id === 'LAD');
const NYY = TEAMS.find((t) => t.id === 'NYY');

// 1. A single classic game finishes with a winner and a consistent line score.
const g = SIM.simGame(NYY, LAD, { bases: 3, innings: 9, outs: 3 }, 42);
check('game produces a winner', g.winner === 'home' || g.winner === 'away');
const awaySum = g.away.line.reduce((a, v) => a + (v === 'X' ? 0 : v), 0);
const homeSum = g.home.line.reduce((a, v) => a + (v === 'X' ? 0 : v), 0);
check('away line score sums to total', awaySum === g.away.runs, `${awaySum} vs ${g.away.runs}`);
check('home line score sums to total', homeSum === g.home.runs, `${homeSum} vs ${g.home.runs}`);
check('log run totals match', g.log.reduce((a, e) => a + e.runs, 0) === g.away.runs + g.home.runs);
check('same seed reproduces the game',
  JSON.stringify(SIM.simGame(NYY, LAD, { bases: 3 }, 42).log) === JSON.stringify(g.log));

// 2. Classic config produces believable MLB scoring (~3.5–6.5 runs per team).
const N = 2000;
const agg = SIM.simMany(NYY, LAD, { bases: 3 }, N, 1234);
const perTeam = (agg.awayRuns + agg.homeRuns) / (2 * N);
check('classic avg runs per team in 3.0–7.0', perTeam > 3.0 && perTeam < 7.0, perTeam.toFixed(2));
check('no ties survive', agg.ties === 0);
check('wins add up', agg.awayWins + agg.homeWins === N);

// 3. More bases → fewer runs, fewer bases → more runs (monotonic-ish curve).
const rows = SIM.scanBases(NYY, LAD, { innings: 9, outs: 3 }, 1, 7, 600, 99);
const runsAt = (b) => rows.find((r) => r.bases === b).avgTotalRuns;
check('1 base scores far more than classic', runsAt(1) > runsAt(3) * 1.5,
  `${runsAt(1).toFixed(1)} vs ${runsAt(3).toFixed(1)}`);
check('7 bases scores less than classic', runsAt(7) < runsAt(3),
  `${runsAt(7).toFixed(1)} vs ${runsAt(3).toFixed(1)}`);
console.log('   scan:', rows.map((r) => `${r.bases}b=${r.avgTotalRuns.toFixed(1)}`).join(' '));

// 4. Weird configs terminate and stay consistent.
for (const cfg of [
  { bases: 1, innings: 3, outs: 1 },
  { bases: 7, innings: 12, outs: 5 },
  { bases: 2, innings: 1, outs: 3 },
]) {
  const gg = SIM.simGame(LAD, NYY, cfg, 7);
  const ok = gg.innings <= cfg.innings + 30 && gg.log.length > 0;
  check(`cfg ${JSON.stringify(cfg)} terminates`, ok, `${gg.innings} innings`);
}

// 5. Walk-off: bottom-final entries never continue after home takes the lead.
let walkoffChecked = 0;
for (let s = 0; s < 300; s++) {
  const gw = SIM.simGame(NYY, LAD, { bases: 3 }, 5000 + s);
  const finals = gw.log.filter((e) => e.half === 'bottom' && e.inning >= 9);
  for (let i = 0; i < finals.length; i++) {
    if (finals[i].score.home > finals[i].score.away && i < finals.length - 1
        && finals[i + 1].inning === finals[i].inning) {
      check('no at-bat after walk-off lead', false, `seed ${5000 + s}`);
    }
  }
  if (finals.length) walkoffChecked++;
}
check('walk-off invariant sampled across games', walkoffChecked > 50, `${walkoffChecked} games`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
