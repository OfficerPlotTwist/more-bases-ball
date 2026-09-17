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

