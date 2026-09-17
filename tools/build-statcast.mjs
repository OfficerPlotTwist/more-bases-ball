/* moreBasesBall — build data/statcast/{year}.parquet
 *
 *   node tools/build-statcast.mjs [firstYear] [lastYear]   (default 2015 2025)
 *
 * Baseball Savant leaderboards, one row per player-season, joined on MLBAM id.
 * Each board has its own first year and that is a product fact, not a detail:
 * a fan cannot ask a bat-tracking question about 2016. build-coverage.mjs reads
 * those boundaries back off this data rather than trusting the table below.
 *
 * Savant rewrites these URLs occasionally. Each board declares the columns it
 * must return; a drift throws instead of silently writing a column of nulls.
 *
 * BOARDS below is per docs/decisions/2026-09-15-data-spine/task-5-addendum.md,
 * which overrides the brief's table: four of the brief's five board definitions
 * had wrong column names, its name extraction (r.first_name/r.last_name) is
 * empty on every board, and it omitted the exit-velo/launch-angle board
 * entirely (it lives at /leaderboard/statcast, not exit_velocity_barrels,
 * which returns HTML rather than CSV). Every column name here was read off a
 * live response.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, parseCsv, cacheStats, csvBody, isVolatileSeason } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'statcast');
const argv = process.argv.slice(2).map(Number).filter(Number.isFinite);
export const FIRST = argv[0] || 2015;
export const LAST = argv[1] || 2025;

const BOARDS = [
  { key: 'speed', from: 2015, id: 'player_id',
    needs: ['player_id', 'sprint_speed', 'hp_to_1b'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/sprint_speed`
      + `?year=${y}&position=&team=&min=10&csv=true`,
    map: (r) => ({ spd: +r.sprint_speed, hp1: +r.hp_to_1b }) },

  { key: 'xstats', from: 2015, id: 'player_id',
    needs: ['player_id', 'est_woba'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/expected_statistics`
      + `?type=batter&year=${y}&position=&team=&min=50&csv=true`,
    map: (r) => ({ xwoba: +r.est_woba }) },

  // The exit-velocity / launch-angle board the brief omitted.
  { key: 'statcast', from: 2015, id: 'player_id',
    needs: ['player_id', 'avg_hit_speed', 'avg_hit_angle'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/statcast`
      + `?type=batter&year=${y}&position=&team=&min=50&csv=true`,
    map: (r) => ({ ev: +r.avg_hit_speed, la: +r.avg_hit_angle }) },

  { key: 'oaa', from: 2016, id: 'player_id',
    needs: ['player_id', 'outs_above_average'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/outs_above_average`
      + `?type=Fielder&startYear=${y}&endYear=${y}&min=1&csv=true`,
    map: (r) => ({ oaa: Math.round(+r.outs_above_average) }) },

  { key: 'arm', from: 2020, id: 'player_id',
    needs: ['player_id', 'max_arm_strength'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/arm-strength`
      + `?type=player&year=${y}&minThrows=10&csv=true`,
    map: (r) => ({ arm: +r.max_arm_strength }) },

  { key: 'bat', from: 2023, id: 'id',
    needs: ['id', 'avg_bat_speed', 'swing_length'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/bat-tracking`
      + `?year=${y}&type=batter&min=50&csv=true`,
    map: (r) => ({ bat_speed: +r.avg_bat_speed, swing_len: +r.swing_length }) },
];

const num = (v) => (Number.isFinite(v) ? v : null);

/* Savant is inconsistent: most boards carry one column literally named
 * "last_name, first_name" holding "Ohtani, Shohei"; arm-strength uses
 * fielder_name and bat-tracking uses name, both already First Last. */
const nameOf = (r) => {
  const combined = r['last_name, first_name'];
  if (combined && combined.includes(',')) {
    const [last, first] = combined.split(',').map((s) => s.trim());
    return `${first} ${last}`;
  }
  return (combined || r.fielder_name || r.name || '').trim();
};

/* Only run the build when executed directly — importing this module (for
 * FIRST/LAST, in tests) must not trigger a network fetch. */
async function main() {
fs.mkdirSync(OUT, { recursive: true });
const db = await openDb();

for (let year = FIRST; year <= LAST; year++) {
  const players = new Map();
  const seen = [];
  let unnamed = 0;

  for (const b of BOARDS) {
    if (year < b.from) continue;
    const rows = parseCsv(await getText(b.url(year), csvBody, { fresh: isVolatileSeason(year) }));
    if (!rows.length) { console.log(`  ${year} ${b.key}: EMPTY`); continue; }
    const missing = b.needs.filter((c) => !(c in rows[0]));
    if (missing.length) {
      throw new Error(
        `${b.key} ${year}: leaderboard schema drifted, missing ${missing.join(',')}. `
        + `Got: ${Object.keys(rows[0]).slice(0, 12).join(',')}`);
    }
    for (const r of rows) {
      const id = +r[b.id];
      if (!Number.isFinite(id)) continue;
      const cur = players.get(id) || { mlbam: id, name: '' };
      const name = nameOf(r);
      if (name && !cur.name) cur.name = name;
      for (const [k, v] of Object.entries(b.map(r))) cur[k] = num(v);
      players.set(id, cur);
    }
    seen.push(`${b.key}:${rows.length}`);
  }

  for (const p of players.values()) if (!p.name) unnamed++;

  const cols = ['mlbam', 'name', 'spd', 'hp1', 'xwoba', 'ev', 'la',
    'oaa', 'arm', 'bat_speed', 'swing_len'];
  const sqlStr = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
  const values = [...players.values()].map((p) => '('
    + `${year}, ${p.mlbam}, ` + sqlStr(p.name)
    + ', ' + cols.slice(2).map((c) => (p[c] == null ? 'NULL' : p[c])).join(', ')
    + ')').join(',\n');

  if (!values) { console.log(`${year}  no rows`); continue; }

  const file = sqlPath(path.join(OUT, `${year}.parquet`));
  await db.run(`COPY (SELECT * FROM (VALUES\n${values}\n)
    AS t(year, ${cols.join(', ')})) TO '${file}' (FORMAT PARQUET)`);
  console.log(`${year}  players ${players.size}  ${seen.join('  ')}  unnamed:${unnamed}`);
}

const cs = cacheStats();
/* Name the seasons that bypassed the cache, so a human reading the log can
 * see that an in-progress year was actually refetched and not quietly served
 * from a months-old entry. */
const refetched = [];
for (let y = FIRST; y <= LAST; y++) if (isVolatileSeason(y)) refetched.push(y);
console.log(`cache  ${cs.hits} hits  ${cs.misses} fetched`
  + (refetched.length
    ? `  (${refetched.join(', ')} refetched: in-progress seasons are never served from cache)`
    : ''));
await db.close();
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
