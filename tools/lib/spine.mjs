/* moreBasesBall — the data spine's public surface.
 *
 * Nothing outside this file reads parquet. The simulator, the diagnostics, and
 * intake all go through here, so the storage layout stays swappable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, sqlPath } from './duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The eleven diagnostic KPIs the design spec names, in ONE place: this table is
 * what `sigma()` computes from and what build-coverage.mjs measures coverage
 * for. Two copies would drift, and a KPI whose coverage entry and whose sigma
 * expression disagreed would rank a rule's effect against the wrong yardstick
 * without anything going red.
 *
 * `requires` is not decoration. Each column is NULL in the eras that never
 * recorded it (the Stats API omits the key, build-seasons.mjs preserves that as
 * NULL), so both the coverage probe and the sigma query filter on it, and each
 * KPI reports its own real first year instead of the league table's 1876.
 *
 * `available: false` is a first-class answer. run_distribution_variance is a
 * property of the per-GAME run distribution and the spine holds team-SEASON
 * totals; there is no expression over these columns that yields it. Reporting
 * it as a KPI that is present-but-unavailable is the point — intake can refuse
 * a rule whose diagnostic cannot be computed, which it could not do if the KPI
 * were simply absent from the table. */
export const KPIS = {
  runs_per_game: {
    expr: 'sum(r) * 1.0 / sum(g)', requires: ['r', 'g'], unit: 'runs/game' },
  batting_average: {
    expr: 'sum(h) * 1.0 / sum(ab)', requires: ['h', 'ab'], unit: 'rate' },
  on_base_percentage: {
    expr: 'sum(h + bb + hbp) * 1.0 / sum(ab + bb + hbp + sf)',
    requires: ['h', 'bb', 'hbp', 'ab', 'sf'], unit: 'rate' },
  slugging: {
    /* Total bases from the counting columns: singles are h - d2 - d3 - hr, so
     * TB = h + d2 + 2*d3 + 3*hr. The league table has no `tb` column. */
    expr: 'sum(h + d2 + 2 * d3 + 3 * hr) * 1.0 / sum(ab)',
    requires: ['h', 'd2', 'd3', 'hr', 'ab'], unit: 'rate' },
  home_runs_per_game: {
    expr: 'sum(hr) * 1.0 / sum(g)', requires: ['hr', 'g'], unit: 'HR/game' },
  strikeout_rate: {
    /* so/PA exactly. The old so/(ab+bb) was a PA proxy that omitted HBP and
     * sacrifices — it ran ~1-2% high and drifted with era. */
    expr: 'sum(so) * 1.0 / sum(pa)', requires: ['so', 'pa'], unit: 'rate' },
  walk_rate: {
    expr: 'sum(bb) * 1.0 / sum(pa)', requires: ['bb', 'pa'], unit: 'rate' },
  steal_attempt_rate: {
    expr: 'sum(sb + cs) * 1.0 / sum(g)', requires: ['sb', 'cs', 'g'],
    unit: 'attempts/game' },
  steal_success_rate: {
    expr: 'sum(sb) * 1.0 / nullif(sum(sb + cs), 0)', requires: ['sb', 'cs'],
    unit: 'rate' },
  double_play_rate: {
    expr: 'sum(gidp) * 1.0 / sum(pa)', requires: ['gidp', 'pa'], unit: 'rate' },
  run_distribution_variance: {
    available: false,
    requires: ['per-game run totals'],
    unit: 'runs^2',
    reason: 'the spine holds team-SEASON totals; run-distribution variance is a '
      + 'property of the per-game distribution, which no column here carries',
    blockedBy: 'needs a game-level builder over the Stats API schedule/linescore '
      + 'endpoints — a new dataset, not a new column',
  },
};

/* Pure: the effect-size yardstick itself — the standard deviation of the
 * season-to-season CHANGE in a series, not of the series. Exported because
 * build-coverage.mjs bakes each KPI's sigma into coverage.json and sigma()
 * answers it live; a second copy of four lines of arithmetic is exactly the
 * kind of duplication that lets a published number and a queried number
 * disagree. Returns null for a series too short to have two deltas rather
 * than NaN, which would render as a real zero on a results page. */
export function stdevOfDeltas(values) {
  const deltas = [];
  for (let i = 1; i < values.length; i++) deltas.push(values[i] - values[i - 1]);
  if (deltas.length < 2) return null;
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length);
}

/* Pure: the intake guard for diagnostics. A rule is sold on the KPI shifts it
 * produces, so intake must be able to refuse one whose KPI the spine cannot
 * compute for the requested season — for the same reason requireCoverage()
 * exists, and before the fan is charged. An unavailable KPI and a KPI outside
 * its year range are both refusals, but they are different sentences, so the
 * caller gets `reason` rather than having to infer it. */
export function requireKpis(cov, kpiKeys, year) {
  const list = cov.kpis?.list || {};
  const missing = [];
  for (const kpi of kpiKeys) {
    const c = list[kpi];
    if (!c) { missing.push({ kpi, reason: 'unknown', first: null, last: null }); continue; }
    if (c.available === false) {
      missing.push({ kpi, reason: c.reason || 'unavailable', first: null, last: null });
      continue;
    }
    if (year < c.first || year > c.last) {
      missing.push({ kpi, reason: 'outside coverage', first: c.first, last: c.last });
      continue;
    }
    /* A hollow year inside the range is still a refusal. strikeout_rate spans
     * 1876-2025 but 13 seasons in the middle have no populated `pa`; checking
     * only first/last would certify one of them and the fan would be charged
     * for a diagnostic that cannot be computed. */
    if (c.missingYears?.includes(year)) {
      missing.push({ kpi, reason: 'gap inside coverage', first: c.first, last: c.last });
    }
  }
  return { ok: missing.length === 0, missing };
}

/* Pure: the intake guard. Given a coverage manifest, the stats a rule needs,
 * and the season it asks about, say whether the data exists — and if not, name
 * what is missing and when it starts, because that is the fan-facing message. */
export function requireCoverage(cov, statKeys, year) {
  const missing = [];
  for (const stat of statKeys) {
    const c = cov.stats[stat];
    if (!c) { missing.push({ stat, first: null, last: null }); continue; }
    if (year < c.first || year > c.last) {
      missing.push({ stat, first: c.first, last: c.last });
    }
  }
  return { ok: missing.length === 0, missing };
}

/* Pure: which clubs in a given year have team totals but no player-level
 * rows (Negro Leagues clubs 1920-1948, the 1914-15 Federal League, etc). A
 * results page for that year can name them instead of silently under-counting
 * a lineup. Reads only the object it is handed — no filesystem, no database. */
export function leagueOnlyClubs(cov, year) {
  return cov.leagueOnlySeasons?.years?.[String(year)] ?? [];
}

/* DuckDB returns BIGINT for count(*) and integer columns, which arrives in JS
 * as BigInt and throws on JSON.stringify; Statcast's spd/hp1 columns are
 * DECIMAL and arrive as DuckDBDecimalValue objects, same problem. seasonLines
 * and teamLineup hand rows straight to callers (sim.js, results pages) that
 * will JSON.stringify or do arithmetic on them, so numerics are normalised to
 * plain JS numbers here at the boundary rather than pushed onto every caller. */
function normaliseRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (v != null && typeof v === 'object' && typeof v.toDouble === 'function') out[k] = v.toDouble();
    else out[k] = v;
  }
  return out;
}
const normaliseRows = (rows) => rows.map(normaliseRow);

/* Validation guards for the SQL boundary. seasonLines/teamLineup/sigma
 * interpolate these values into SQL text (DuckDB's Node binding has no
 * parameterised-query path through read_parquet in the version pinned here),
 * so this module IS the trust boundary between caller-supplied values and the
 * query string. Throw on anything unexpected rather than sanitising, so a
 * caller passing garbage learns that instead of getting quietly-wrong rows. */
const TEAM_RE = /^[A-Z]{2,4}(-[A-Z])?$/;

function checkYear(year, label = 'year') {
  if (!Number.isInteger(year)) throw new Error(`spine: ${label} must be an integer`);
  return year;
}

function checkTeam(team) {
  if (typeof team !== 'string' || !TEAM_RE.test(team)) {
    throw new Error(`spine: team must match ${TEAM_RE} (got ${JSON.stringify(team)})`);
  }
  return team;
}

function checkRole(role) {
  if (role !== 'bat' && role !== 'pit') {
    throw new Error(`spine: role must be 'bat' or 'pit' (got ${JSON.stringify(role)})`);
  }
  return role;
}

function checkCount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`spine: ${label} must be a non-negative number (got ${JSON.stringify(value)})`);
  }
  return n;
}

export async function openSpine(dataDir = path.join(ROOT, 'data'), opts = {}) {
  const manifestPath = path.join(dataDir, '_build.json');
  if (!opts.allowIncomplete) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error('openSpine: data/_build.json is missing — run '
        + '`node tools/build-seasons.mjs` first. Refusing to serve an unverified spine.');
    }
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.complete !== true) {
      throw new Error('openSpine: spine build reports complete=false '
        + `(${(m.failures || []).length} failures). Refusing to serve partial data.`);
    }
  }

  const db = await openDb();
  const seasons = sqlPath(path.join(dataDir, 'seasons', '*.parquet'));
  const statcast = sqlPath(path.join(dataDir, 'statcast', '*.parquet'));
  const league = sqlPath(path.join(dataDir, 'league', '*.parquet'));

  return {
    /* coverage.json and the parquet it measured must come from the SAME build.
     * `node tools/build-seasons.mjs 2020 2025` rewrites _build.json with six
     * year entries while data/seasons/ still holds 1876-2019 from an earlier
     * run; build-coverage.mjs then derives leagueOnlySeasons from the MANIFEST
     * but measures first/last from the PARQUET, so one coverage.json describes
     * two different builds — totalEmptyClubYears collapses toward 0 and
     * leagueOnlyClubs(cov, 1924) returns [], silently dropping the Negro
     * Leagues provenance a 1924 results page exists to surface. spineBuiltAt
     * is written so that is detectable; this is where it gets detected. */
    async coverage() {
      const cov = JSON.parse(fs.readFileSync(path.join(dataDir, 'coverage.json'), 'utf8'));
      if (fs.existsSync(manifestPath)) {
        const builtAt = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).finishedAt;
        if (cov.spineBuiltAt !== builtAt) {
          throw new Error('spine: coverage.json is stale relative to the spine build — '
            + `coverage.json reports spineBuiltAt=${JSON.stringify(cov.spineBuiltAt)} `
            + `but data/_build.json finished at ${JSON.stringify(builtAt)}. `
            + 'Re-run `node tools/build-coverage.mjs` against the current spine.');
        }
      }
      return cov;
    },

    /* The parsed build manifest, so a results page can state which build
     * produced its numbers. */
    async buildInfo() {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    },

    async seasonLines({ year, role = 'bat', minPA = 0, limit = 0 }) {
      checkYear(year);
      checkRole(role);
      minPA = checkCount(minPA, 'minPA');
      limit = checkCount(limit, 'limit');
      const gate = role === 'bat' ? `pa >= ${minPA}` : 'ipouts > 0';
      const rows = await db.all(
        `SELECT * FROM read_parquet('${seasons}')
          WHERE year = ${year} AND role = '${role}' AND ${gate}
          ORDER BY ${role === 'bat' ? 'pa' : 'ipouts'} DESC
          ${limit ? `LIMIT ${limit}` : ''}`);
      return normaliseRows(rows);
    },

    /* The nine highest-PA batters for a club, with Statcast running data
     * attached directly on mlbam — Task 3's source writes a native mlbam on
     * every seasons row (bbref is NULL there), so no crosswalk hop is needed.
     * Same shape data.js hands sim.js today, so the simulator does not care
     * which one it is fed. */
    async teamLineup({ year, team, size = 9 }) {
      checkYear(year);
      checkTeam(team);
      size = checkCount(size, 'size');
      const rows = await db.all(
        `SELECT s.name, s.pos, s.team, s.pa, s.h, s.d2, s.d3, s.hr,
                s.bb + COALESCE(s.hbp, 0) AS bb, s.so,
                c.spd, c.hp1
           FROM read_parquet('${seasons}') s
           LEFT JOIN read_parquet('${statcast}') c
                  ON c.mlbam = s.mlbam AND c.year = s.year
          WHERE s.year = ${year} AND s.role = 'bat' AND s.team = '${team}'
          ORDER BY s.pa DESC
          LIMIT ${size}`);
      return normaliseRows(rows);
    },

    /* The denominator for effect-size ranking: how much this rate really moves
     * between consecutive seasons. A rule that shifts runs/game by 3 sigma
     * moved it further than any two real seasons ever did. Team-season
     * totals, not per-player lines: only the league dataset knows how many
     * games a club played, so these rates are exact rather than proxies. */
    async sigma(stat, from = 1950, to = 2024) {
      checkYear(from, 'from');
      checkYear(to, 'to');
      if (!Object.hasOwn(KPIS, stat)) throw new Error(`sigma: unknown stat ${stat}`);
      const kpi = KPIS[stat];
      /* Refuse rather than return a number for a KPI the spine cannot compute.
       * A silent NaN here would become a "0.0 sigma" on a results page, which
       * makes every rule look era-defining. */
      if (kpi.available === false) {
        throw new Error(`sigma: ${stat} is not computable from this spine — ${kpi.reason}`);
      }
      /* Drop the years that predate any required column instead of letting a
       * NULL propagate: sum() over a column that is NULL for the whole season
       * yields NULL, and one NULL year would blank two consecutive deltas. */
      const present = kpi.requires.map((c) => `${c} IS NOT NULL`).join(' AND ');
      const rows = await db.all(
        `SELECT year, ${kpi.expr} AS v FROM read_parquet('${league}')
          WHERE year BETWEEN ${from} AND ${to} AND ${present}
          GROUP BY year HAVING ${kpi.expr} IS NOT NULL ORDER BY year`);
      return stdevOfDeltas(rows.map((r) => Number(r.v)));
    },

    async close() { await db.close(); },
  };
}
