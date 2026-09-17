/* moreBasesBall — build data/coverage.json
 *
 *   node tools/build-coverage.mjs
 *
 * How far back each statistic actually goes, MEASURED from the parquet on disk.
 * Intake reads this to reject a rule the data cannot support — before the fan
 * is charged — and every results page renders it. A hardcoded table would drift
 * away from the data it is supposed to guard, so every number here is a query.
 *
 * Per docs/decisions/2026-09-15-data-spine/task-6-addendum.md, this builder:
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
import { KPIS, stdevOfDeltas } from './lib/spine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* MBB_DATA_DIR exists so the refusal gate below can be exercised against a
 * synthetic manifest in a temp dir (tests/coverage.test.js). Unset, it is the
 * repo's own data/. */
const DATA = process.env.MBB_DATA_DIR || path.join(ROOT, 'data');
const g = (...p) => sqlPath(path.join(DATA, ...p));

/* A probe's `source` is derived from which Parquet dataset it reads, not
 * declared per-probe — a probe can no longer claim an origin different from
 * the file it actually queries, because it does not get to state one. */
const DATASET_SOURCE = {
  seasons:  { label: 'MLB Stats API (statsapi.mlb.com)', builder: 'build-seasons.mjs',  needle: 'statsapi.mlb.com' },
  league:   { label: 'MLB Stats API (statsapi.mlb.com)', builder: 'build-seasons.mjs',  needle: 'statsapi.mlb.com' },
  statcast: { label: 'Baseball Savant',                  builder: 'build-statcast.mjs', needle: 'baseballsavant.mlb.com' },
  games:    { label: 'MLB Stats API (statsapi.mlb.com)', builder: 'build-games.mjs',    needle: 'statsapi.mlb.com' },
};
const DATASET_GLOB = {
  seasons: g('seasons', '*.parquet'),
  league: g('league', '*.parquet'),
  statcast: g('statcast', '*.parquet'),
  games: g('games', '*.parquet'),
};
const STATCAST = DATASET_GLOB.statcast;

const PROBES = [
  { key: 'season_batting', dataset: 'seasons', where: "role = 'bat' AND pa > 0",
    grain: 'player-season' },
  { key: 'season_pitching', dataset: 'seasons', where: "role = 'pit' AND ipouts > 0",
    grain: 'player-season' },
  { key: 'strikeouts', dataset: 'seasons', where: "role = 'bat' AND so IS NOT NULL",
    grain: 'player-season' },
  { key: 'caught_stealing', dataset: 'seasons', where: 'cs IS NOT NULL',
    grain: 'player-season' },
  { key: 'team_totals', dataset: 'league', where: 'g > 0',
    grain: 'team-season' },
  { key: 'sprint_speed', dataset: 'statcast', where: 'spd IS NOT NULL',
    grain: 'player-season', statcast: true },
  { key: 'home_to_first', dataset: 'statcast', where: 'hp1 IS NOT NULL',
    grain: 'player-season', statcast: true },
  { key: 'batted_ball_tracking', dataset: 'statcast', where: 'ev IS NOT NULL',
    grain: 'player-season', statcast: true },
  { key: 'outs_above_average', dataset: 'statcast', where: 'oaa IS NOT NULL',
    grain: 'player-season', statcast: true },
  { key: 'arm_strength', dataset: 'statcast', where: 'arm IS NOT NULL',
    grain: 'player-season', statcast: true },
  { key: 'bat_tracking', dataset: 'statcast', where: 'bat_speed IS NOT NULL',
    grain: 'player-season', statcast: true },
  /* Not a stat intake can require — a column whose population has to stay
   * VISIBLE. Task 3's source swap left seasons.bbref 100% NULL, which silently
   * removed the crosswalk's only consumer; probing it means the next person to
   * reach for build-players.mjs reads `rows: 0` instead of assuming a join
   * exists. It is reported under `unconsumedColumns`, never under `stats`,
   * because requireCoverage() treats every entry in `stats` as available and
   * would answer ok:true for a first/last of null — advertising a join that
   * has no rows at all is exactly the failure this probe exists to prevent. */
  { key: 'player_bbref_ids', dataset: 'seasons', where: 'bbref IS NOT NULL',
    grain: 'player-season', unconsumed: true },
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
    + `(${(manifest.failures || []).length} failures). Refusing to measure coverage `
    + 'against a partial spine — fix the build first.');
  process.exit(1);
}

const db = await openDb();
const stats = {};
const unconsumedColumns = {};

for (const p of PROBES) {
  /* team_totals is team-season grain — it has no mlbam column, so its
   * per-entity count is distinct teams, not players. Naming that field
   * "players" in an artifact intake trusts before charging a fan would be
   * its own misleading-completeness bug, so the key itself is grain-aware:
   * player-season stats get players/playerYearsPerSeason, team-season stats
   * get teams/teamYearsPerSeason, and never both. */
  const isTeamGrain = p.grain === 'team-season';
  const idCol = isTeamGrain ? 'team' : 'mlbam';
  const src = DATASET_GLOB[p.dataset];
  const source = DATASET_SOURCE[p.dataset].label;
  const r = (await db.all(
    `SELECT min(year) AS first, max(year) AS last, count(*) AS rows,
            count(DISTINCT ${idCol}) AS entities
       FROM read_parquet('${src}') WHERE ${p.where}`))[0];
  if (p.unconsumed) {
    /* Zero is the interesting answer here, so this branch never omits. */
    const rows = Number(r.rows);
    unconsumedColumns[p.key] = {
      first: r.first == null ? null : Number(r.first),
      last: r.last == null ? null : Number(r.last),
      rows,
      players: Number(r.entities),
      source, dataset: p.dataset, grain: p.grain,
    };
    console.log(`${p.key.padEnd(22)} ${rows} rows (unconsumed column probe)`);
    continue;
  }
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
    ? { first, last, rows, source, dataset: p.dataset, grain: p.grain,
        teams: entities, teamYearsPerSeason: perSeason }
    : { first, last, rows, source, dataset: p.dataset, grain: p.grain,
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
  /* Filter by TYPE, not by a name denylist. A denylist is fragile the same
   * way a hardcoded column list is: if build-statcast.mjs later adds a
   * near-universally-populated categorical column (team, pos, game_date), a
   * name-based exclusion has to be remembered and updated, and forgetting it
   * would silently make that column "widest" and depress every ratio. A
   * numeric-type filter needs no such reminder — team/pos arrive as VARCHAR
   * and game_date as DATE, neither of which can enter the comparison. year
   * and mlbam are numeric and still have to be excluded explicitly. */
  const IDENTITY_COLS = new Set(['year', 'mlbam']);
  const NUMERIC_TYPE = /^(DOUBLE|FLOAT|DECIMAL|(TINY|SMALL|BIG|HUGE)?INT(EGER)?(HUGE)?)/i;
  const schema = await db.all(`DESCRIBE SELECT * FROM read_parquet('${STATCAST}')`);
  const candidateCols = schema
    .filter((row) => NUMERIC_TYPE.test(row.column_type) && !IDENTITY_COLS.has(row.column_name))
    .map((row) => row.column_name);
  console.log(`populationVsWidest candidate columns: ${candidateCols.join(', ')}`);

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

/* --- KPI coverage: all eleven diagnostics the design spec names. -----------
 *
 * `stats` above answers "does this COLUMN exist, and since when." That is not
 * the question intake actually has to answer. A rule is sold on the KPI shifts
 * it produces, so what intake needs is "can this KPI be computed for the year
 * the fan asked about, and what does a real season-to-season move look like."
 * Those differ: season_batting reaches 1876, but on-base percentage needs
 * sacrifice flies, which nobody recorded before 1954.
 *
 * Every number here is measured. `first`/`last` come from the years where all
 * of a KPI's required columns are actually populated; `sigma` is the effect-
 * size denominator, computed over the same series the query would return, so a
 * results page and a live sigma() call cannot disagree.
 *
 * `gapYears` is not padding. cs, gidp and sf each enter the record mid-history
 * and the middle of a KPI's range can still be hollow; a fan reading
 * "1954-2025" should not have to assume every year inside it is there. */
const MODERN = 1950;   // sigma's floor: rule changes before this are not comparable

/* data/games/ is the one OPTIONAL dataset in the spine: ten KPIs never touch
 * it, so a spine built without it is not broken, it is narrower. Its absence
 * therefore demotes ONE KPI to available:false rather than failing the whole
 * measurement — the opposite of the _build.json gate above, which refuses
 * everything, because there a partial spine makes every number suspect.
 *
 * Its own manifest must say complete:true for the same reason _build.json
 * must: a games build that lost seasons would silently narrow the variance
 * series, and a sigma computed over the years that happened to survive is a
 * yardstick nobody can interpret. */
const gamesManifestPath = path.join(DATA, 'games', '_games.json');
let gamesReady = false;
let gamesUnready = 'data/games/ is not built — run `node tools/build-games.mjs`';
/* Seasons still being played. Their variance is computed over a partial
 * season: real, but not comparable to a full one, and sigma is a series of
 * year-over-year deltas, so one partial year corrupts two of them. They are
 * excluded from the series and NAMED in the artifact, never silently dropped —
 * a reader who sees `last: 2025` in September 2026 has to be told why. */
let inProgressSeasons = [];
if (fs.existsSync(gamesManifestPath)) {
  const gm = JSON.parse(fs.readFileSync(gamesManifestPath, 'utf8'));
  gamesReady = gm.complete === true;
  inProgressSeasons = (gm.years || []).filter((y) => y.inProgress).map((y) => y.year);
  if (!gamesReady) {
    gamesUnready = 'data/games/_games.json reports complete=false '
      + `(${(gm.failures || []).length} failed seasons) — re-run \`node tools/build-games.mjs\``;
  }
}

const kpiList = {};
let certified = 0;
for (const [key, kpi] of Object.entries(KPIS)) {
  /* A KPI whose dataset was never built is reported unavailable WITH the
   * command that fixes it — the same contract the hard-blocked version of
   * this KPI carried before data/games/ existed. */
  if (kpi.dataset === 'games' && !gamesReady) {
    kpiList[key] = {
      available: false, requires: kpi.requires, unit: kpi.unit,
      reason: gamesUnready,
      blockedBy: 'node tools/build-games.mjs',
      source: DATASET_SOURCE.games.label, dataset: 'games',
    };
    console.log(`${key.padEnd(26)} UNAVAILABLE — ${gamesUnready}`);
    continue;
  }
  if (kpi.available === false) {
    kpiList[key] = {
      available: false, requires: kpi.requires, unit: kpi.unit,
      reason: kpi.reason, blockedBy: kpi.blockedBy,
      source: DATASET_SOURCE[kpi.dataset].label, dataset: kpi.dataset,
    };
    console.log(`${key.padEnd(26)} UNAVAILABLE — ${kpi.blockedBy}`);
    continue;
  }
  const present = kpi.requires.map((c) => `${c} IS NOT NULL`).join(' AND ');
  const exclude = kpi.dataset === 'games' && inProgressSeasons.length
    ? ` AND year NOT IN (${inProgressSeasons.join(', ')})` : '';
  const series = await db.all(
    `SELECT year, ${kpi.expr} AS v FROM read_parquet('${DATASET_GLOB[kpi.dataset]}')
      WHERE ${present}${exclude}
      GROUP BY year HAVING ${kpi.expr} IS NOT NULL ORDER BY year`);
  if (!series.length) {
    /* A KPI whose columns exist in the schema but are empty everywhere must
     * not silently vanish from the list — that would read as "not a KPI"
     * rather than "we have no data for it", the same misreporting that
     * unconsumedColumns exists to prevent. */
    kpiList[key] = {
      available: false, requires: kpi.requires, unit: kpi.unit,
      reason: 'required columns are present in the schema but NULL in every season',
      blockedBy: `rebuild the spine — \`node tools/build-${kpi.dataset === 'games' ? 'games' : 'seasons'}.mjs\``,
      source: DATASET_SOURCE[kpi.dataset].label, dataset: kpi.dataset,
    };
    console.log(`${key.padEnd(26)} UNAVAILABLE — no populated seasons`);
    continue;
  }
  const years = series.map((r) => Number(r.year));
  const first = years[0];
  const last = years[years.length - 1];
  /* The years INSIDE [first, last] that are not there. A first/last pair alone
   * is not a coverage answer for a KPI whose middle is hollow: strikeout_rate
   * spans 1876-2025 but 13 of those seasons have no populated `pa`, and a
   * range check would have told a fan asking about one of them that their
   * diagnostic was available. requireKpis() reads this list. */
  const have = new Set(years);
  const missingYears = [];
  for (let y = first; y <= last; y++) if (!have.has(y)) missingYears.push(y);
  const modern = series.filter((r) => Number(r.year) >= MODERN);
  const sigma = stdevOfDeltas(modern.map((r) => Number(r.v)));
  const latest = Number(series[series.length - 1].v);
  kpiList[key] = {
    available: true, first, last, seasons: years.length,
    gapYears: missingYears.length, missingYears,
    requires: kpi.requires, unit: kpi.unit,
    source: DATASET_SOURCE[kpi.dataset].label, dataset: kpi.dataset,
    grain: kpi.dataset === 'games' ? 'team-game' : 'team-season',
    sigma: sigma == null ? null : Number(sigma.toPrecision(4)),
    sigmaWindow: { from: Math.max(first, MODERN), to: last, seasons: modern.length },
    latestSeason: { year: last, value: Number(latest.toPrecision(5)) },
  };
  certified++;
  console.log(`${key.padEnd(26)} ${first}–${last}  ${years.length} seasons`
    + `${kpiList[key].gapYears ? ` (${kpiList[key].gapYears} missing)` : ''}`
    + `  sigma ${kpiList[key].sigma}  ${last}: ${kpiList[key].latestSeason.value}`);
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
  kpis: {
    note: 'The diagnostic KPIs from the design spec, measured. `stats` says a '
      + 'column exists; this says the KPI can be COMPUTED, for which years, and '
      + 'what one season-to-season move is worth (sigma) — the denominator '
      + 'effect-size ranking divides by. Definitions live in tools/lib/spine.mjs '
      + '(KPIS) and are shared with sigma(), so this table and a live query '
      + 'cannot disagree.',
    sigmaDefinition: 'stdev of the year-over-year change in the league-wide '
      + `value, over ${MODERN}+ only — pre-integration, pre-night-game baseball `
      + 'is not a comparable yardstick for a modern rule.',
    certified,
    total: Object.keys(KPIS).length,
    inProgressSeasons,
    inProgressNote: inProgressSeasons.length
      ? 'Excluded from every game-grain KPI series: a season still being played '
        + 'yields a partial-season value that is not comparable to a full one, '
        + 'and sigma is a series of year-over-year deltas.'
      : undefined,
    list: kpiList,
  },
  unconsumedColumns: {
    note: 'Columns probed for population only. They are NOT stats intake can '
      + 'require — a zero here means the column exists in the schema but the '
      + 'current source never fills it.',
    columns: unconsumedColumns,
  },
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
