/* moreBasesBall — build data/players.parquet
 *
 *   node tools/build-players.mjs
 *
 * The Chadwick Register is the crosswalk between the id systems each source
 * uses: bbref, MLBAM, Retrosheet and Fangraphs ids for the same person.
 *
 * NOTHING IN THIS REPO CURRENTLY JOINS THROUGH THIS TABLE. An earlier version
 * of this header claimed "every join in this project goes through this table",
 * and that is no longer true: Task 3 moved seasons off Lahman onto the MLB
 * Stats API, which writes a native mlbam on every row and leaves `bbref` 100%
 * NULL, so the crosswalk lost its only consumer. Savant already carries MLBAM,
 * so build-statcast.mjs never needed it either, and tools/lib/spine.mjs does
 * not open players.parquet at all. build-coverage.mjs probes the `bbref`
 * column (reported as `player_bbref_ids`) precisely so that zero population is
 * visible rather than a trap for the next consumer.
 *
 * It is built for (a) the Retrosheet work in a later plan, which is keyed on
 * `retro` ids and has no other way back to MLBAM, and (b) resolving one player
 * across id systems by hand. When a join does arrive, it goes through here —
 * never match on names, there are two Pedro Martinezes and three Bob Millers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, cachePath, cacheStats, csvBody } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
const BASE = 'https://raw.githubusercontent.com/chadwickbureau/register/master/data';
const SHARDS = '0123456789abcdef'.split('');

const files = [];
for (const s of SHARDS) {
  const url = `${BASE}/people-${s}.csv`;
  await getText(url, csvBody);
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
  /* Partition on the CAST value, not the raw VARCHAR: the output column is
   * TRY_CAST(key_mlbam AS INTEGER), so '660271' and '0660271' are two
   * partitions that collapse to one mlbam and defeat the dedupe. */
  QUALIFY row_number() OVER (PARTITION BY TRY_CAST(key_mlbam AS INTEGER) ORDER BY key_bbref NULLS LAST, key_retro NULLS LAST, key_fangraphs NULLS LAST, key_person) = 1
) TO '${out}' (FORMAT PARQUET)`);

const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${out}')`))[0];
console.log(`players.parquet  ${n.n} major-league players`);
const cs = cacheStats();
console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`);
await db.close();
