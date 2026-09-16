/* moreBasesBall — rebuild data.js from the public sources.
 *
 *   node tools/build-data.mjs [firstYear] [lastYear]      (default 2021 2025)
 *
 * ---------------------------------------------------------------------------
 * DO NOT RUN THIS. data.js is frozen, and this script has a known bug.
 *
 * 1. data.js is frozen. It is the committed slice the browser sim loads, and
 *    its run environment is a PUBLISHED result — the runs/game figures in
 *    README.md (1 base ~18 runs/game, 7 bases ~6) and the byte-identical box
 *    score tests/ngon.test.js asserts. Regenerating data.js moves those
 *    numbers under the reader and turns the suite red. Regenerating it from
 *    the spine is a later sub-project, gated by a golden-run identity test.
 *
 * 2. This script double-counts traded players. The hydrate below asks for
 *    season hitting stats WITHOUT `,team)`, so `stats.splits[0]` (see the
 *    `split` line further down) is the player's COMBINED season line, and it
 *    gets stamped on whichever club happened to fetch him — 18 affected
 *    players in 2024 alone. tools/build-seasons.mjs fixes this with its
 *    `ownSplit` helper plus a `,team)` on the hydrate; this file was left
 *    unfixed deliberately, because fixing it would change data.js.
 *
 * So running this both unfreezes data.js and reintroduces the traded-player
 * double-count. The npm script is named `build:data:frozen-do-not-run` for
 * the same reason. Use tools/build-seasons.mjs for the data spine instead.
 * ---------------------------------------------------------------------------
 *
 * Two sources, joined on MLBAM player id — an exact join, never name matching:
 *   statsapi.mlb.com        full-season rosters + season hitting lines
 *   baseballsavant.mlb.com  Statcast sprint-speed leaderboard (CSV), which
 *                           carries sprint_speed AND hp_to_1b
 *
 * For each club and season it keeps the nine batters with the most plate
 * appearances. Writes data.js in the repo root. No key, no dependencies.
 *
 * The run model in graphsim.js is calibrated off the two Statcast columns,
 * so a rebuild that silently fell back to league medians would quietly flatten
 * every runner — the per-year log line reports how many were median-filled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, getText, pool, parseCsv, csvBody } from './lib/fetch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
const OUT = outFlag > -1 ? process.argv[outFlag + 1] : path.join(ROOT, 'data.js');
const argv = process.argv.slice(2)
  .filter((a, i, all) => a !== '--out' && all[i - 1] !== '--out')
  .map(Number).filter(Number.isFinite);
const FIRST = argv[0] || 2021;
const LAST = argv[1] || 2025;
const YEARS = [];
for (let y = FIRST; y <= LAST; y++) YEARS.push(y);

// Club colours are editorial, not sourced; an unknown club gets neutral slate.
const COLORS = {
  LAD: '#4A90D9', NYY: '#7E93A8', PHI: '#D94A4A', ATL: '#C74B5B', HOU: '#E08A3C',
  NYM: '#4C7FD9', BAL: '#E8722C', SD: '#C6A15B', CLE: '#B23A48', TEX: '#4E7FC1',
  SF: '#D9743F', SEA: '#3E8F86', MIN: '#3F7FBF', CHC: '#4470B5', STL: '#C0453F',
  MIL: '#5B8C6E', ARI: '#B2455C', TOR: '#4A8FD9', BOS: '#C7443F', TB: '#4C8FA8',
  DET: '#4472A8', KC: '#4A73C1', CWS: '#8A97A5', LAA: '#B8434B', ATH: '#4C8A6B',
  WSH: '#C24A55', MIA: '#3E9BA8', PIT: '#D0A03F', CIN: '#C1454A', COL: '#6E7FA8',
};

const esc = (s) => JSON.stringify(String(s));
const NL = '\n';

const seasons = {};
for (const year of YEARS) {
  const list = await getJson(
    `https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${year}`);
  const clubs = list.teams.filter((t) => t.sport && t.sport.id === 1);

  const rows = await pool(clubs, 4, async (club) => {
    const url = `https://statsapi.mlb.com/api/v1/teams/${club.id}/roster`
      + `?season=${year}&rosterType=fullSeason`
      + `&hydrate=person(stats(type=season,group=hitting,season=${year}))`;
    const j = await getJson(url);
    const players = [];
    for (const spot of j.roster || []) {
      const stats = spot.person && spot.person.stats && spot.person.stats[0];
      const split = stats && stats.splits && stats.splits[0];
      const st = split && split.stat;
      const pos = spot.position && spot.position.abbreviation;
      if (!st || !st.plateAppearances || pos === 'P') continue;
      players.push({
        name: spot.person.fullName, id: spot.person.id, pos,
        pa: st.plateAppearances, h: st.hits, d2: st.doubles, d3: st.triples,
        hr: st.homeRuns, bb: st.baseOnBalls + (st.hitByPitch || 0), so: st.strikeOuts,
      });
    }
    players.sort((a, b) => b.pa - a.pa);
    return { abbr: club.abbreviation, name: club.name, players };
  });

  const csv = parseCsv(await getText(
    `https://baseballsavant.mlb.com/leaderboard/sprint_speed`
    + `?year=${year}&position=&team=&min=10&csv=true`, csvBody));
  const byId = new Map(csv.map((r) => [
    +r.player_id, { spd: +r.sprint_speed, hp: +r.hp_to_1b },
  ]));
  const speeds = csv.map((r) => +r.sprint_speed)
    .filter(Number.isFinite).sort((a, b) => a - b);
  const hps = csv.map((r) => +r.hp_to_1b)
    .filter((x) => x > 0).sort((a, b) => a - b);
  const medSpd = speeds[Math.floor(speeds.length / 2)];
  const medHp = hps[Math.floor(hps.length / 2)];

  let matched = 0;
  let filled = 0;
  const thin = [];
  seasons[year] = rows.slice()
    .sort((a, b) => (a.abbr < b.abbr ? -1 : a.abbr > b.abbr ? 1 : 0))
    .map((t) => {
      if (t.players.length < 9) thin.push(t.abbr);
      return {
        abbr: t.abbr, name: t.name,
        lineup: t.players.slice(0, 9).map((p) => {
          const m = byId.get(p.id);
          if (m && Number.isFinite(m.spd)) matched++; else filled++;
          return Object.assign({}, p, {
            spd: m && Number.isFinite(m.spd) ? m.spd : medSpd,
            hp1: m && m.hp > 0 ? m.hp : medHp,
          });
        }),
      };
    });

  console.log(`${year}  clubs ${seasons[year].length}`
    + `  sprint matched ${matched}  median-filled ${filled}`
    + (thin.length ? `  THIN: ${thin.join(',')}` : ''));
}

const ys = Object.keys(seasons).map(Number).sort((a, b) => a - b);
const span = `${ys[0]}–${ys[ys.length - 1]}`;

let out = '';
out += '/* moreBasesBall — team data' + NL;
out += ' * Real MLB regular-season batting lines and Statcast running data for' + NL;
out += ` * ${span}: every club, nine batters each (the nine with the most` + NL;
out += ' * plate appearances that season).' + NL;
out += ' *' + NL;
out += ' * Batting lines: MLB Stats API (statsapi.mlb.com) full-season rosters.' + NL;
out += ' * Running data: Baseball Savant Statcast sprint-speed leaderboards,' + NL;
out += ' * joined on MLBAM player id — every batter carries his own measured' + NL;
out += ' * numbers, none are league averages.' + NL;
out += ' *   spd  sprint speed, ft/s, peak in his fastest one-second window' + NL;
out += ' *   hp1  home-to-first, seconds, his average competitive run' + NL;
out += ' * Those two are what the run model in graphsim.js is calibrated from;' + NL;
out += ' * see RUN MODEL there. bb includes hit-by-pitch.' + NL;
out += ' *' + NL;
out += ' * GENERATED — rebuild with `node tools/build-data.mjs`, do not hand-edit.' + NL;
out += ' */' + NL;
out += '(function (global) {' + NL;
out += "  'use strict';" + NL + NL;
out += '  // p = [name, pos, PA, H, 2B, 3B, HR, BB, SO, sprint_ft_s, hp_to_1b_s]' + NL;
out += '  function P(a) {' + NL;
out += '    return {' + NL;
out += '      name: a[0], pos: a[1], pa: a[2], h: a[3],' + NL;
out += '      d2: a[4], d3: a[5], hr: a[6], bb: a[7], so: a[8],' + NL;
out += '      spd: a[9], hp1: a[10],' + NL;
out += '    };' + NL;
out += '  }' + NL + NL;
out += '  const SEASONS = {' + NL;

for (const y of ys) {
  out += `    ${y}: [` + NL;
  for (const t of seasons[y]) {
    out += `      { id: ${esc(t.abbr)}, name: ${esc(t.name)}, abbr: ${esc(t.abbr)},`
      + ` color: ${esc(COLORS[t.abbr] || '#6E8A9B')},` + NL + '        lineup: [' + NL;
    for (const p of t.lineup) {
      out += `          P([${esc(p.name)}, ${esc(p.pos)}, ${p.pa}, ${p.h}, ${p.d2}, `
        + `${p.d3}, ${p.hr}, ${p.bb}, ${p.so}, ${p.spd}, ${p.hp1}]),` + NL;
    }
    out += '        ] },' + NL;
  }
  out += '    ],' + NL;
}

out += '  };' + NL + NL;
out += '  const YEARS = Object.keys(SEASONS).map(Number).sort((a, b) => b - a);' + NL;
out += '  const DEFAULT_YEAR = YEARS[0];' + NL + NL;
out += '  // TEAMS is the selected season; the UI swaps it with setYear.' + NL;
out += '  let TEAMS = SEASONS[DEFAULT_YEAR];' + NL + NL;
out += '  const API = {' + NL;
out += '    get TEAMS() { return TEAMS; },' + NL;
out += '    SEASONS, YEARS, DEFAULT_YEAR,' + NL;
out += '    teamsFor(year) { return SEASONS[year] || SEASONS[DEFAULT_YEAR]; },' + NL;
out += '    setYear(year) { TEAMS = SEASONS[year] || TEAMS; return TEAMS; },' + NL;
out += '  };' + NL + NL;
out += "  if (typeof module !== 'undefined' && module.exports) module.exports = API;" + NL;
out += '  else global.MBB_DATA = API;' + NL;
out += "})(typeof window !== 'undefined' ? window : globalThis);" + NL;

fs.writeFileSync(OUT, out);
console.log(`wrote data.js  ${(out.length / 1024).toFixed(0)}KB  `
  + `${ys.length} seasons  ${ys.reduce((n, y) => n + seasons[y].length, 0)} lineups`);
