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

  const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}')`))[0];
  check('crosswalk covers the MLB universe', Number(n.n) > 20000, `n=${n.n}`);

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
