/* moreBasesBall — build data/players.parquet
 *
 *   node tools/build-players.mjs
 *
 * The Chadwick Register is the crosswalk between the id systems each source
 * uses: Lahman is keyed on bbref, Baseball Savant on MLBAM, Retrosheet on its
 * own id. Every join in this project goes through this table. Never match on
 * names — there are two Pedro Martinezes and three Bob Millers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, cachePath, cacheStats } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
const BASE = 'https://raw.githubusercontent.com/chadwickbureau/register/master/data';
const SHARDS = '0123456789abcdef'.split('');

const files = [];
for (const s of SHARDS) {
  const url = `${BASE}/people-${s}.csv`;
  await getText(url);
  files.push(sqlPath(cachePath(url)));
}

fs.mkdirSync(OUT, { recursive: true });
const db = await openDb();
const list = files.map((f) => `'${f}'`).join(', ');
const out = sqlPath(path.join(OUT, 'players.parquet'));

await db.run(`COPY (
  SELECT
    TRY_CAST(key_mlbam AS INTEGER) AS mlbam,
    NULLIF(key_bbref, '') AS bbref,
    NULLIF(key_retro, '') AS retro,
    NULLIF(key_fangraphs, '') AS fangraphs,
    name_first || ' ' || name_last AS name,
    TRY_CAST(mlb_played_first AS INTEGER) AS first_year,
    TRY_CAST(mlb_played_last AS INTEGER) AS last_year
  FROM read_csv_auto([${list}], header = true, union_by_name = true, all_varchar = true)
  WHERE TRY_CAST(key_mlbam AS INTEGER) IS NOT NULL
    AND mlb_played_first IS NOT NULL
  QUALIFY row_number() OVER (PARTITION BY key_mlbam ORDER BY key_bbref NULLS LAST, key_retro NULLS LAST, key_fangraphs NULLS LAST, key_person) = 1
) TO '${out}' (FORMAT PARQUET)`);

const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${out}')`))[0];
console.log(`players.parquet  ${n.n} major-league players`);
const cs = cacheStats();
console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
await db.close();
