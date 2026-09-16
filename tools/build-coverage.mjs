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
    source: 'Chadwick baseballdatabank', grain: 'player-season' },
  { key: 'season_pitching', src: SEASONS, where: "role = 'pit' AND ipouts > 0",
    source: 'Chadwick baseballdatabank', grain: 'player-season' },
  { key: 'strikeouts', src: SEASONS, where: "role = 'bat' AND so IS NOT NULL",
    source: 'Chadwick baseballdatabank', grain: 'player-season' },
  { key: 'caught_stealing', src: SEASONS, where: 'cs IS NOT NULL',
    source: 'Chadwick baseballdatabank', grain: 'player-season' },
  { key: 'team_totals', src: g('league', '*.parquet'), where: 'g > 0',
    source: 'Chadwick baseballdatabank', grain: 'team-season' },
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
  /* team_totals is team-season grain — it has no mlbam column, so "players"
   * there counts distinct teams instead. Every other probe is player-season. */
  const idCol = p.grain === 'team-season' ? 'team' : 'mlbam';
  const r = (await db.all(
    `SELECT min(year) AS first, max(year) AS last, count(*) AS rows,
            count(DISTINCT ${idCol}) AS players
       FROM read_parquet('${p.src}') WHERE ${p.where}`))[0];
  if (r.first == null) {
    console.log(`WARN  ${p.key}: no rows matched — omitted from coverage`);
    continue;
  }
  const first = Number(r.first);
  const last = Number(r.last);
  const rows = Number(r.rows);
  const players = Number(r.players);
  stats[p.key] = {
    first, last, rows, source: p.source, grain: p.grain,
    players,
    playerYearsPerSeason: Math.round(rows / (last - first + 1)),
  };
  if (p.statcast) stats[p.key]._statcastPlayers = players;
}

/* populationVsWidest: each Statcast stat's distinct-player count against the
 * widest (most-populous) Statcast column in the whole statcast table — not
 * just the widest among the named coverage stats above. `xwoba` has no
 * coverage entry of its own (it isn't a stat intake asks about), but at a
 * 50-PA gate it is the loosest board Savant publishes, and leaving it out of
 * the "widest" reference is exactly the kind of thing that hides a coverage
 * gap: batted_ball_tracking (ev/la, gated at 50 batted balls) only reads as
 * "roughly half the population" against xwoba, not against sprint_speed. */
const statcastKeys = Object.keys(stats).filter((k) => PROBES.find((p) => p.key === k)?.statcast);
if (statcastKeys.length) {
  const wideRow = (await db.all(
    `SELECT count(DISTINCT mlbam) FILTER (WHERE spd IS NOT NULL) AS spd,
            count(DISTINCT mlbam) FILTER (WHERE xwoba IS NOT NULL) AS xwoba,
            count(DISTINCT mlbam) FILTER (WHERE ev IS NOT NULL) AS ev,
            count(DISTINCT mlbam) FILTER (WHERE oaa IS NOT NULL) AS oaa,
            count(DISTINCT mlbam) FILTER (WHERE arm IS NOT NULL) AS arm,
            count(DISTINCT mlbam) FILTER (WHERE bat_speed IS NOT NULL) AS bat_speed
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
  console.log(`${k.padEnd(22)} ${v.first}–${v.last}  ${v.rows} rows  `
    + `${v.players} players${v.populationVsWidest != null ? `  vsWidest:${v.populationVsWidest}` : ''}`);
}
await db.close();
