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
        + `(${m.failures.length} failures). Refusing to serve partial data.`);
    }
  }

  const db = await openDb();
  const seasons = sqlPath(path.join(dataDir, 'seasons', '*.parquet'));
  const statcast = sqlPath(path.join(dataDir, 'statcast', '*.parquet'));
  const league = sqlPath(path.join(dataDir, 'league', '*.parquet'));

  return {
    async coverage() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, 'coverage.json'), 'utf8'));
    },

    /* The parsed build manifest, so a results page can state which build
     * produced its numbers. */
    async buildInfo() {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    },

    async seasonLines({ year, role = 'bat', minPA = 0, limit = 0 }) {
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
      const EXPR = {
        runs_per_game: 'sum(r) * 1.0 / sum(g)',
        home_runs_per_game: 'sum(hr) * 1.0 / sum(g)',
        strikeout_rate: 'sum(so) * 1.0 / (sum(ab) + sum(bb))',
        walk_rate: 'sum(bb) * 1.0 / (sum(ab) + sum(bb))',
        batting_average: 'sum(h) * 1.0 / sum(ab)',
      };
      if (!EXPR[stat]) throw new Error(`sigma: unknown stat ${stat}`);
      const rows = await db.all(
        `SELECT year, ${EXPR[stat]} AS v FROM read_parquet('${league}')
          WHERE year BETWEEN ${from} AND ${to}
          GROUP BY year ORDER BY year`);
      const deltas = [];
      for (let i = 1; i < rows.length; i++) deltas.push(Number(rows[i].v) - Number(rows[i - 1].v));
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length);
    },

    async close() { await db.close(); },
  };
}
