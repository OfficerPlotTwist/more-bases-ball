/* Statcast parquet: per-board era boundaries. Run: node tests/statcast-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'statcast');
if (!fs.existsSync(DIR)) {
  console.log('skip  data/statcast not built — run `node tools/build-statcast.mjs`');
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
  const glob = sqlPath(path.join(DIR, '*.parquet'));

  const first = async (col) => Number((await db.all(
    `SELECT min(year) AS y FROM read_parquet('${glob}') WHERE ${col} IS NOT NULL`))[0].y);

  check('sprint speed starts 2015', await first('spd') === 2015);
  check('exit velo / launch angle starts 2015', await first('ev') === 2015);
  check('outs above average starts 2016', await first('oaa') === 2016);
  check('arm strength starts 2020', await first('arm') === 2020);
  check('bat tracking starts 2023', await first('bat_speed') === 2023);

  const noPre = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE year < 2015`))[0];
  check('nothing claims tracking before 2015', Number(noPre.n) === 0, `n=${noPre.n}`);

  const unmatched = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE mlbam IS NULL`))[0];
  check('every row has an mlbam id', Number(unmatched.n) === 0, `n=${unmatched.n}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
