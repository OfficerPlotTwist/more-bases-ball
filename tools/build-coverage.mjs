/* moreBasesBall — build data/coverage.json
 *
 *   node tools/build-coverage.mjs
 *
 * How far back each statistic actually goes, MEASURED from the parquet on disk.
 * Intake reads this to reject a rule the data cannot support — before the fan
 * is charged — and every results page renders it. A hardcoded table would drift
 * away from the data it is supposed to guard, so every number here is a query.
 *
 * Per .superpowers/sdd/2026-09-15-data-spine/task-6-addendum.md, this builder:
 *   1. refuses to run unless data/_build.json exists and reports complete=true
 *      (measuring coverage against an unverified or partial spine is worse
 *      than not measuring it at all);
 *   2. reports per-column population (distinct players, not just row counts) —
 *      two Statcast boards can share a row grain while covering very different
 *      shares of players, and a raw row count hides that;
 *   3. carries forward the manifest's empty-club-year facts (Negro Leagues,
 *      Federal League, pre-debut expansion franchises) as a first-class
 *      "leagueOnlySeasons" section, not a silent gap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const g = (...p) => sqlPath(path.join(DATA, ...p));

const SEASONS = g('seasons', '*.parquet');
const STATCAST = g('statcast', '*.parquet');

const PROBES = [
  { key: 'season_batting', src: SEASONS, where: "role = 'bat' AND pa > 0",
    source: 'MLB Stats API (statsapi.mlb.com)', grain: 'player-season' },
  { key: 'season_pitching', src: SEASONS, where: "role = 'pit' AND ipouts > 0",
    source: 'MLB Stats API (statsapi.mlb.com)', grain: 'player-season' },
  { key: 'strikeouts', src: SEASONS, where: "role = 'bat' AND so IS NOT NULL",
    source: 'MLB Stats API (statsapi.mlb.com)', grain: 'player-season' },
  { key: 'caught_stealing', src: SEASONS, where: 'cs IS NOT NULL',
    source: 'MLB Stats API (statsapi.mlb.com)', grain: 'player-season' },
  { key: 'team_totals', src: g('league', '*.parquet'), where: 'g > 0',
    source: 'MLB Stats API (statsapi.mlb.com)', grain: 'team-season' },
  { key: 'sprint_speed', src: STATCAST, where: 'spd IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
  { key: 'home_to_first', src: STATCAST, where: 'hp1 IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
  { key: 'batted_ball_tracking', src: STATCAST, where: 'ev IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
  { key: 'outs_above_average', src: STATCAST, where: 'oaa IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
  { key: 'arm_strength', src: STATCAST, where: 'arm IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
  { key: 'bat_tracking', src: STATCAST, where: 'bat_speed IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season', statcast: true },
];

/* --- Refusal gate: never measure coverage against an unverified spine. --- */
const manifestPath = path.join(DATA, '_build.json');
if (!fs.existsSync(manifestPath)) {
  console.error('build-coverage: data/_build.json is missing — run '
    + '`node tools/build-seasons.mjs` first. Refusing to measure coverage '
    + 'against an unverified spine.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.complete !== true) {
  console.error('build-coverage: data/_build.json reports complete=false '
    + `(${manifest.failures.length} failures). Refusing to measure coverage `
    + 'against a partial spine — fix the build first.');
  process.exit(1);
}

const db = await openDb();
const stats = {};

for (const p of PROBES) {
  /* team_totals is team-season grain — it has no mlbam column, so its
   * per-entity count is distinct teams, not players. Naming that field
   * "players" in an artifact intake trusts before charging a fan would be
   * its own misleading-completeness bug, so the key itself is grain-aware:
   * player-season stats get players/playerYearsPerSeason, team-season stats
   * get teams/teamYearsPerSeason, and never both. */
  const isTeamGrain = p.grain === 'team-season';
  const idCol = isTeamGrain ? 'team' : 'mlbam';
  const r = (await db.all(
    `SELECT min(year) AS first, max(year) AS last, count(*) AS rows,
            count(DISTINCT ${idCol}) AS entities
       FROM read_parquet('${p.src}') WHERE ${p.where}`))[0];
  if (r.first == null) {
    console.log(`WARN  ${p.key}: no rows matched — omitted from coverage`);
    continue;
  }
  const first = Number(r.first);
  const last = Number(r.last);
  const rows = Number(r.rows);
  const entities = Number(r.entities);
  const perSeason = Math.round(rows / (last - first + 1));
  stats[p.key] = isTeamGrain
    ? { first, last, rows, source: p.source, grain: p.grain,
        teams: entities, teamYearsPerSeason: perSeason }
    : { first, last, rows, source: p.source, grain: p.grain,
        players: entities, playerYearsPerSeason: perSeason };
  if (p.statcast) stats[p.key]._statcastPlayers = entities;
}

/* populationVsWidest: each Statcast stat's distinct-player count against the
 * widest (most-populous) Statcast column in the whole statcast table — not
 * just the widest among the named coverage stats above, and not a
 * hand-maintained column list either. A curated list drifts the same way a
 * hardcoded year would (it already had: an earlier version of this file
 * omitted `hp1`, home_to_first's own probed column, while including `xwoba`,
 * which has no coverage entry at all — invisible today only because hp1 and
 * spd happen to share a population). Instead, the candidate set is read off
 * the Parquet schema itself via DESCRIBE, minus the identity columns
 * (year/mlbam/name), so adding a column to build-statcast.mjs automatically
 * enters it into the comparison. `xwoba` has no coverage entry of its own
 * (it isn't a stat intake asks about) but at a 50-PA gate it is the loosest
 * board Savant publishes; leaving it out of "widest" is exactly what hid
 * that batted_ball_tracking (ev/la, gated at 50 batted balls) reads as
 * "roughly half the population" only against xwoba, not against sprint_speed. */
const statcastKeys = Object.keys(stats).filter((k) => PROBES.find((p) => p.key === k)?.statcast);
if (statcastKeys.length) {
  const IDENTITY_COLS = new Set(['year', 'mlbam', 'name']);
  const schema = await db.all(`DESCRIBE SELECT * FROM read_parquet('${STATCAST}')`);
  const candidateCols = schema
    .map((row) => row.column_name)
    .filter((col) => !IDENTITY_COLS.has(col));

  const wideRow = (await db.all(
    `SELECT ${candidateCols
      .map((col) => `count(DISTINCT mlbam) FILTER (WHERE ${col} IS NOT NULL) AS ${col}`)
      .join(',\n            ')}
       FROM read_parquet('${STATCAST}')`))[0];
  const widest = Math.max(...Object.values(wideRow).map(Number));
  for (const k of statcastKeys) {
    stats[k].populationVsWidest = Math.round((stats[k]._statcastPlayers / widest) * 100) / 100;
    delete stats[k]._statcastPlayers;
  }
}

/* --- leagueOnlySeasons: clubs MLB lists for a season with team totals but no
 * player-level rows in this source (Negro Leagues ~1920-1948, Federal League
 * 1914-1915, expansion franchises listed before they played). Read straight
 * off the build manifest; never recomputed. --- */
const yearsWithGaps = {};
let totalEmptyClubYears = 0;
for (const y of manifest.years || []) {
  if (y.clubsEmpty && y.clubsEmpty.length > 0) {
    yearsWithGaps[String(y.year)] = y.clubsEmpty;
    totalEmptyClubYears += y.clubsEmpty.length;
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  spineBuiltAt: manifest.finishedAt,
  stats,
  leagueOnlySeasons: {
    totalEmptyClubYears,
    note: 'Clubs MLB lists for a season that have team totals but no '
      + 'player-level rows in this source.',
    years: yearsWithGaps,
  },
};
fs.writeFileSync(path.join(DATA, 'coverage.json'), JSON.stringify(out, null, 2) + '\n');

for (const [k, v] of Object.entries(stats)) {
  const entityLabel = v.teams != null ? `${v.teams} teams` : `${v.players} players`;
  console.log(`${k.padEnd(22)} ${v.first}–${v.last}  ${v.rows} rows  `
    + `${entityLabel}${v.populationVsWidest != null ? `  vsWidest:${v.populationVsWidest}` : ''}`);
}
await db.close();
