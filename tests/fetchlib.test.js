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

  // A malformed body must not be written to the cache: it should refetch every
  // time until a valid response arrives, never poison the disk with garbage.
  const badUrl = 'https://example.test/bad.json';
  lib.setFetch(async () => ({ ok: true, text: async () => '<html>rate limited</html>' }));
  let threw = false;
  try { await lib.getJson(badUrl); } catch (e) { threw = true; }
  check('malformed json throws', threw);
  check('malformed body is not cached', !fs.existsSync(lib.cachePath(badUrl)));

  lib.setFetch(async () => ({ ok: true, text: async () => '{"ok":true}' }));
  const recovered = await lib.getJson(badUrl);
  check('a later valid response recovers', recovered && recovered.ok === true, JSON.stringify(recovered));

  // MBB_CACHE_REFRESH=1 must force a refetch even though a cache entry exists.
  const refreshUrl = 'https://example.test/refresh.csv';
  let refreshCalls = 0;
  lib.setFetch(async () => { refreshCalls++; return { ok: true, text: async () => 'first' }; });
  const before = await lib.getText(refreshUrl);
  check('refresh: initial fetch populates cache', before === 'first', before);

  lib.setFetch(async () => { refreshCalls++; return { ok: true, text: async () => 'second' }; });
  process.env.MBB_CACHE_REFRESH = '1';
  const after = await lib.getText(refreshUrl);
  delete process.env.MBB_CACHE_REFRESH;
  check('MBB_CACHE_REFRESH forces a second network call', refreshCalls === 2, `refreshCalls=${refreshCalls}`);
  check('MBB_CACHE_REFRESH returns the new body', after === 'second', after);

  // cacheStats() reports a miss then a hit for the same URL.
  const statsUrl = 'https://example.test/stats.csv';
  lib.setFetch(async () => ({ ok: true, text: async () => 'stats-body' }));
  lib.resetCacheStats();
  await lib.getText(statsUrl);
  const afterMiss = lib.cacheStats();
  check('cacheStats records a miss', afterMiss.misses === 1 && afterMiss.hits === 0, JSON.stringify(afterMiss));
  await lib.getText(statsUrl);
  const afterHit = lib.cacheStats();
  check('cacheStats records a hit', afterHit.hits === 1 && afterHit.misses === 1, JSON.stringify(afterHit));

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
