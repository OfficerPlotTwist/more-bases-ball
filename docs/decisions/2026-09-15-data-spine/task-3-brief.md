### Task 3: Season lines for every player, 1871+, batters and pitchers

**Files:**
- Create: `tools/build-seasons.mjs`
- Create: `tools/lib/duck.mjs`
- Create: `tests/seasons-data.test.js`

**Interfaces:**
- Consumes: `getText`, `cachePath` from `tools/lib/fetch.mjs`.
- Produces:
  - `tools/lib/duck.mjs`: `openDb(file?: string): Promise<{ conn, all(sql: string): Promise<object[]>, run(sql: string): Promise<void>, close(): Promise<void> }>`
  - `data/seasons/{year}.parquet` with columns:
    `year INT, mlbam INT, bbref VARCHAR, name VARCHAR, team VARCHAR, lg VARCHAR, role VARCHAR, pa INT, ab INT, h INT, d2 INT, d3 INT, hr INT, bb INT, so INT, sb INT, cs INT, hbp INT, ipouts INT, er INT, bf INT, p_h INT, p_bb INT, p_so INT, p_hr INT`
  - `role` is `'bat'` or `'pit'`; a two-way player has one row of each.
  - `data/league/{year}.parquet` — one row per **team-season** from `core/Teams.csv`, columns
    `year INT, team VARCHAR, lg VARCHAR, g INT, w INT, l INT, r INT, ra INT, ab INT, h INT, d2 INT, d3 INT, hr INT, bb INT, so INT`.
    Lahman's per-player Batting table carries no team-games, so there is no way to
    compute a true runs-per-game from it. Teams.csv has both `R` and `G`. Task 7's
    `sigma()` — the denominator the spec's effect-size ranking divides by — needs an
    exact league rate, not a proxy, which is why this dataset exists.

Source is Chadwick Bureau's baseballdatabank, which is the maintained Lahman database: `https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core/{Batting,Pitching,People}.csv`. It starts in 1871 and is the only free source that goes back that far for both roles.

**Two gotchas worth stating up front.** Lahman has no plate-appearances column — `pa = AB + BB + HBP + SH + SF`, and the existing `data.js` convention folds HBP into `bb`, so keep `hbp` separate here and let consumers decide. And columns named `2B`/`3B` must be double-quoted in SQL or DuckDB reads them as numbers.

- [ ] **Step 1: Write the failing test**

Create `tests/seasons-data.test.js`:

```js
/* Season Parquet: coverage, both roles, derived PA. Run: node tests/seasons-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'seasons');
if (!fs.existsSync(DIR)) {
  console.log('skip  data/seasons not built — run `node tools/build-seasons.mjs`');
  process.exit(0);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { openDb } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const glob = path.join(DIR, '*.parquet').replace(/\\/g, '/');

  const span = (await db.all(
    `SELECT min(year) AS lo, max(year) AS hi FROM read_parquet('${glob}')`))[0];
  check('history reaches 1871', Number(span.lo) === 1871, `lo=${span.lo}`);
  check('history reaches 2024 or later', Number(span.hi) >= 2024, `hi=${span.hi}`);

  const roles = await db.all(
    `SELECT role, count(*) AS n FROM read_parquet('${glob}') GROUP BY role ORDER BY role`);
  const byRole = Object.fromEntries(roles.map((r) => [r.role, Number(r.n)]));
  check('batter seasons present', byRole.bat > 100000, `bat=${byRole.bat}`);
  check('pitcher seasons present', byRole.pit > 40000, `pit=${byRole.pit}`);

  // Pedro Martinez, 2000: a line every baseball fan can check by eye.
  const pedro = (await db.all(
    `SELECT er, ipouts, p_so FROM read_parquet('${glob}')
     WHERE year = 2000 AND role = 'pit' AND name = 'Pedro Martinez'`))[0];
  check('known pitcher season is right',
    pedro && Number(pedro.p_so) === 284 && Number(pedro.ipouts) === 651,
    JSON.stringify(pedro));

  // PA must be derived, not null, for anyone with plate appearances.
  const badPa = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}')
     WHERE role = 'bat' AND ab > 0 AND (pa IS NULL OR pa < ab)`))[0];
  check('derived PA is never below AB', Number(badPa.n) === 0, `bad=${badPa.n}`);

  const noId = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE bbref IS NULL`))[0];
  check('every row carries a player id', Number(noId.n) === 0, `null=${noId.n}`);

  // Team totals: the only Tier A source of team-games, so runs/game is exact.
  const lg = path.join(ROOT, 'data', 'league', '*.parquet').replace(/\\/g, '/');
  const rpg = (await db.all(
    `SELECT sum(r) * 1.0 / sum(g) AS v FROM read_parquet('${lg}') WHERE year = 2019`))[0];
  check('2019 runs per team-game is ~4.8',
    Number(rpg.v) > 4.5 && Number(rpg.v) < 5.1, `rpg=${Number(rpg.v).toFixed(3)}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/seasons-data.test.js`
Expected: `skip  data/seasons not built` and exit 0. That skip is the failing state for now — it proves the guard works. Once the builder runs in Step 5 it must turn into real assertions.

- [ ] **Step 3: Write the DuckDB wrapper**

Create `tools/lib/duck.mjs`:

```js
/* Thin DuckDB wrapper. Every builder and the query layer goes through this so
 * there is one place that knows the driver's shape. */
import { DuckDBInstance } from '@duckdb/node-api';

export async function openDb(file = ':memory:') {
  const instance = await DuckDBInstance.create(file);
  const conn = await instance.connect();
  return {
    conn,
    async all(sql) {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjects();
    },
    async run(sql) { await conn.run(sql); },
    async close() { conn.closeSync?.(); },
  };
}

/* DuckDB takes forward slashes in SQL string literals on every platform. */
export const sqlPath = (p) => p.replace(/\\/g, '/');
```

- [ ] **Step 4: Write the season builder**

Create `tools/build-seasons.mjs`:

```js
/* moreBasesBall — build data/seasons/{year}.parquet
 *
 *   node tools/build-seasons.mjs
 *
 * Source: Chadwick Bureau's baseballdatabank (the maintained Lahman database),
 * which covers 1871 to the most recent completed season for BOTH batters and
 * pitchers. data.js covers only nine batters per club since 2021; this is the
 * full population the rule-change simulator draws from.
 *
 * Lahman has no plate-appearances column: pa = AB + BB + HBP + SH + SF.
 * Columns named "2B"/"3B" must be quoted or DuckDB reads them as numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, cachePath } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'seasons');
const BASE = 'https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core';

/* Download to the shared cache, then hand DuckDB the cached file path. */
const localise = async (name) => {
  const url = `${BASE}/${name}`;
  await getText(url);
  return sqlPath(cachePath(url));
};

const [batting, pitching, people, teams] = await Promise.all(
  ['Batting.csv', 'Pitching.csv', 'People.csv', 'Teams.csv'].map(localise));

const LEAGUE = path.join(ROOT, 'data', 'league');
fs.mkdirSync(LEAGUE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const db = await openDb();

await db.run(`CREATE VIEW people AS SELECT
    playerID AS bbref,
    TRY_CAST(retroID AS VARCHAR) AS retro,
    nameFirst || ' ' || nameLast AS name
  FROM read_csv_auto('${people}', header = true)`);

/* One row per player-season: Lahman splits mid-season trades into stints. */
await db.run(`CREATE VIEW bat AS SELECT
    yearID AS year, playerID AS bbref,
    any_value(teamID) AS team, any_value(lgID) AS lg,
    sum(AB) AS ab, sum(H) AS h, sum("2B") AS d2, sum("3B") AS d3,
    sum(HR) AS hr, sum(BB) AS bb, sum(SO) AS so,
    sum(SB) AS sb, sum(CS) AS cs, sum(COALESCE(HBP,0)) AS hbp,
    sum(AB) + sum(BB) + sum(COALESCE(HBP,0))
      + sum(COALESCE(SH,0)) + sum(COALESCE(SF,0)) AS pa
  FROM read_csv_auto('${batting}', header = true)
  GROUP BY yearID, playerID`);

await db.run(`CREATE VIEW pit AS SELECT
    yearID AS year, playerID AS bbref,
    any_value(teamID) AS team, any_value(lgID) AS lg,
    sum(IPouts) AS ipouts, sum(ER) AS er, sum(COALESCE(BFP,0)) AS bf,
    sum(H) AS p_h, sum(BB) AS p_bb, sum(SO) AS p_so, sum(HR) AS p_hr
  FROM read_csv_auto('${pitching}', header = true)
  GROUP BY yearID, playerID`);

await db.run(`CREATE VIEW seasons AS
  SELECT b.year, NULL::INTEGER AS mlbam, b.bbref, p.name, b.team, b.lg,
         'bat' AS role, b.pa, b.ab, b.h, b.d2, b.d3, b.hr, b.bb, b.so,
         b.sb, b.cs, b.hbp,
         NULL::BIGINT AS ipouts, NULL::BIGINT AS er, NULL::BIGINT AS bf,
         NULL::BIGINT AS p_h, NULL::BIGINT AS p_bb, NULL::BIGINT AS p_so,
         NULL::BIGINT AS p_hr
    FROM bat b JOIN people p USING (bbref)
  UNION ALL
  SELECT q.year, NULL::INTEGER, q.bbref, p.name, q.team, q.lg,
         'pit', NULL::HUGEINT, NULL::HUGEINT, NULL::HUGEINT, NULL::HUGEINT,
         NULL::HUGEINT, NULL::HUGEINT, NULL::HUGEINT, NULL::HUGEINT,
         NULL::HUGEINT, NULL::HUGEINT, NULL::HUGEINT,
         q.ipouts, q.er, q.bf, q.p_h, q.p_bb, q.p_so, q.p_hr
    FROM pit q JOIN people p USING (bbref)`);

/* Team-season totals. The only place in Tier A that knows how many games a club
 * actually played, which is what makes an exact runs-per-game possible. */
await db.run(`CREATE VIEW league AS SELECT
    yearID AS year, teamID AS team, lgID AS lg,
    G AS g, W AS w, L AS l, R AS r, RA AS ra,
    AB AS ab, H AS h, "2B" AS d2, "3B" AS d3, HR AS hr, BB AS bb, SO AS so
  FROM read_csv_auto('${teams}', header = true)`);

const years = (await db.all('SELECT DISTINCT year FROM seasons ORDER BY year'))
  .map((r) => Number(r.year));

for (const y of years) {
  const file = sqlPath(path.join(OUT, `${y}.parquet`));
  await db.run(
    `COPY (SELECT * FROM seasons WHERE year = ${y}) TO '${file}' (FORMAT PARQUET)`);
}

const leagueYears = (await db.all('SELECT DISTINCT year FROM league ORDER BY year'))
  .map((r) => Number(r.year));
for (const y of leagueYears) {
  const file = sqlPath(path.join(LEAGUE, `${y}.parquet`));
  await db.run(
    `COPY (SELECT * FROM league WHERE year = ${y}) TO '${file}' (FORMAT PARQUET)`);
}
console.log(`league  ${leagueYears.length} seasons of team totals`);

const totals = (await db.all(
  `SELECT role, count(*) AS n FROM seasons GROUP BY role ORDER BY role`));
console.log(`seasons ${years[0]}–${years[years.length - 1]}  files ${years.length}`);
for (const t of totals) console.log(`  ${t.role}  ${t.n} player-seasons`);

await db.close();
```

- [ ] **Step 5: Run the builder**

Run: `node tools/build-seasons.mjs`
Expected: roughly `seasons 1871–2025  files 155`, a `league  155 seasons of team totals` line, then a `bat` count above 100,000 and a `pit` count above 40,000. First run downloads ~40 MB; later runs read the cache.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/seasons-data.test.js`
Expected: seven `ok` lines, exit 0. If "known pitcher season is right" fails, print the row and check whether `name` collides — two Pedro Martinezes pitched in MLB, so if the count is above one, tighten the query with `AND ipouts > 600`.

- [ ] **Step 7: Verify the full suite**

Run: `node tools/run-tests.mjs`
Expected: `15/15 test files passed`.

- [ ] **Step 8: Commit**

```bash
git add tools/lib/duck.mjs tools/build-seasons.mjs tests/seasons-data.test.js
git commit -m "feat: build season-line parquet for all players 1871+, batters and pitchers"
```

---

