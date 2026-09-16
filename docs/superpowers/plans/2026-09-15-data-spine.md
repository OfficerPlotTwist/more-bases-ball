# Data Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nine-batters-per-club, 2021–2025 slice in `data.js` with a queryable Parquet data lake covering every MLB player — batters **and** pitchers — from 1871 to the present, plus Statcast tracking from 2015, plus a generated `coverage.json` that states exactly how far back each statistic goes.

**Architecture:** Five small ESM builders each own one source and write one Parquet dataset. DuckDB is the single engine: it reads the source CSVs, does the joins, writes the Parquet, and later answers queries in-process — so there is no database server to run or pay for. A `tools/lib/query.mjs` module is the only interface the rest of the product uses; nothing downstream reads Parquet directly. `coverage.json` is *derived from what actually landed on disk*, never hardcoded, because the product enforces it at intake before taking payment.

**Tech Stack:** Node 22 (ESM for tools, CommonJS for tests), DuckDB via `@duckdb/node-api`, Parquet. Sources: Chadwick Bureau's baseballdatabank (Lahman), Chadwick Register, Baseball Savant, MLB Stats API — all free, none key-gated.

**Spec:** `docs/superpowers/specs/2026-09-15-sim-as-a-service-design.md`

## Global Constraints

- Node **22.18+**. Tools are ESM (`.mjs`); tests are CommonJS (`.js`) and load ESM via `await import()`.
- **Exactly one new npm dependency: `@duckdb/node-api`.** The repo has zero dependencies today. DuckDB covers CSV ingest, joins, Parquet write, and query — do not add a separate Parquet or HTTP library.
- **The existing twelve `tests/*.test.js` must pass unchanged, with no network, after every task.** `AGENTS.md` documents the loop: `for t in tests/*.test.js; do node $t; done`.
- **`data.js` output must stay byte-identical.** Its run environment is published in `README.md` (1 base ≈ 18 runs/game, 7 ≈ 6) and `tests/ngon.test.js` asserts box scores do not move.
- **No hardcoded absolute paths or drive letters.** Use `path.join` and `fileURLToPath(import.meta.url)`. Write LF, not CRLF.
- New tests must **skip with a clear message** when `data/` has not been built, and assert hard when it has. A fresh clone with no network must still show twelve green tests.
- Derived datasets live in `data/` and are **not** committed.

---

### Task 1: Project scaffolding and DuckDB smoke test

**Files:**
- Create: `package.json`
- Create: `tools/run-tests.mjs`
- Create: `tests/duckdb.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `@duckdb/node-api` available to all later tasks; `node tools/run-tests.mjs` as the portable test runner.

- [ ] **Step 1: Write the failing test**

Create `tests/duckdb.test.js`:

```js
/* DuckDB availability and Parquet round-trip. Run: node tests/duckdb.test.js */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();

  const reader = await conn.runAndReadAll('SELECT 42 AS answer');
  const rows = reader.getRowObjects();
  check('duckdb answers a query', Number(rows[0].answer) === 42, JSON.stringify(rows[0]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbb-'));
  const pq = path.join(dir, 'round.parquet').replace(/\\/g, '/');
  await conn.run(
    `COPY (SELECT 1 AS id, 'Ruth' AS name) TO '${pq}' (FORMAT PARQUET)`);
  const back = (await conn.runAndReadAll(
    `SELECT * FROM read_parquet('${pq}')`)).getRowObjects();
  check('parquet round-trips', back.length === 1 && back[0].name === 'Ruth',
    JSON.stringify(back));

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/duckdb.test.js`
Expected: FAIL — `Cannot find package '@duckdb/node-api'`

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "more-bases-ball",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "description": "Baseball rule-change simulator and its data spine.",
  "scripts": {
    "test": "node tools/run-tests.mjs",
    "build:spine": "node tools/build-spine.mjs",
    "build:data": "node tools/build-data.mjs"
  },
  "dependencies": {
    "@duckdb/node-api": "^1.3.0"
  }
}
```

`"type": "commonjs"` is explicit so the existing `.js` files keep loading with `require`. It does not affect `field3d.js`, which the browser loads via `<script type="module">`.

- [ ] **Step 4: Install the dependency**

Run: `npm install`
Expected: `@duckdb/node-api` and its prebuilt binding install; `node_modules/` appears.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/duckdb.test.js`
Expected: both lines `ok`, exit 0.

- [ ] **Step 6: Create the portable test runner**

Create `tools/run-tests.mjs`. The `for t in tests/*.test.js` loop in `AGENTS.md` is a bash idiom that does not run under `npm test` on Windows; this is the equivalent that runs on both.

```js
/* Run every tests/*.test.js in a child process. Portable replacement for
 * `for t in tests/*.test.js; do node $t; done`. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();

let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 7: Add generated data to `.gitignore`**

Replace `.gitignore` with:

```
node_modules/
.DS_Store
data/
```

- [ ] **Step 8: Verify the full suite still passes**

Run: `node tools/run-tests.mjs`
Expected: `13/13 test files passed` — the original twelve plus `duckdb.test.js`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tools/run-tests.mjs tests/duckdb.test.js .gitignore
git commit -m "build: add duckdb dependency and portable test runner"
```

---

### Task 2: Shared fetch library with an on-disk cache

**Files:**
- Create: `tools/lib/fetch.mjs`
- Create: `tests/fetchlib.test.js`
- Modify: `tools/build-data.mjs:29-45` (replace the inline `retry`/`getJson`/`getText`/`pool` with imports), `tools/build-data.mjs:21-27` (add an `--out` flag)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `getJson(url: string): Promise<object>`
  - `getText(url: string): Promise<string>`
  - `pool<T,R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]>`
  - `parseCsv(text: string): Array<Record<string,string>>`
  - `cachePath(url: string): string`

Every later task fetches through this module. The cache matters because the Savant leaderboards and the Chadwick register are re-fetched on every rebuild otherwise, and a full spine build touches hundreds of URLs.

- [ ] **Step 1: Write the failing test**

Create `tests/fetchlib.test.js`:

```js
/* Fetch library: cache behaviour and CSV parsing. Run: node tests/fetchlib.test.js */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbb-cache-'));
  const lib = await import('../tools/lib/fetch.mjs');
  lib.setCacheDir(dir);

  let calls = 0;
  lib.setFetch(async () => {
    calls++;
    return { ok: true, text: async () => 'a,b\n1,2\n' };
  });

  const first = await lib.getText('https://example.test/x.csv');
  const second = await lib.getText('https://example.test/x.csv');
  check('cache returns the same body', first === second, JSON.stringify(first));
  check('cache avoids a second network call', calls === 1, `calls=${calls}`);

  const rows = lib.parseCsv('a,b\n1,"two, comma"\n');
  check('csv parses one row', rows.length === 1, `rows=${rows.length}`);
  check('csv respects quoted commas', rows[0].b === 'two, comma', rows[0].b);

  let order = [];
  await lib.pool([1, 2, 3, 4], 2, async (n) => { order.push(n); return n * 2; });
  check('pool visits every item', order.length === 4, order.join(','));

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/fetchlib.test.js`
Expected: FAIL — `Cannot find module '../tools/lib/fetch.mjs'`

- [ ] **Step 3: Write the implementation**

Create `tools/lib/fetch.mjs`:

```js
/* Shared HTTP helpers for the data builders: retrying fetch, a disk cache so a
 * rebuild does not re-download hundreds of MB, a bounded-concurrency pool, and
 * the CSV parser the Savant leaderboards need. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let CACHE = path.join(ROOT, 'data', '.cache');
let FETCH = globalThis.fetch;

export const setCacheDir = (d) => { CACHE = d; };
export const setFetch = (f) => { FETCH = f; };

export const cachePath = (url) =>
  path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));

const retry = async (url, as, tries = 3) => {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await FETCH(url);
      if (r.ok) return as === 'text' ? r.text() : r.json();
    } catch (e) { /* fall through to the backoff */ }
    await new Promise((res) => setTimeout(res, 400 * (k + 1)));
  }
  throw new Error('failed ' + url);
};

export const getText = async (url) => {
  const p = cachePath(url);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const body = await retry(url, 'text');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return body;
};

export const getJson = async (url) => JSON.parse(await getText(url));

export const pool = async (items, n, fn) => {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
};

export const parseCsv = (txt) => {
  const rows = txt.replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/fetchlib.test.js`
Expected: five `ok` lines, exit 0.

- [ ] **Step 5: Add an `--out` flag to `build-data.mjs` so its output can be diffed**

In `tools/build-data.mjs`, after the `argv` parsing near line 22, add:

```js
const outFlag = process.argv.indexOf('--out');
const OUT = outFlag > -1 ? process.argv[outFlag + 1] : path.join(ROOT, 'data.js');
```

Then change the final write so it targets `OUT` instead of the hardcoded `data.js` path. Also change `.map(Number)` on line 22 so it ignores `--out` and its value:

```js
const argv = process.argv.slice(2)
  .filter((a, i, all) => a !== '--out' && all[i - 1] !== '--out')
  .map(Number).filter(Number.isFinite);
```

- [ ] **Step 6: Capture a byte-identical baseline before touching the helpers**

```bash
node tools/build-data.mjs 2021 2025 --out /tmp/baseline-data.js
```

Run: `node -e "const a=require('fs').readFileSync('/tmp/baseline-data.js'),b=require('fs').readFileSync('data.js');console.log(a.equals(b)?'IDENTICAL':'DIFFERS')"`
Expected: `IDENTICAL`. If it differs, a source changed upstream — stop and investigate before proceeding; do not continue on a moving baseline.

- [ ] **Step 7: Replace the inline helpers with imports**

In `tools/build-data.mjs`, delete the local `retry`, `getJson`, `getText`, `pool`, and `parseCsv` definitions (roughly lines 29–65) and add near the other imports:

```js
import { getJson, getText, pool, parseCsv } from './lib/fetch.mjs';
```

- [ ] **Step 8: Verify the refactor changed nothing**

```bash
node tools/build-data.mjs 2021 2025 --out /tmp/after-data.js
node -e "const fs=require('fs');console.log(fs.readFileSync('/tmp/baseline-data.js').equals(fs.readFileSync('/tmp/after-data.js'))?'IDENTICAL':'DIFFERS')"
```

Expected: `IDENTICAL`.

- [ ] **Step 9: Verify the suite still passes**

Run: `node tools/run-tests.mjs`
Expected: `14/14 test files passed`.

- [ ] **Step 10: Commit**

```bash
git add tools/lib/fetch.mjs tests/fetchlib.test.js tools/build-data.mjs
git commit -m "refactor: extract cached fetch helpers into tools/lib/fetch.mjs"
```

---

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

### Task 4: Player ID crosswalk

**Files:**
- Create: `tools/build-players.mjs`
- Create: `tests/players-data.test.js`

**Interfaces:**
- Consumes: `getText`, `cachePath`; `openDb`, `sqlPath`.
- Produces: `data/players.parquet` with columns
  `mlbam INT, bbref VARCHAR, retro VARCHAR, fangraphs VARCHAR, name VARCHAR, first_year INT, last_year INT`

This is what lets Lahman (keyed on `bbref`) join to Savant (keyed on `mlbam`) without ever matching on names. `tools/build-data.mjs` already treats the MLBAM id as an exact join key and says so in its header comment; this generalises that discipline to the whole player universe.

Source: `https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-{0..9,a..f}.csv` — sixteen hex-sharded files.

- [ ] **Step 1: Write the failing test**

Create `tests/players-data.test.js`:

```js
/* Player crosswalk. Run: node tests/players-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'players.parquet');
if (!fs.existsSync(FILE)) {
  console.log('skip  data/players.parquet not built — run `node tools/build-players.mjs`');
  process.exit(0);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { openDb, sqlPath } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const f = sqlPath(FILE);

  const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${f}')`))[0];
  check('crosswalk covers the MLB universe', Number(n.n) > 20000, `n=${n.n}`);

  // Shohei Ohtani: MLBAM 660271, bbref ohtansh01.
  const ohtani = (await db.all(
    `SELECT bbref, retro, name FROM read_parquet('${f}') WHERE mlbam = 660271`))[0];
  check('mlbam 660271 maps to ohtansh01',
    ohtani && ohtani.bbref === 'ohtansh01', JSON.stringify(ohtani));
  check('and carries a retrosheet id', ohtani && !!ohtani.retro, JSON.stringify(ohtani));

  const dupes = (await db.all(
    `SELECT count(*) AS n FROM (
       SELECT mlbam FROM read_parquet('${f}') GROUP BY mlbam HAVING count(*) > 1)`))[0];
  check('mlbam is unique', Number(dupes.n) === 0, `dupes=${dupes.n}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/players-data.test.js`
Expected: `skip  data/players.parquet not built`, exit 0.

- [ ] **Step 3: Write the implementation**

Create `tools/build-players.mjs`:

```js
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
import { getText, cachePath } from './lib/fetch.mjs';
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
  FROM read_csv_auto([${list}], header = true, union_by_name = true)
  WHERE TRY_CAST(key_mlbam AS INTEGER) IS NOT NULL
    AND mlb_played_first IS NOT NULL
  QUALIFY row_number() OVER (PARTITION BY key_mlbam ORDER BY key_bbref) = 1
) TO '${out}' (FORMAT PARQUET)`);

const n = (await db.all(`SELECT count(*) AS n FROM read_parquet('${out}')`))[0];
console.log(`players.parquet  ${n.n} major-league players`);
await db.close();
```

The `QUALIFY` clause is what makes `mlbam` unique: the register occasionally carries two rows for one MLBAM id, and a duplicate here would silently fan out every downstream join.

- [ ] **Step 4: Run the builder**

Run: `node tools/build-players.mjs`
Expected: `players.parquet  ~23000 major-league players`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/players-data.test.js`
Expected: four `ok` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/build-players.mjs tests/players-data.test.js
git commit -m "feat: build chadwick register id crosswalk parquet"
```

---

### Task 5: Statcast tracking leaderboards, 2015+

**Files:**
- Create: `tools/build-statcast.mjs`
- Create: `tests/statcast-data.test.js`

**Interfaces:**
- Consumes: `getText`, `parseCsv`; `openDb`, `sqlPath`. **Not** `data/players.parquet` — every Savant leaderboard already carries the MLBAM id, so no crosswalk is needed here. The crosswalk is consumed by Task 7, which joins Lahman's `bbref` to it.
- Produces: `data/statcast/{year}.parquet`, one row per player-season, columns
  `year INT, mlbam INT, name VARCHAR, spd DOUBLE, hp1 DOUBLE, xwoba DOUBLE, ev DOUBLE, la DOUBLE, oaa INT, arm DOUBLE, bat_speed DOUBLE, swing_len DOUBLE`

Each leaderboard has its own first year, and that is the point: `spd`/`hp1` from 2015, `oaa` from 2016, `arm` from 2020, `bat_speed`/`swing_len` from 2023. Task 6 reads those first years back off the written data rather than trusting this list.

**Savant changes its leaderboard URLs from time to time.** The builder is therefore table-driven, and each board asserts its expected columns exist — a URL or schema drift fails the build loudly instead of quietly writing a column of nulls. That failure mode is exactly what `tools/build-data.mjs` warns about in its header: a silent fallback to league medians flattens every runner.

- [ ] **Step 1: Write the failing test**

Create `tests/statcast-data.test.js`:

```js
/* Statcast parquet: per-board era boundaries. Run: node tests/statcast-data.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'statcast');
if (!fs.existsSync(DIR)) {
  console.log('skip  data/statcast not built — run `node tools/build-statcast.mjs`');
  process.exit(0);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { openDb, sqlPath } = await import('../tools/lib/duck.mjs');
  const db = await openDb();
  const glob = sqlPath(path.join(DIR, '*.parquet'));

  const first = async (col) => Number((await db.all(
    `SELECT min(year) AS y FROM read_parquet('${glob}') WHERE ${col} IS NOT NULL`))[0].y);

  check('sprint speed starts 2015', await first('spd') === 2015);
  check('outs above average starts 2016', await first('oaa') === 2016);
  check('arm strength starts 2020', await first('arm') === 2020);
  check('bat tracking starts 2023', await first('bat_speed') === 2023);

  const noPre = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE year < 2015`))[0];
  check('nothing claims tracking before 2015', Number(noPre.n) === 0, `n=${noPre.n}`);

  const unmatched = (await db.all(
    `SELECT count(*) AS n FROM read_parquet('${glob}') WHERE mlbam IS NULL`))[0];
  check('every row has an mlbam id', Number(unmatched.n) === 0, `n=${unmatched.n}`);

  await db.close();
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/statcast-data.test.js`
Expected: `skip  data/statcast not built`, exit 0.

- [ ] **Step 3: Write the implementation**

Create `tools/build-statcast.mjs`:

```js
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
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, parseCsv } from './lib/fetch.mjs';
import { openDb, sqlPath } from './lib/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'statcast');
const argv = process.argv.slice(2).map(Number).filter(Number.isFinite);
const FIRST = argv[0] || 2015;
const LAST = argv[1] || 2025;

const BOARDS = [
  { key: 'speed', from: 2015, needs: ['player_id', 'sprint_speed', 'hp_to_1b'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/sprint_speed`
      + `?year=${y}&position=&team=&min=10&csv=true`,
    map: (r) => ({ spd: +r.sprint_speed, hp1: +r.hp_to_1b }) },
  { key: 'xstats', from: 2015, needs: ['player_id', 'est_woba', 'avg_hit_speed'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/expected_statistics`
      + `?type=batter&year=${y}&position=&team=&min=50&csv=true`,
    map: (r) => ({ xwoba: +r.est_woba, ev: +r.avg_hit_speed, la: +r.avg_launch_angle }) },
  { key: 'oaa', from: 2016, needs: ['player_id', 'outs_above_average'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/outs_above_average`
      + `?type=Fielder&startYear=${y}&endYear=${y}&min=1&csv=true`,
    map: (r) => ({ oaa: Math.round(+r.outs_above_average) }) },
  { key: 'arm', from: 2020, needs: ['player_id', 'arm_overall'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/arm-strength`
      + `?type=player&year=${y}&minThrows=10&csv=true`,
    map: (r) => ({ arm: +r.arm_overall }) },
  { key: 'bat', from: 2023, needs: ['id', 'avg_bat_speed', 'avg_swing_length'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/bat-tracking`
      + `?year=${y}&type=batter&min=50&csv=true`,
    map: (r) => ({ bat_speed: +r.avg_bat_speed, swing_len: +r.avg_swing_length }) },
];

const idOf = (r) => +(r.player_id ?? r.id);
const num = (v) => (Number.isFinite(v) ? v : null);

fs.mkdirSync(OUT, { recursive: true });
const db = await openDb();

for (let year = FIRST; year <= LAST; year++) {
  const players = new Map();
  const seen = [];

  for (const b of BOARDS) {
    if (year < b.from) continue;
    const rows = parseCsv(await getText(b.url(year)));
    if (!rows.length) { console.log(`  ${year} ${b.key}: EMPTY`); continue; }
    const missing = b.needs.filter((c) => !(c in rows[0]));
    if (missing.length) {
      throw new Error(
        `${b.key} ${year}: leaderboard schema drifted, missing ${missing.join(',')}. `
        + `Got: ${Object.keys(rows[0]).slice(0, 12).join(',')}`);
    }
    for (const r of rows) {
      const id = idOf(r);
      if (!Number.isFinite(id)) continue;
      const cur = players.get(id) || { mlbam: id, name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() };
      for (const [k, v] of Object.entries(b.map(r))) cur[k] = num(v);
      players.set(id, cur);
    }
    seen.push(`${b.key}:${rows.length}`);
  }

  const cols = ['mlbam', 'name', 'spd', 'hp1', 'xwoba', 'ev', 'la',
    'oaa', 'arm', 'bat_speed', 'swing_len'];
  const values = [...players.values()].map((p) => '('
    + `${year}, ${p.mlbam}, ` + JSON.stringify(p.name ?? '')
    + ', ' + cols.slice(2).map((c) => (p[c] == null ? 'NULL' : p[c])).join(', ')
    + ')').join(',\n');

  if (!values) { console.log(`${year}  no rows`); continue; }

  const file = sqlPath(path.join(OUT, `${year}.parquet`));
  await db.run(`COPY (SELECT * FROM (VALUES\n${values}\n)
    AS t(year, ${cols.join(', ')})) TO '${file}' (FORMAT PARQUET)`);
  console.log(`${year}  players ${players.size}  ${seen.join('  ')}`);
}

await db.close();
```

- [ ] **Step 4: Run the builder**

Run: `node tools/build-statcast.mjs`
Expected: one line per year from 2015, each naming the boards that returned rows, with 2015 showing `speed` and `xstats` only and 2023+ showing all five. If it throws a "schema drifted" error, open the URL in a browser, read the new column names, and update that board's `needs` and `map` — that is the failure working as designed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/statcast-data.test.js`
Expected: six `ok` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/build-statcast.mjs tests/statcast-data.test.js
git commit -m "feat: build statcast tracking parquet 2015+ with schema-drift guards"
```

---

### Task 6: Generated coverage manifest

**Files:**
- Create: `tools/build-coverage.mjs`
- Create: `tests/coverage.test.js`

**Interfaces:**
- Consumes: `openDb`, `sqlPath`; all Parquet written by Tasks 3–5.
- Produces: `data/coverage.json`:

```json
{
  "generatedAt": "2026-09-15T00:00:00.000Z",
  "stats": {
    "season_batting": { "first": 1871, "last": 2025, "rows": 112000,
      "source": "Chadwick baseballdatabank", "grain": "player-season" },
    "sprint_speed":   { "first": 2015, "last": 2025, "rows": 6100,
      "source": "Baseball Savant", "grain": "player-season" }
  }
}
```

Per the spec this is not a display artifact. Intake reads it to reject a rule whose data does not exist for the era the fan asked about — **before** payment. So it must be measured from the written Parquet, never from a hand-maintained list, or the guard drifts away from the data it guards.

- [ ] **Step 1: Write the failing test**

Create `tests/coverage.test.js`:

```js
/* coverage.json is measured, not declared. Run: node tests/coverage.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'coverage.json');
if (!fs.existsSync(FILE)) {
  console.log('skip  data/coverage.json not built — run `node tools/build-coverage.mjs`');
  process.exit(0);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const cov = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const s = cov.stats;

check('season batting reaches 1871', s.season_batting.first === 1871,
  String(s.season_batting.first));
check('season pitching reaches 1871', s.season_pitching.first === 1871,
  String(s.season_pitching.first));
check('sprint speed starts 2015', s.sprint_speed.first === 2015,
  String(s.sprint_speed.first));
check('bat tracking starts 2023', s.bat_tracking.first === 2023,
  String(s.bat_tracking.first));
check('every stat carries a source', Object.values(s).every((v) => !!v.source));
check('every stat carries a non-zero row count',
  Object.values(s).every((v) => v.rows > 0));

// The guard the product depends on: no stat may claim a year it has no rows for.
check('first is never after last',
  Object.values(s).every((v) => v.first <= v.last));

// The builder must not have hardcoded the years it reports.
const src = fs.readFileSync(path.join(ROOT, 'tools', 'build-coverage.mjs'), 'utf8');
check('builder does not hardcode 2015', !/first:\s*2015/.test(src));

process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/coverage.test.js`
Expected: `skip  data/coverage.json not built`, exit 0.

- [ ] **Step 3: Write the implementation**

Create `tools/build-coverage.mjs`:

```js
/* moreBasesBall — build data/coverage.json
 *
 *   node tools/build-coverage.mjs
 *
 * How far back each statistic actually goes, MEASURED from the parquet on disk.
 * Intake reads this to reject a rule the data cannot support — before the fan
 * is charged — and every results page renders it. A hardcoded table would drift
 * away from the data it is supposed to guard, so every number here is a query.
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
    source: 'Baseball Savant', grain: 'player-season' },
  { key: 'home_to_first', src: STATCAST, where: 'hp1 IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season' },
  { key: 'batted_ball_tracking', src: STATCAST, where: 'ev IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season' },
  { key: 'outs_above_average', src: STATCAST, where: 'oaa IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season' },
  { key: 'arm_strength', src: STATCAST, where: 'arm IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season' },
  { key: 'bat_tracking', src: STATCAST, where: 'bat_speed IS NOT NULL',
    source: 'Baseball Savant', grain: 'player-season' },
];

const db = await openDb();
const stats = {};

for (const p of PROBES) {
  const r = (await db.all(
    `SELECT min(year) AS first, max(year) AS last, count(*) AS rows
       FROM read_parquet('${p.src}') WHERE ${p.where}`))[0];
  if (r.first == null) {
    console.log(`WARN  ${p.key}: no rows matched — omitted from coverage`);
    continue;
  }
  stats[p.key] = {
    first: Number(r.first), last: Number(r.last), rows: Number(r.rows),
    source: p.source, grain: p.grain,
  };
}

const out = { generatedAt: new Date().toISOString(), stats };
fs.writeFileSync(path.join(DATA, 'coverage.json'), JSON.stringify(out, null, 2) + '\n');

for (const [k, v] of Object.entries(stats)) {
  console.log(`${k.padEnd(22)} ${v.first}–${v.last}  ${v.rows} rows`);
}
await db.close();
```

- [ ] **Step 4: Run the builder**

Run: `node tools/build-coverage.mjs`
Expected: eleven aligned lines. `season_batting 1871–2025`, `sprint_speed 2015–2025`, `bat_tracking 2023–2025`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/coverage.test.js`
Expected: eight `ok` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/build-coverage.mjs tests/coverage.test.js
git commit -m "feat: generate coverage.json measured from the written parquet"
```

---

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

### Task 8: Orchestrator and documentation

**Files:**
- Create: `tools/build-spine.mjs`
- Modify: `AGENTS.md` (append a "Data spine" section)
- Modify: `README.md` (append a "Data spine" section under the existing `## Files` heading)

**Interfaces:**
- Consumes: every builder from Tasks 3–6.
- Produces: `node tools/build-spine.mjs` as the one command that builds the whole lake in dependency order.

- [ ] **Step 1: Write the orchestrator**

Create `tools/build-spine.mjs`:

```js
/* moreBasesBall — build the whole data spine.
 *
 *   node tools/build-spine.mjs
 *
 * Order matters only at the end: coverage.json is measured from everything else,
 * so it runs last. The first three are independent — statcast does NOT join
 * through players.parquet, because every Savant leaderboard already carries the
 * MLBAM id. The crosswalk is consumed by the query layer, not by the builders.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPS = ['build-players.mjs', 'build-seasons.mjs',
  'build-statcast.mjs', 'build-coverage.mjs'];

for (const s of STEPS) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [path.join(HERE, s)], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nbuild-spine: ${s} failed with status ${r.status}`);
    process.exit(r.status || 1);
  }
}
console.log('\nspine built — run `node tools/run-tests.mjs` to verify');
```

- [ ] **Step 2: Verify the orchestrator on a clean lake**

```bash
rm -rf data/seasons data/statcast data/players.parquet data/coverage.json
node tools/build-spine.mjs
```

Expected: four sections run in order and the final line prints. The HTTP cache under `data/.cache` survives, so this is fast; delete that too for a true cold run.

- [ ] **Step 3: Verify the whole suite against the rebuilt lake**

Run: `node tools/run-tests.mjs`
Expected: `19/19 test files passed`, including the original twelve.

- [ ] **Step 4: Document it in `AGENTS.md`**

Append:

```markdown
## Data spine

`data.js` is the small, committed slice the browser sim loads: nine batters per
club, 2021–2025, no pitchers. The **spine** under `data/` is the full
population the service simulates against — every player 1871+, both roles, plus
Statcast tracking from 2015. It is generated and gitignored.

- Build it: `node tools/build-spine.mjs`. Builders run in dependency order and
  share an HTTP cache at `data/.cache`, so a rebuild is cheap.
- Query it through `tools/lib/spine.mjs` only. Nothing else reads parquet —
  that is what keeps the storage layout swappable.
- `data/coverage.json` is **measured** from the written parquet, never
  hardcoded. Intake calls `requireCoverage()` with it to reject a rule the data
  cannot support before the fan is charged. A hardcoded table would drift away
  from the data it guards; `tests/coverage.test.js` asserts the builder does not
  hardcode years.
- Lahman team codes are not the modern abbreviations — the Dodgers are `LAN`,
  the Yankees `NYA`. `data.js` uses `LAD`/`NYY`. Do not conflate them.
- Savant rewrites its leaderboard URLs. `build-statcast.mjs` declares the
  columns each board must return and throws on drift, rather than writing a
  column of nulls — the same failure mode `build-data.mjs` warns about with
  median-filled sprint speeds.
- Spine tests skip cleanly when `data/` is absent, so a fresh clone with no
  network still shows the original twelve green.
```

- [ ] **Step 5: Document it in `README.md`**

Append a matching section under `## Files` describing `data/` layout, the one build command, and the coverage table's role on results pages.

- [ ] **Step 6: Commit**

```bash
git add tools/build-spine.mjs AGENTS.md README.md
git commit -m "feat: add spine orchestrator and document the data lake"
```

---

## What this plan does not cover

- **Tier B, Retrosheet event-level plate appearances 1912+.** A play-string
  parser (`64(1)3/GDP`, `S8/L.2-H`) is a separate subsystem from table
  reshaping, and the usual tool for it is a C binary that breaks the
  Windows→Linux constraint. Plan 1b.
- **Tier C pitch-level Statcast.** This plan lands the per-season *leaderboard*
  rates, not the per-pitch rows.
- **Regenerating `data.js` from the spine.** Deliberate: `data.js` must stay
  byte-identical through this work. Swapping its generator over is a task in
  sub-project 2, gated by the golden-run identity test.
