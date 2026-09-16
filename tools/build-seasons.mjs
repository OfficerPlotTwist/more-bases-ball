/* moreBasesBall — build data/seasons/{year}.parquet and data/league/{year}.parquet
 *
 *   node tools/build-seasons.mjs [firstYear] [lastYear]      (default 1876 2025)
 *
 * Source: the MLB Stats API (statsapi.mlb.com) — see
 * .superpowers/sdd/2026-09-15-data-spine/task-3-addendum.md for why this
 * replaces the brief's baseballdatabank CSVs (that mirror is dead: 404 on
 * master and main, and every fork is stale).
 *
 * Per year: fetch the club list, then for each club two roster-hydrate
 * fetches (hitting, pitching) via the same pattern tools/build-data.mjs
 * already uses. The one-shot `/api/v1/stats?playerPool=All` leaderboard is
 * NOT used — it is missing players (probed: 606 pitching splits for 2000,
 * Pedro Martinez absent) and carries no team attribution.
 *
 * `inningsPitched` is a string in thirds ("216.1" = 216 and a third, not
 * 216.1) — see toOuts() below. Treating it as a float would silently corrupt
 * every pitcher line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, pool, cacheStats } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'seasons');
const LEAGUE = path.join(ROOT, 'data', 'league');
const TMP = path.join(ROOT, 'data', '.cache', 'seasons-tmp');
const API = 'https://statsapi.mlb.com/api/v1';

const argv = process.argv.slice(2).map(Number).filter(Number.isFinite);
const FIRST = argv[0] || 1876;
const LAST = argv[1] || 2025;

/* "217.0" -> 651 outs, "216.1" -> 649 outs. A float parse of "216.1" gives
 * 216.1, which is wrong by two thirds of an inning — this is the fix. */
export const toOuts = (ip) => {
  if (ip == null) return null;
  const [w, f] = String(ip).split('.');
  return Number(w) * 3 + Number(f || 0);
};

const leagueAbbrCache = new Map();
async function leagueAbbr(id, name) {
  if (id == null) return name || null;
  if (leagueAbbrCache.has(id)) return leagueAbbrCache.get(id);
  let abbr = name || String(id);
  try {
    const j = await getJson(`${API}/league/${id}`);
    abbr = (j.leagues && j.leagues[0] && j.leagues[0].abbreviation) || abbr;
  } catch { /* fall back to the league name already on the club record */ }
  leagueAbbrCache.set(id, abbr);
  return abbr;
}

const COLUMNS = `
    CAST(year AS INTEGER) AS year, CAST(mlbam AS INTEGER) AS mlbam,
    CAST(bbref AS VARCHAR) AS bbref, CAST(name AS VARCHAR) AS name,
    CAST(pos AS VARCHAR) AS pos, CAST(team AS VARCHAR) AS team,
    CAST(lg AS VARCHAR) AS lg, CAST(role AS VARCHAR) AS role,
    CAST(pa AS INTEGER) AS pa, CAST(ab AS INTEGER) AS ab, CAST(h AS INTEGER) AS h,
    CAST(d2 AS INTEGER) AS d2, CAST(d3 AS INTEGER) AS d3, CAST(hr AS INTEGER) AS hr,
    CAST(bb AS INTEGER) AS bb, CAST(so AS INTEGER) AS so,
    CAST(sb AS INTEGER) AS sb, CAST(cs AS INTEGER) AS cs, CAST(hbp AS INTEGER) AS hbp,
    CAST(ipouts AS INTEGER) AS ipouts, CAST(er AS INTEGER) AS er, CAST(bf AS INTEGER) AS bf,
    CAST(p_h AS INTEGER) AS p_h, CAST(p_bb AS INTEGER) AS p_bb, CAST(p_so AS INTEGER) AS p_so,
    CAST(p_hr AS INTEGER) AS p_hr`;

async function main() {
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(LEAGUE, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const db = await openDb();

const seasonYears = [];
const leagueYears = [];
let totalBat = 0;
let totalPit = 0;

for (let year = FIRST; year <= LAST; year++) {
  const list = await getJson(`${API}/teams?sportId=1&season=${year}`);
  const clubs = (list.teams || []).filter((t) => t.sport && t.sport.id === 1);
  if (!clubs.length) continue;

  const lgByClub = new Map();
  await Promise.all(clubs.map(async (c) => {
    lgByClub.set(c.id, await leagueAbbr(c.league && c.league.id, c.league && c.league.name));
  }));

  const perClub = await pool(clubs, 8, async (club) => {
    const lg = lgByClub.get(club.id);
    const hitUrl = `${API}/teams/${club.id}/roster?season=${year}&rosterType=fullSeason`
      + `&hydrate=person(stats(type=season,group=hitting,season=${year}))`;
    const pitUrl = `${API}/teams/${club.id}/roster?season=${year}&rosterType=fullSeason`
      + `&hydrate=person(stats(type=season,group=pitching,season=${year}))`;
    const [hj, pj] = await Promise.all([getJson(hitUrl), getJson(pitUrl)]);
    const rows = [];

    for (const spot of hj.roster || []) {
      const stats = spot.person && spot.person.stats && spot.person.stats[0];
      const split = stats && stats.splits && stats.splits[0];
      const st = split && split.stat;
      if (!st) continue;
      rows.push({
        year, mlbam: spot.person.id, bbref: null, name: spot.person.fullName,
        pos: (spot.position && spot.position.abbreviation) || null,
        team: club.abbreviation, lg, role: 'bat',
        pa: st.plateAppearances ?? null, ab: st.atBats ?? null, h: st.hits ?? null,
        d2: st.doubles ?? null, d3: st.triples ?? null, hr: st.homeRuns ?? null,
        bb: st.baseOnBalls ?? null, so: st.strikeOuts ?? null,
        sb: st.stolenBases ?? null, cs: st.caughtStealing ?? null,
        hbp: st.hitByPitch ?? null,
        ipouts: null, er: null, bf: null, p_h: null, p_bb: null, p_so: null, p_hr: null,
      });
    }
    for (const spot of pj.roster || []) {
      const stats = spot.person && spot.person.stats && spot.person.stats[0];
      const split = stats && stats.splits && stats.splits[0];
      const st = split && split.stat;
      if (!st) continue;
      rows.push({
        year, mlbam: spot.person.id, bbref: null, name: spot.person.fullName,
        pos: (spot.position && spot.position.abbreviation) || null,
        team: club.abbreviation, lg, role: 'pit',
        pa: null, ab: null, h: null, d2: null, d3: null, hr: null, bb: null, so: null,
        sb: null, cs: null, hbp: null,
        ipouts: toOuts(st.inningsPitched), er: st.earnedRuns ?? null,
        bf: st.battersFaced ?? null, p_h: st.hits ?? null, p_bb: st.baseOnBalls ?? null,
        p_so: st.strikeOuts ?? null, p_hr: st.homeRuns ?? null,
      });
    }
    return rows;
  });

  const rows = perClub.flat();
  if (rows.length) {
    const tmpFile = path.join(TMP, `${year}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(rows));
    const src = sqlPath(tmpFile);
    const outFile = sqlPath(path.join(OUT, `${year}.parquet`));
    await db.run(`COPY (SELECT${COLUMNS} FROM read_json_auto('${src}'))
      TO '${outFile}' (FORMAT PARQUET)`);
    fs.rmSync(tmpFile);
    seasonYears.push(year);
    totalBat += rows.filter((r) => r.role === 'bat').length;
    totalPit += rows.filter((r) => r.role === 'pit').length;
  }

  const [hitJ, pitJ] = await Promise.all([
    getJson(`${API}/teams/stats?stats=season&group=hitting&season=${year}&sportId=1`),
    getJson(`${API}/teams/stats?stats=season&group=pitching&season=${year}&sportId=1`),
  ]);
  const hitSplits = (hitJ.stats && hitJ.stats[0] && hitJ.stats[0].splits) || [];
  const pitSplits = (pitJ.stats && pitJ.stats[0] && pitJ.stats[0].splits) || [];
  const raById = new Map(pitSplits.map((s) => [s.team.id, s.stat.runs ?? null]));
  const abbrById = new Map(clubs.map((c) => [c.id, c.abbreviation]));

  const leagueRows = hitSplits.map((s) => ({
    year, team: abbrById.get(s.team.id) || s.team.name,
    lg: lgByClub.get(s.team.id) || null,
    g: s.stat.gamesPlayed ?? null, r: s.stat.runs ?? null,
    ra: raById.get(s.team.id) ?? null,
    ab: s.stat.atBats ?? null, h: s.stat.hits ?? null,
    d2: s.stat.doubles ?? null, d3: s.stat.triples ?? null, hr: s.stat.homeRuns ?? null,
    bb: s.stat.baseOnBalls ?? null, so: s.stat.strikeOuts ?? null,
  }));

  if (leagueRows.length) {
    const tmpFile = path.join(TMP, `league-${year}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(leagueRows));
    const src = sqlPath(tmpFile);
    const outFile = sqlPath(path.join(LEAGUE, `${year}.parquet`));
    await db.run(`COPY (SELECT
        CAST(year AS INTEGER) AS year, CAST(team AS VARCHAR) AS team,
        CAST(lg AS VARCHAR) AS lg, CAST(g AS INTEGER) AS g, CAST(r AS INTEGER) AS r,
        CAST(ra AS INTEGER) AS ra, CAST(ab AS INTEGER) AS ab, CAST(h AS INTEGER) AS h,
        CAST(d2 AS INTEGER) AS d2, CAST(d3 AS INTEGER) AS d3, CAST(hr AS INTEGER) AS hr,
        CAST(bb AS INTEGER) AS bb, CAST(so AS INTEGER) AS so
      FROM read_json_auto('${src}')) TO '${outFile}' (FORMAT PARQUET)`);
    fs.rmSync(tmpFile);
    leagueYears.push(year);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

const cs = cacheStats();
console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
console.log(`league  ${leagueYears.length} seasons of team totals`);
console.log(`seasons ${seasonYears[0]}–${seasonYears[seasonYears.length - 1]}  files ${seasonYears.length}`);
console.log(`  bat  ${totalBat} player-seasons`);
console.log(`  pit  ${totalPit} player-seasons`);

await db.close();
}

/* Only run the build when executed directly — importing this module (for
 * toOuts, in tests) must not trigger ~6000 network requests. */
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
