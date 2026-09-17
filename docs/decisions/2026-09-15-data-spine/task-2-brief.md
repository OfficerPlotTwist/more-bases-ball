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

