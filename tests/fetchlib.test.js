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
