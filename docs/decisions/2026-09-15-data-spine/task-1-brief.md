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

