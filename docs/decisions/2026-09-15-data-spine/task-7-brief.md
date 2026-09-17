### Task 7: The query layer

**Files:**
- Create: `tools/lib/spine.mjs`
- Create: `tests/spine-query.test.js`

**Interfaces:**
- Consumes: `openDb`, `sqlPath`; everything Tasks 3–6 wrote.
- Produces — this is the whole public surface of the data spine; nothing downstream reads Parquet directly:
  - `openSpine(dataDir?: string): Promise<Spine>`
  - `Spine.coverage(): Promise<{ generatedAt: string, stats: Record<string, {first:number,last:number,rows:number,source:string,grain:string}> }>`
  - `Spine.seasonLines({ year: number, role?: 'bat'|'pit', minPA?: number, limit?: number }): Promise<object[]>`
  - `Spine.teamLineup({ year: number, team: string, size?: number }): Promise<object[]>` — the nine highest-PA batters with Statcast `spd`/`hp1` attached, the same shape `data.js` hands `sim.js` today
  - `Spine.sigma(stat: string, from?: number, to?: number): Promise<number>` — real season-to-season standard deviation of a league-level rate, which is the denominator the diagnostics rank effect sizes against
  - `Spine.close(): Promise<void>`
  - `requireCoverage(cov, statKeys: string[], year: number): { ok: boolean, missing: Array<{stat:string,first:number,last:number}> }` — the intake guard, a pure function so it can be unit-tested with no data on disk

- [ ] **Step 1: Write the failing test**

Create `tests/spine-query.test.js`:

```js
/* Spine query layer + the intake guard. Run: node tests/spine-query.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const spine = await import('../tools/lib/spine.mjs');

  // requireCoverage is pure — it must be testable with no data on disk.
  const cov = { stats: {
    sprint_speed: { first: 2015, last: 2025 },
    season_batting: { first: 1871, last: 2025 },
  } };
  const ok2024 = spine.requireCoverage(cov, ['sprint_speed'], 2024);
  check('guard allows a supported year', ok2024.ok === true, JSON.stringify(ok2024));

  const bad1927 = spine.requireCoverage(cov, ['sprint_speed'], 1927);
  check('guard rejects tracking in 1927', bad1927.ok === false, JSON.stringify(bad1927));
  check('guard names the offending stat',
    bad1927.missing.length === 1 && bad1927.missing[0].stat === 'sprint_speed',
    JSON.stringify(bad1927.missing));
  check('guard reports the real first year',
    bad1927.missing[0].first === 2015, JSON.stringify(bad1927.missing[0]));

  const unknown = spine.requireCoverage(cov, ['pitch_spin'], 2024);
  check('guard rejects an unknown stat', unknown.ok === false, JSON.stringify(unknown));

  if (!fs.existsSync(path.join(ROOT, 'data', 'coverage.json'))) {
    console.log('skip  data/ not built — query assertions skipped');
    process.exit(failures ? 1 : 0);
  }

  const s = await spine.openSpine();

  const c = await s.coverage();
  check('coverage loads', !!c.stats.season_batting, Object.keys(c.stats).join(','));

  const lines = await s.seasonLines({ year: 2024, role: 'bat', minPA: 502 });
  check('2024 qualified batters is a plausible count',
    lines.length > 100 && lines.length < 200, `n=${lines.length}`);

  const pitchers = await s.seasonLines({ year: 2024, role: 'pit' });
  check('2024 has pitchers', pitchers.length > 500, `n=${pitchers.length}`);

  const lad = await s.teamLineup({ year: 2024, team: 'LAN' });
  check('lineup returns nine batters', lad.length === 9, `n=${lad.length}`);
  check('lineup carries statcast speed',
    lad.filter((p) => p.spd != null).length >= 7,
    `with spd=${lad.filter((p) => p.spd != null).length}`);
  check('lineup has the fields sim.js needs',
    lad[0] && ['name', 'pa', 'h', 'd2', 'd3', 'hr', 'bb', 'so']
      .every((k) => lad[0][k] != null), JSON.stringify(lad[0]));

  const sd = await s.sigma('runs_per_game', 2000, 2024);
  check('season-to-season sigma is a small positive number',
    sd > 0 && sd < 1.5, `sigma=${sd}`);

  await s.close();
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/spine-query.test.js`
Expected: FAIL — `Cannot find module '../tools/lib/spine.mjs'`

- [ ] **Step 3: Write the implementation**

Create `tools/lib/spine.mjs`:

```js
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

export async function openSpine(dataDir = path.join(ROOT, 'data')) {
  const db = await openDb();
  const seasons = sqlPath(path.join(dataDir, 'seasons', '*.parquet'));
  const statcast = sqlPath(path.join(dataDir, 'statcast', '*.parquet'));
  const players = sqlPath(path.join(dataDir, 'players.parquet'));
  const league = sqlPath(path.join(dataDir, 'league', '*.parquet'));

  return {
    async coverage() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, 'coverage.json'), 'utf8'));
    },

    async seasonLines({ year, role = 'bat', minPA = 0, limit = 0 }) {
      const gate = role === 'bat' ? `pa >= ${minPA}` : 'ipouts > 0';
      return db.all(
        `SELECT * FROM read_parquet('${seasons}')
          WHERE year = ${year} AND role = '${role}' AND ${gate}
          ORDER BY ${role === 'bat' ? 'pa' : 'ipouts'} DESC
          ${limit ? `LIMIT ${limit}` : ''}`);
    },

    /* The nine highest-PA batters for a club, with Statcast running data
     * attached on MLBAM id via the crosswalk — the same shape data.js hands
     * sim.js, so the simulator does not care which one it is fed. */
    async teamLineup({ year, team, size = 9 }) {
      return db.all(
        `SELECT s.name, s.team, s.pa, s.h, s.d2, s.d3, s.hr,
                s.bb + COALESCE(s.hbp, 0) AS bb, s.so,
                c.spd, c.hp1
           FROM read_parquet('${seasons}') s
           LEFT JOIN read_parquet('${players}') p ON p.bbref = s.bbref
           LEFT JOIN read_parquet('${statcast}') c
                  ON c.mlbam = p.mlbam AND c.year = s.year
          WHERE s.year = ${year} AND s.role = 'bat' AND s.team = '${team}'
          ORDER BY s.pa DESC
          LIMIT ${size}`);
    },

    /* The denominator for effect-size ranking: how much this rate really moves
     * between consecutive seasons. A rule that shifts runs/game by 3 sigma
     * moved it further than any two real seasons ever did. */
    async sigma(stat, from = 1950, to = 2024) {
      /* Team-season totals, not per-player lines: only Teams.csv knows how many
       * games a club played, so these rates are exact rather than proxies. */
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/spine-query.test.js`
Expected: twelve `ok` lines, exit 0.

`sigma('runs_per_game', 2000, 2024)` should land near 0.15–0.35: that is how much league runs per team-game really moves between consecutive seasons, and it is the denominator the diagnostics divide by. If it comes back above 1.5, check that `data/league/*.parquet` exists and that `sum(g)` is team-games and not doubled.

If `teamLineup` returns zero rows, check the team code: Lahman uses `LAN` for the Dodgers and `NYA` for the Yankees, not `LAD`/`NYY`. That mapping belongs in Task 8's notes, not a silent fix here.

- [ ] **Step 5: Verify the full suite**

Run: `node tools/run-tests.mjs`
Expected: `19/19 test files passed`.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/spine.mjs tests/spine-query.test.js
git commit -m "feat: add spine query layer and the pure intake coverage guard"
```

---

