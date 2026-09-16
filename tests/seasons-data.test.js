/* Season Parquet: coverage, both roles, derived PA. Run: node tests/seasons-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// inningsPitched is a string in thirds, not a decimal — no network needed,
// so these run even on a fresh clone.
(async () => {
  const { toOuts } = await import('../tools/build-seasons.mjs');
  check('toOuts full innings', toOuts('217.0') === 651, `got=${toOuts('217.0')}`);
  check('toOuts partial innings', toOuts('216.1') === 649, `got=${toOuts('216.1')}`);

  const ROOT = path.join(__dirname, '..');
  const DIR = path.join(ROOT, 'data', 'seasons');
  if (!fs.existsSync(DIR)) {
    console.log('skip  data/seasons not built — run `node tools/build-seasons.mjs`');
    process.exit(failures ? 1 : 0);
  }

  const { openDb } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const glob = path.join(DIR, '*.parquet').replace(/\\/g, '/');
  const LGDIR = path.join(ROOT, 'data', 'league');
  const lg = path.join(LGDIR, '*.parquet').replace(/\\/g, '/');

  const span = (await db.all(
    `SELECT min(year) AS lo, max(year) AS hi FROM read_parquet('${glob}')`))[0];
  check('history reaches 1876', Number(span.lo) === 1876, `lo=${span.lo}`);
  check('history reaches 2024 or later', Number(span.hi) >= 2024, `hi=${span.hi}`);

  const roles = await db.all(
    `SELECT role, count(*) AS n FROM read_parquet('${glob}') GROUP BY role ORDER BY role`);
  const byRole = Object.fromEntries(roles.map((r) => [r.role, Number(r.n)]));
  check('batter seasons present', byRole.bat > 100000, `bat=${byRole.bat}`);
  check('pitcher seasons present', byRole.pit > 40000, `pit=${byRole.pit}`);

  // Pedro Martinez, 2000: a line every baseball fan can check by eye.
  // Matched on MLBAM id 118377 (the id the addendum itself probed), not name —
  // the API returns his name as "Pedro Martínez" (accented), so a literal
  // ASCII name match silently misses the row.
  const pedro = (await db.all(
    `SELECT er, ipouts, p_so FROM read_parquet('${glob}')
     WHERE year = 2000 AND role = 'pit' AND mlbam = 118377`))[0];
  check('known pitcher season is right',
    pedro && Number(pedro.p_so) === 284 && Number(pedro.ipouts) === 651,
    JSON.stringify(pedro));

  // PA must be derived, not null, for anyone with plate appearances.
  const badPa = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}')
     WHERE role = 'bat' AND ab > 0 AND (pa IS NULL OR pa < ab)`))[0];
  check('derived PA is never below AB', Number(badPa.n) === 0, `bad=${badPa.n}`);

  // bbref is legitimately NULL from this source; mlbam is the native id here.
  const noId = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE mlbam IS NULL`))[0];
  check('every row carries a player id', Number(noId.n) === 0, `null=${noId.n}`);

  // A missing middle year (e.g. 1953) would still pass every check above,
  // since modern rosters dominate the aggregate totals — check coverage
  // year by year instead, for both datasets.
  const expectedYears = [];
  for (let y = 1876; y <= 2025; y++) expectedYears.push(y);

  const seasonCounts = await db.all(
    `SELECT year, count(*) AS n FROM read_parquet('${glob}') GROUP BY year`);
  const seasonRows = new Map(seasonCounts.map((r) => [Number(r.year), Number(r.n)]));
  const missingSeasons = expectedYears.filter((y) =>
    !fs.existsSync(path.join(DIR, `${y}.parquet`)) || !(seasonRows.get(y) > 0));
  check('every year 1876-2025 has a seasons file with rows', missingSeasons.length === 0,
    `missing=${missingSeasons.length}` +
    (missingSeasons.length ? ` first: ${missingSeasons.slice(0, 5).join(',')}` : ''));

  const leagueCounts = await db.all(
    `SELECT year, count(*) AS n FROM read_parquet('${lg}') GROUP BY year`);
  const leagueRows = new Map(leagueCounts.map((r) => [Number(r.year), Number(r.n)]));
  const missingLeague = expectedYears.filter((y) =>
    !fs.existsSync(path.join(LGDIR, `${y}.parquet`)) || !(leagueRows.get(y) > 0));
  check('every year 1876-2025 has a league file with rows', missingLeague.length === 0,
    `missing=${missingLeague.length}` +
    (missingLeague.length ? ` first: ${missingLeague.slice(0, 5).join(',')}` : ''));

  // A single stat split shared verbatim across every club that rostered a
  // player (e.g. a two-way player's one-inning pitching line) must be
  // attributed once, to his real club — not once per club that fetched it.
  // This is the assertion that would have caught both prior rounds of the
  // split-selection bug. The key must be the FULL stat line, not just
  // (ipouts, pa): a player traded mid-season can legitimately record the
  // same PA count at both clubs while every other column differs, and a
  // narrower key mistakes that coincidence for the bug. Two rows for the
  // same player-season are only the bug if every measured column matches.
  const DUP_COLS = 'year, mlbam, role, pa, ab, h, d2, d3, hr, bb, so, sb, cs, hbp, '
    + 'ipouts, er, bf, p_h, p_bb, p_so, p_hr';
  const dupeRows = await db.all(
    `SELECT ${DUP_COLS} FROM read_parquet('${glob}')
     WHERE coalesce(pa,0) > 20 OR coalesce(ipouts,0) > 30
     GROUP BY ALL HAVING count(*) > 1`);
  const dupeDetail = dupeRows.length
    ? dupeRows.slice(0, 3).map((r) => `${r.year}/${r.mlbam}/${r.role}`).join(', ')
    : '';
  check('no player-season duplicated across clubs (all years)', dupeRows.length === 0,
    `dupes=${dupeRows.length}${dupeDetail ? ` first: ${dupeDetail}` : ''}`);

  // Team totals: the only Tier A source of team-games, so runs/game is exact.
  const rpg = (await db.all(
    `SELECT sum(r) * 1.0 / sum(g) AS v FROM read_parquet('${lg}') WHERE year = 2019`))[0];
  check('2019 runs per team-game is ~4.8',
    Number(rpg.v) > 4.5 && Number(rpg.v) < 5.1, `rpg=${Number(rpg.v).toFixed(3)}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
