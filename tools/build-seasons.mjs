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
const MANIFEST = path.join(ROOT, 'data', '_build.json');
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

/* A traded player's splits[0] is the COMBINED season total (carries
 * numTeams), not that club's line — per-club lines are splits[1..N]. The
 * hydrate must ask for `team` on the stat split or `split.team` is absent
 * everywhere and a club-id match finds nothing. Never fall back to a
 * numTeams-bearing split: a combined line attributed to one club is the
 * exact bug this exists to prevent. */
function ownSplit(stats, clubId) {
  const splits = (stats && stats.splits) || [];
  const own = splits.find((s) => s.team && s.team.id === clubId);
  /* A lone split may only be used as a fallback if it carries NO team at
   * all. If it names a team, that team must match clubId — a roster spot
   * fetched from a DIFFERENT club can return the same single split (e.g.
   * a two-way player's one-inning pitching line, shared verbatim across
   * every club that carried him that season) and it must not be accepted
   * just because it's the only split present. */
  const teamless = splits.length === 1 && !splits[0].team && !splits[0].numTeams
    ? splits[0] : null;
  return own || teamless || null;
}

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
const failures = [];
/* Per-year accounting for data/_build.json. A short parquet file is
 * byte-indistinguishable from a complete one, so the manifest is what
 * downstream tasks check; `complete` is the single flag they gate on. */
const years = [];
const startedAt = new Date().toISOString();
let finishedLoop = false;

/* `clubsFetched` only says the two roster requests resolved — a club whose
 * fetch succeeds but yields no usable rows still counts. Completeness must
 * therefore also require `clubsWithRows`, or a year short a whole club's
 * worth of players can still be asserted complete. Keep both fields: "fetch
 * failed" and "fetched but empty" are different diagnoses. */
const yearIsClean = (y) => y.clubsFetched === y.clubsExpected
  && y.clubsWithRows === y.clubsExpected;

const writeManifest = () => {
  const complete = finishedLoop && failures.length === 0 && years.every(yearIsClean);
  const body = `${JSON.stringify({
    tool: 'build-seasons.mjs',
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    firstYear: FIRST,
    lastYear: LAST,
    years,
    failures,
  }, null, 2)}\n`;
  /* Write-then-rename: a kill mid-write must never leave corrupt JSON in
   * the one artifact downstream tasks gate on. rename is atomic on NTFS
   * and POSIX alike. */
  const tmp = `${MANIFEST}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, MANIFEST);
  return complete;
};

let manifestComplete = false;

try {
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
      + `&hydrate=person(stats(type=season,group=hitting,season=${year},team))`;
    const pitUrl = `${API}/teams/${club.id}/roster?season=${year}&rosterType=fullSeason`
      + `&hydrate=person(stats(type=season,group=pitching,season=${year},team))`;
    /* The try wraps the FETCH ONLY — the same shape the league-stats
     * fetch below uses. Row building must stay outside it: a TypeError
     * from a code bug has to crash the build, not be printed as a WARN
     * and silently degraded into "one club had a transient problem".
     * If that means a genuinely malformed payload aborts the run, that
     * is the correct trade — it is a bug worth surfacing. */
    let hj;
    let pj;
    try {
      [hj, pj] = await Promise.all([getJson(hitUrl), getJson(pitUrl)]);
    } catch (e) {
      const reason = (e && e.message) || String(e);
      failures.push({ year, club: club.abbreviation, error: reason });
      console.log(`WARN ${year} ${club.abbreviation}: ${reason}`);
      return { ok: false, rows: [] };
    }

    const rows = [];
    for (const spot of hj.roster || []) {
      const stats = spot.person && spot.person.stats && spot.person.stats[0];
      const split = ownSplit(stats, club.id);
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
      const split = ownSplit(stats, club.id);
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
    return { ok: true, rows };
  });

  const fetchedClubs = perClub.filter((r) => r.ok).length;
  if (fetchedClubs !== clubs.length) {
    console.log(`WARN ${year}: expected ${clubs.length} clubs, fetched ${fetchedClubs}`);
  }
  const clubsWithRows = perClub.filter((r) => r.rows.length > 0).length;
  if (clubsWithRows !== clubs.length) {
    console.log(`WARN ${year}: expected ${clubs.length} clubs, ${clubsWithRows} contributed rows`);
  }
  const entry = {
    year, clubsExpected: clubs.length, clubsFetched: fetchedClubs, clubsWithRows,
    seasonRows: 0, leagueRows: 0,
  };
  years.push(entry);

  const rows = perClub.flatMap((r) => r.rows);
  if (rows.length) {
    const tmpFile = path.join(TMP, `${year}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(rows));
    const src = sqlPath(tmpFile);
    const outFile = sqlPath(path.join(OUT, `${year}.parquet`));
    await db.run(`COPY (SELECT${COLUMNS} FROM read_json_auto('${src}'))
      TO '${outFile}' (FORMAT PARQUET)`);
    fs.rmSync(tmpFile);
    seasonYears.push(year);
    entry.seasonRows = rows.length;
    totalBat += rows.filter((r) => r.role === 'bat').length;
    totalPit += rows.filter((r) => r.role === 'pit').length;
  }

  let hitJ;
  let pitJ;
  try {
    [hitJ, pitJ] = await Promise.all([
      getJson(`${API}/teams/stats?stats=season&group=hitting&season=${year}&sportId=1`),
      getJson(`${API}/teams/stats?stats=season&group=pitching&season=${year}&sportId=1`),
    ]);
  } catch (e) {
    const reason = (e && e.message) || String(e);
    failures.push({ year, club: 'league-stats', error: reason });
    console.log(`WARN ${year} league-stats: ${reason}`);
    continue;
  }
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
    entry.leagueRows = leagueRows.length;
  }
}
finishedLoop = true;
} finally {
  /* Always written, including when the loop throws: a manifest saying
   * complete:false is the whole point, and a MISSING manifest tells a
   * later reader nothing at all. */
  manifestComplete = writeManifest();
}

fs.rmSync(TMP, { recursive: true, force: true });

const cs = cacheStats();
console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
console.log(`league  ${leagueYears.length} seasons of team totals`);
console.log(`seasons ${seasonYears[0]}–${seasonYears[seasonYears.length - 1]}  files ${seasonYears.length}`);
console.log(`  bat  ${totalBat} player-seasons`);
console.log(`  pit  ${totalPit} player-seasons`);

await db.close();

const short = years.filter((y) => !yearIsClean(y));
/* Report the manifest's OWN flag, never a second copy of the predicate —
 * two spellings of the same rule drift the first time one is edited. */
console.log(`manifest ${MANIFEST}  complete=${manifestComplete}`);

/* A partial spine must never exit 0 — silent partial data is exactly what
 * would let coverage.json (Task 6) measure a truncated dataset as complete.
 * The manifest is what downstream code CHECKS; the exit code is for the
 * human or CI watching the run. Both, not either. */
if (failures.length || short.length) {
  if (failures.length) {
    console.log(`\n${failures.length} fetch failure(s):`);
    for (const f of failures) console.log(`  ${f.year} ${f.club}: ${f.error}`);
  }
  if (short.length) {
    console.log(`\n${short.length} year(s) short of their club count:`);
    for (const y of short) {
      console.log(`  ${y.year}: fetched ${y.clubsFetched}/${y.clubsExpected},`
        + ` with rows ${y.clubsWithRows}/${y.clubsExpected}`);
    }
  }
  process.exitCode = 1;
}
}

/* Only run the build when executed directly — importing this module (for
 * toOuts, in tests) must not trigger ~6000 network requests. */
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
