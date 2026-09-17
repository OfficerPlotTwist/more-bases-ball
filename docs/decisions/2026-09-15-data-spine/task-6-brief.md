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

