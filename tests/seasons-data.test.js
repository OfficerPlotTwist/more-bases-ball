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

  // Team totals: the only Tier A source of team-games, so runs/game is exact.
  const lg = path.join(ROOT, 'data', 'league', '*.parquet').replace(/\\/g, '/');
  const rpg = (await db.all(
    `SELECT sum(r) * 1.0 / sum(g) AS v FROM read_parquet('${lg}') WHERE year = 2019`))[0];
  check('2019 runs per team-game is ~4.8',
    Number(rpg.v) > 4.5 && Number(rpg.v) < 5.1, `rpg=${Number(rpg.v).toFixed(3)}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
