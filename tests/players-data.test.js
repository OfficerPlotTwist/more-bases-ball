/* Player crosswalk. Run: node tests/players-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'players.parquet');
if (!fs.existsSync(FILE)) {
  console.log('skip  data/players.parquet not built — run `node tools/build-players.mjs`');
  process.exit(0);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { openDb, sqlPath } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const f = sqlPath(FILE);

  // Ground-truth counts from Chadwick Register as of 2026-09-15.
  // A mismatch indicates either upstream data changed or the build lost rows.
  const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}')`))[0];
  check('player count is 23666 (register as of 2026-09-15)', Number(n.n) === 23666, `n=${n.n}`);

  const bbrefCount = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}') WHERE bbref IS NOT NULL`))[0];
  check('bbref non-null count is 23664', Number(bbrefCount.n) === 23664, `n=${bbrefCount.n}`);

  const retroCount = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}') WHERE retro IS NOT NULL`))[0];
  check('retro non-null count is 23200', Number(retroCount.n) === 23200, `n=${retroCount.n}`);

  const fangraphsCount = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}') WHERE fangraphs IS NOT NULL`))[0];
  check('fangraphs non-null count is 21177', Number(fangraphsCount.n) === 21177, `n=${fangraphsCount.n}`);

  // Shohei Ohtani: MLBAM 660271, bbref ohtansh01.
  const ohtani = (await db.all(
    `SELECT bbref, retro, name FROM read_parquet('${f}') WHERE mlbam = 660271`))[0];
  check('mlbam 660271 maps to ohtansh01',
    ohtani && ohtani.bbref === 'ohtansh01', JSON.stringify(ohtani));
  check('and carries a retrosheet id', ohtani && !!ohtani.retro, JSON.stringify(ohtani));

  const dupes = (await db.all(
    `SELECT count(*) AS n FROM (
       SELECT mlbam FROM read_parquet('${f}') GROUP BY mlbam HAVING count(*) > 1)`))[0];
  check('mlbam is unique', Number(dupes.n) === 0, `dupes=${dupes.n}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
