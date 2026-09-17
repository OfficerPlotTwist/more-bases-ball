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

