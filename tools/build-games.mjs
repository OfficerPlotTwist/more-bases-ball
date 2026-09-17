/* moreBasesBall — build data/games/{year}.parquet
 *
 *   node tools/build-games.mjs [firstYear] [lastYear]
 *
 * Every regular-season game's final score, at TEAM-GAME grain: two rows per
 * game, one per club. This is the only dataset in the spine below season grain,
 * and it exists for exactly one reason — `run_distribution_variance`, the
 * eleventh diagnostic KPI in the design spec. The other ten are rates over
 * season totals and the league table answers them; a variance is a property of
 * the per-game distribution and no column of season totals can reconstruct it.
 *
 * Team-game rather than game grain is deliberate. `var_pop(runs)` over
 * team-games IS the run distribution a fan means, and storing it that way keeps
 * the KPI expression a single aggregate instead of an unpivot that every future
 * consumer would have to rewrite correctly. The cost is a boolean `home`
 * column and 2x the rows — about 500k rows total, ~5 MB of Parquet.
 *
 * ONE request per season. `fields=` prunes the response to the eight paths
 * actually read, so 125 seasons is 125 requests against a cache that never
 * expires (except the in-progress seasons — see isVolatileSeason).
 *
 * Coverage starts at 1901, not 1876. The Stats API's schedule endpoint returns
 * totalGames: 0 for every season from 1876 through 1900 — the season lines and
 * team totals for those years exist, the game log does not. That is a source
 * boundary, not a build failure, and FIRST encodes it so a run does not report
 * 25 empty years as 25 failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, cacheStats, isVolatileSeason } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.MBB_DATA_DIR || path.join(ROOT, 'data');
const GAMES = path.join(DATA, 'games');
const TMP = path.join(DATA, '.tmp-games');
const API = 'https://statsapi.mlb.com/api/v1';

/* The first season the schedule endpoint has any game for. Probed, not
 * assumed: 1876-1900 all return totalGames: 0. */
export const FIRST_GAME_SEASON = 1901;

const argFirst = Number(process.argv[2]);
const argLast = Number(process.argv[3]);
const FIRST = Number.isInteger(argFirst) ? argFirst : FIRST_GAME_SEASON;
const LAST = Number.isInteger(argLast) ? argLast : new Date().getFullYear();

/* Only the paths actually read. Without this the 2024 response is ~40 MB of
 * roster and venue hydration for 2469 games; with it, well under one. */
const FIELDS = [
  'totalGames', 'dates', 'games', 'gamePk', 'officialDate', 'gameType',
  'status', 'codedGameState', 'teams', 'away', 'home', 'team', 'id', 'name',
  'score',
].join(',');

/* Clubs the season team list does not contain. They exist: every one found so
 * far is a Negro Leagues club in 1931/1934/1939 (Baltimore Elite Giants,
 * Homestead Grays, Kansas City Monarchs), which the schedule endpoint carries
 * but `/teams?season=Y` omits — the game-grain face of the same gap
 * coverage.json reports as leagueOnlySeasons. `/teams/{id}` resolves each one
 * to its real modern abbreviation, so the fallback is a lookup, not a guess.
 *
 * Without it these rows landed with team: NULL, and a NULL team in a dataset
 * whose whole purpose is a per-team run distribution silently drops one side
 * of 77 real games. Memoised across seasons and cached on disk, so the whole
 * history costs a handful of requests. */
const abbrCache = new Map();
async function abbrForId(id, fallbackName) {
  if (id == null) return fallbackName || null;
  if (abbrCache.has(id)) return abbrCache.get(id);
  let abbr = fallbackName || null;
  try {
    const j = await getJson(`${API}/teams/${id}`);
    const t = (j.teams || [])[0];
    if (t && t.abbreviation) abbr = t.abbreviation;
  } catch { /* keep the name we already have rather than failing the season */ }
  abbrCache.set(id, abbr);
  return abbr;
}

/* Merged, never replaced — the same rule data/_build.json learned the hard way
 * (see docs/decisions/2026-09-15-data-spine/progress.md). A scoped run like
 * `node tools/build-games.mjs 2024 2025` must not rewrite a 125-year manifest
 * into a 2-year one while 123 parquet files sit untouched beside it, still
 * truthfully reporting complete:true for the two years it now describes.
 * Pure and exported so the merge can be tested without a network build. */
export function mergeGamesManifest(existing, run) {
  const byYear = new Map();
  for (const y of (existing && existing.years) || []) byYear.set(y.year, y);
  for (const y of run.years) byYear.set(y.year, y);
  const years = [...byYear.values()].sort((a, b) => a.year - b.year);
  /* A year inherited from a previous run counts toward completeness only if
   * this run did not fail on it. Failures are the CURRENT run's own. */
  return {
    generatedAt: run.generatedAt,
    first: years.length ? years[0].year : null,
    last: years.length ? years[years.length - 1].year : null,
    years,
    failures: run.failures,
    complete: run.finishedLoop
      && run.failures.length === 0
      && years.length > 0
      && years.every((y) => y.gamesFetched === y.apiTotalGames),
  };
}

/* Demote any year whose parquet has gone. An inherited manifest entry is only
 * worth what the file behind it backs — data/_build.json's writeManifest()
 * makes the same check for the same reason. */
function verifyAgainstDisk(manifest) {
  const kept = manifest.years.filter((y) => fs.existsSync(path.join(GAMES, `${y.year}.parquet`)));
  const dropped = manifest.years.length - kept.length;
  if (dropped) {
    console.log(`WARN ${dropped} manifest year(s) had no parquet on disk — demoted`);
  }
  manifest.years = kept;
  manifest.first = kept.length ? kept[0].year : null;
  manifest.last = kept.length ? kept[kept.length - 1].year : null;
  manifest.complete = manifest.complete && kept.length > 0 && dropped === 0;
  return manifest;
}

async function main() {
  fs.mkdirSync(GAMES, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const db = await openDb();

  const years = [];
  const failures = [];
  let finishedLoop = false;
  let totalRows = 0;
  let totalSkipped = 0;
  let totalSelf = 0;

  try {
    for (let year = FIRST; year <= LAST; year++) {
      const volatile = isVolatileSeason(year);

      /* Modern MLB abbreviations, per the project rule — the schedule endpoint
       * carries team id and full name only. This is the SAME URL
       * build-seasons.mjs already fetches for its club loop, so on any machine
       * with a built spine it is a cache hit and costs nothing. */
      let abbrById;
      let sched;
      try {
        const [teamList, schedule] = await Promise.all([
          getJson(`${API}/teams?sportId=1&season=${year}`, { fresh: volatile }),
          getJson(`${API}/schedule?sportId=1&season=${year}&gameType=R&fields=${FIELDS}`,
            { fresh: volatile }),
        ]);
        abbrById = new Map((teamList.teams || [])
          .filter((t) => t.sport && t.sport.id === 1)
          .map((t) => [t.id, t.abbreviation]));
        sched = schedule;
      } catch (e) {
        const reason = (e && e.message) || String(e);
        failures.push({ year, error: reason });
        console.log(`WARN ${year}: ${reason}`);
        continue;
      }

      const fetched = (sched.dates || []).flatMap((d) => d.games || []);
      const apiTotalGames = sched.totalGames ?? 0;
      /* A game can appear under more than one date — a suspended game is
       * listed on both the date it started and the date it was resumed, and
       * `totalGames` counts it each time. Emitting it twice would put four
       * rows under one gamePk and count that game twice in the run
       * distribution, so dedupe on gamePk while keeping the RAW count for the
       * transport check below: `gamesFetched === apiTotalGames` is asking
       * whether the response arrived whole, which is a different question from
       * how many distinct games it describes. */
      const byPk = new Map();
      for (const gm of fetched) if (gm.gamePk != null) byPk.set(gm.gamePk, gm);
      const games = [...byPk.values()];
      if (apiTotalGames === 0) {
        console.log(`note ${year}: schedule endpoint has no games — skipped`);
        continue;
      }

      const rows = [];
      let skipped = 0;
      /* A season with a scheduled game still in the future is IN PROGRESS, and
       * its variance is computed over a partial season. That number is real but
       * it is not comparable to a full one, and sigma consumes a series of
       * year-over-year deltas — one partial year corrupts two of them.
       *
       * Detected from the schedule itself (a game dated after today) rather
       * than from gamesScored < apiTotalGames, which cannot tell "not played
       * yet" from "never played": the 1994 strike and the 2020 short season
       * both scheduled games that were never made up, and neither is in
       * progress. The manifest records the fact; build-coverage.mjs decides
       * what to do about it. */
      const today = new Date().toISOString().slice(0, 10);
      let inProgress = false;
      let selfGames = 0;
      for (const gm of games) {
        const a = gm.teams && gm.teams.away;
        const h = gm.teams && gm.teams.home;
        /* A null score is a postponement or a cancellation, never a played
         * game: across every season probed, the count of null-score games
         * equals the count of D (postponed) + C (cancelled) states exactly.
         * Filtering on the SCORE rather than on a state allowlist is what
         * keeps 1901's three games in a state this code has never seen — they
         * have run totals, so they were played, so they belong in the
         * distribution. A state allowlist would have silently dropped them. */
        if (!a || !h || a.score == null || h.score == null) {
          skipped++;
          if (gm.officialDate && gm.officialDate > today) inProgress = true;
          continue;
        }
        const away = abbrById.get(a.team && a.team.id)
          || await abbrForId(a.team && a.team.id, a.team && a.team.name);
        const home = abbrById.get(h.team && h.team.id)
          || await abbrForId(h.team && h.team.id, h.team && h.team.name);
        if (away == null || home == null) { skipped++; continue; }
        /* The Stats API reports the SAME club id on both sides of four Negro
         * Leagues games (1943 Baltimore Elite Giants x3, 1940 New York Black
         * Yankees x1): the opponent was never recorded upstream. A club cannot
         * play itself, so the away side of those records is fictitious, and
         * keeping them would attribute two rows of a real game's runs to a
         * matchup that did not happen. Excluded and COUNTED — four games out of
         * 225k is numerically nothing, which is exactly why it has to be
         * visible in the manifest instead of quietly dropped. */
        if (away === home) { selfGames++; continue; }
        const base = { year, gamePk: gm.gamePk, date: gm.officialDate };
        rows.push({ ...base, team: away, opp: home, runs: a.score, runs_allowed: h.score, home: false });
        rows.push({ ...base, team: home, opp: away, runs: h.score, runs_allowed: a.score, home: true });
      }

      if (!rows.length) {
        console.log(`note ${year}: ${games.length} games, none with a final score — skipped`);
        continue;
      }

      const tmpFile = path.join(TMP, `games-${year}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(rows));
      const src = sqlPath(tmpFile);
      const outFile = sqlPath(path.join(GAMES, `${year}.parquet`));
      await db.run(`COPY (SELECT
          CAST(year AS INTEGER) AS year, CAST(gamePk AS INTEGER) AS gamePk,
          CAST(date AS DATE) AS date, CAST(team AS VARCHAR) AS team,
          CAST(opp AS VARCHAR) AS opp, CAST(runs AS INTEGER) AS runs,
          CAST(runs_allowed AS INTEGER) AS runs_allowed,
          CAST(home AS BOOLEAN) AS home
        FROM read_json_auto('${src}')) TO '${outFile}' (FORMAT PARQUET)`);
      fs.rmSync(tmpFile);

      years.push({
        year,
        inProgress,
        apiTotalGames,
        gamesFetched: fetched.length,
        gamesUnique: games.length,
        gamesScored: rows.length / 2,
        gamesSkipped: skipped,
        selfGames,
        teamGameRows: rows.length,
      });
      totalRows += rows.length;
      totalSkipped += skipped;
      totalSelf += selfGames;
      console.log(`${year}  ${rows.length / 2} games  ${rows.length} team-games`
        + (fetched.length !== games.length ? `  (${fetched.length - games.length} dup)` : '')
        + (skipped ? `  (${skipped} unplayed)` : '')
        + (selfGames ? `  (${selfGames} self-matchup excluded)` : '')
        + (inProgress ? '  IN PROGRESS — partial season' : ''));
    }
    finishedLoop = true;
  } finally {
    const manifestPath = path.join(GAMES, '_games.json');
    const existing = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    const merged = verifyAgainstDisk(mergeGamesManifest(existing, {
      generatedAt: new Date().toISOString(), years, failures, finishedLoop,
    }));
    fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n');
    console.log(`\nmanifest ${manifestPath}  complete=${merged.complete}`
      + `  years ${merged.first}–${merged.last} (${merged.years.length})`);
    await db.close();
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  const cs = cacheStats();
  const refetched = [];
  for (let y = FIRST; y <= LAST; y++) if (isVolatileSeason(y)) refetched.push(y);
  console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`
    + (refetched.length
      ? `  (${refetched.join(', ')} refetched: in-progress seasons are never served from cache)`
      : ''));
  console.log(`games  ${totalRows} team-game rows, ${totalSkipped} unplayed games excluded`
    + (totalSelf ? `, ${totalSelf} upstream self-matchup records excluded` : ''));
  if (failures.length) {
    console.error(`\nbuild-games: ${failures.length} season(s) failed — manifest reports complete=false`);
    process.exit(1);
  }
}

/* Importable for the manifest-merge test without running a network build. */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('build-games.mjs')) {
  await main();
}
