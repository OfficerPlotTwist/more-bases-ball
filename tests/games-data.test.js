/* data/games/ — the team-game dataset behind run_distribution_variance.
 * Run: node tests/games-data.test.js
 *
 * mergeGamesManifest is pure and always runs. The measured half skips when
 * data/games/ is absent, so a fresh clone with no network stays green.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'data', 'games');
const MANIFEST = path.join(GAMES, '_games.json');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { mergeGamesManifest, FIRST_GAME_SEASON } =
    await import('../tools/build-games.mjs');

  // --- The merge bug this project already paid for once. -------------------
  // data/_build.json was REPLACED by a scoped run, turning a 150-year manifest
  // into a 2-year one that still said complete:true — truthfully, for the two
  // years it now described — while 148 parquet files sat untouched beside it.
  // A games manifest can fail the identical way, and the bug lives behind a
  // multi-minute network build, so it is only testable if the merge is pure.
  const existing = {
    years: Array.from({ length: 5 }, (_, i) => ({
      year: 1901 + i, apiTotalGames: 1000, gamesFetched: 1000, gamesScored: 1000,
    })),
  };
  const scoped = mergeGamesManifest(existing, {
    generatedAt: '2026-09-17T00:00:00.000Z',
    years: [{ year: 2025, apiTotalGames: 2464, gamesFetched: 2464, gamesScored: 2434 }],
    failures: [], finishedLoop: true,
  });
  check('a scoped run keeps the years it did not rebuild',
    scoped.years.length === 6, `${scoped.years.length} years`);
  check('a scoped run does not collapse first/last to its own argv',
    scoped.first === 1901 && scoped.last === 2025, `${scoped.first}-${scoped.last}`);

  // Re-running one year must update it in place, not duplicate it.
  const rerun = mergeGamesManifest(scoped, {
    generatedAt: '2026-09-17T01:00:00.000Z',
    years: [{ year: 2025, apiTotalGames: 2464, gamesFetched: 2464, gamesScored: 2440 }],
    failures: [], finishedLoop: true,
  });
  check('re-running a year replaces its entry rather than duplicating it',
    rerun.years.filter((y) => y.year === 2025).length === 1
    && rerun.years.find((y) => y.year === 2025).gamesScored === 2440);

  // --- complete is a claim about the WHOLE manifest. -----------------------
  // gamesFetched !== apiTotalGames means the season's schedule was truncated in
  // transport. One such year makes the dataset incomplete even if every other
  // year is whole — the same standard data/_build.json holds itself to, and the
  // reason coverage.json is allowed to publish a sigma at all.
  const short = mergeGamesManifest(null, {
    generatedAt: 'x',
    years: [{ year: 2024, apiTotalGames: 2469, gamesFetched: 2100, gamesScored: 2100 }],
    failures: [], finishedLoop: true,
  });
  check('a truncated season makes the manifest incomplete', short.complete === false);

  check('a loop that threw is never complete',
    mergeGamesManifest(null, {
      generatedAt: 'x', years: existing.years, failures: [], finishedLoop: false,
    }).complete === false);

  check('a failed season makes the manifest incomplete',
    mergeGamesManifest(null, {
      generatedAt: 'x', years: existing.years,
      failures: [{ year: 1903, error: 'timeout' }], finishedLoop: true,
    }).complete === false);

  check('an empty manifest is not complete',
    mergeGamesManifest(null, {
      generatedAt: 'x', years: [], failures: [], finishedLoop: true,
    }).complete === false);

  check('FIRST_GAME_SEASON is 1901, the schedule endpoint boundary',
    FIRST_GAME_SEASON === 1901, String(FIRST_GAME_SEASON));

  // --- The measured half. -------------------------------------------------
  if (!fs.existsSync(MANIFEST)) {
    console.log('skip  data/games/ not built — run `node tools/build-games.mjs`');
    process.exit(failures ? 1 : 0);
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  check('the built manifest reports complete', m.complete === true);
  check('the built manifest starts at 1901', m.first === 1901, String(m.first));
  check('every manifest year has a parquet file on disk',
    m.years.every((y) => fs.existsSync(path.join(GAMES, `${y.year}.parquet`))),
    m.years.filter((y) => !fs.existsSync(path.join(GAMES, `${y.year}.parquet`)))
      .map((y) => y.year).join(', '));
  check('no season lost games in transport (gamesFetched === apiTotalGames)',
    m.years.every((y) => y.gamesFetched === y.apiTotalGames),
    m.years.filter((y) => y.gamesFetched !== y.apiTotalGames).map((y) => y.year).join(', '));

  // The schedule lists a suspended game under BOTH the date it started and the
  // date it resumed, and totalGames counts it twice. Deduping on gamePk is what
  // keeps that game from contributing four rows and being counted twice in the
  // run distribution — so gamesUnique is normally BELOW the transported count,
  // and a run where they are always equal means the dedupe stopped happening.
  check('duplicate schedule entries are deduped (gamesUnique <= gamesFetched)',
    m.years.every((y) => y.gamesUnique <= y.gamesFetched),
    m.years.filter((y) => y.gamesUnique > y.gamesFetched).map((y) => y.year).join(', '));
  check('some season actually had a duplicate to dedupe',
    m.years.some((y) => y.gamesUnique < y.gamesFetched),
    String(m.years.filter((y) => y.gamesUnique < y.gamesFetched).length) + ' seasons');

  const { openDb, sqlPath } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const glob = sqlPath(path.join(GAMES, '*.parquet'));
  const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v));

  // Team-game grain: exactly two rows per gamePk, one home and one away.
  // If this ever fails, var_pop(runs) is a variance over a distribution that
  // double-counts or drops one side of some games.
  const [odd] = await db.all(
    `SELECT count(*) AS n FROM (
       SELECT gamePk FROM read_parquet('${glob}')
       GROUP BY gamePk HAVING count(*) <> 2 OR sum(CASE WHEN home THEN 1 ELSE 0 END) <> 1)`);
  check('every game has exactly one home row and one away row',
    num(odd.n) === 0, `${num(odd.n)} malformed games`);

  // A team never plays itself, and a game's two rows must mirror each other:
  // one side's runs are the other's runs_allowed.
  const [mismatch] = await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') a
       JOIN read_parquet('${glob}') b
         ON a.gamePk = b.gamePk AND a.home AND NOT b.home
      WHERE a.runs <> b.runs_allowed OR b.runs <> a.runs_allowed OR a.team = b.team`);
  check('the two rows of a game mirror each other', num(mismatch.n) === 0,
    `${num(mismatch.n)} mismatched games`);

  // The Stats API reports the same club id on BOTH sides of four Negro Leagues
  // games (1943 BEG x3, 1940 NBY x1) — the opponent was never recorded. A club
  // cannot play itself, so those away rows are fictitious and are excluded at
  // build time. Four games out of 225k is numerically nothing, which is why it
  // has to be counted in the manifest rather than quietly dropped.
  check('upstream self-matchup records are excluded and counted',
    m.years.reduce((n, y) => n + (y.selfGames || 0), 0) === 4,
    String(m.years.reduce((n, y) => n + (y.selfGames || 0), 0)));

  const [nulls] = await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}')
      WHERE runs IS NULL OR runs_allowed IS NULL OR team IS NULL OR runs < 0`);
  check('no null or negative run totals reached the parquet',
    num(nulls.n) === 0, String(num(nulls.n)));

  // Negro Leagues clubs appear in the schedule but NOT in `/teams?season=Y`
  // for 1931/1934/1939 — the game-grain face of the gap coverage.json reports
  // as leagueOnlySeasons. They are resolved per-id to their real abbreviation;
  // before that fallback existed they landed as team: NULL and one side of 77
  // real games vanished from the run distribution.
  const [negro] = await db.all(
    `SELECT count(DISTINCT team) AS n FROM read_parquet('${glob}')
      WHERE year IN (1931, 1934, 1939) AND team IN ('BEG', 'HOM', 'KCM', 'CAG')`);
  check('Negro Leagues clubs resolve to abbreviations, not NULL',
    num(negro.n) >= 2, `${num(negro.n)} of BEG/HOM/KCM/CAG present`);

  // Modern MLB abbreviations, not Lahman's historical forms — the project rule.
  const [bad] = await db.all(
    `SELECT count(DISTINCT team) AS n FROM read_parquet('${glob}')
      WHERE NOT regexp_matches(team, '^[A-Z]{2,4}(-[A-Z])?$')`);
  check('every team code matches the spine team pattern',
    num(bad.n) === 0, `${num(bad.n)} non-conforming codes`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
