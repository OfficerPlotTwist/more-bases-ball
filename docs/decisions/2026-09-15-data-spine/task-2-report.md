# Task 2 report — shared fetch library with an on-disk cache

## Files changed

- **Created** `tools/lib/fetch.mjs` — new module. Exports `setCacheDir`, `setFetch`,
  `cachePath`, `getText`, `getJson`, `pool`, `parseCsv`. Verbatim implementation
  from the brief's Step 3 (sha1-hashed cache file per URL under `data/.cache`,
  3-try retry with linear backoff, bounded-concurrency `pool`, quote-aware CSV
  parser).
- **Created** `tests/fetchlib.test.js` — verbatim from the brief's Step 1. CommonJS
  test that `await import()`s the ESM module, injects a fake `fetch` via
  `setFetch`, points the cache at a temp dir via `setCacheDir`, and checks: cache
  hits return identical body without a second network call, CSV parsing
  (including a quoted comma), and that `pool` visits every item.
- **Modified** `tools/build-data.mjs`:
  - Added an `--out <path>` flag (parsed before the year-args mapping so it and
    its value are filtered out of the `Number`-mapped argv) defaulting to
    `path.join(ROOT, 'data.js')`, stored as `OUT`.
  - Added `import { getJson, getText, pool, parseCsv } from './lib/fetch.mjs';`
    next to the existing imports.
  - Deleted the inline `retry`, `getJson`, `getText`, `pool`, `parseCsv`
    definitions (previously lines ~28-65).
  - Changed the final `fs.writeFileSync(path.join(ROOT, 'data.js'), out)` to
    `fs.writeFileSync(OUT, out)`.

No other files were touched. `data.js` and the other files with pre-existing
uncommitted user changes (README.md, editor.js, field3d.js, fielders.js,
graphsim.js, index.html, layout.js, style.css, tests/anim.test.js, trisim.js,
ui.js) and the untracked tests/batters.test.js and tests/multiplate.test.js
were left exactly as found — never staged, never written to.

## Commands run, in order, with results

1. `node tests/fetchlib.test.js` (before creating `fetch.mjs`)
   → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../tools/lib/fetch.mjs'`,
   exit 1. Matches the brief's expected failure.

2. Created `tools/lib/fetch.mjs`, then `node tests/fetchlib.test.js`
   → 5 `ok` lines, exit 0.

3. Added the `--out` flag and `OUT`-targeted write to `tools/build-data.mjs`
   (helpers still inline at this point — pre-refactor).

4. **Step 6 — baseline capture** (before deleting the inline helpers):
   ```
   node tools/build-data.mjs 2021 2025 --out <scratchpad>/baseline-data.js
   ```
   Output: `2021..2025  clubs 30  sprint matched 270  median-filled 0` for each
   year, `wrote data.js  121KB  5 seasons  150 lineups`. Ran clean against live
   statsapi.mlb.com / baseballsavant.mlb.com, no network errors.

   Comparison vs the committed-but-dirty `data.js` in the working tree:
   ```
   node -e "...a.equals(b)?'IDENTICAL':'DIFFERS'..."
   ```
   **Result: IDENTICAL.** Per the controller's ruling this was a sanity probe,
   not a gate — but it came back identical anyway, so there was no upstream
   drift to characterize and no need to inspect a diff.

5. **Step 7 — refactor**: replaced the inline helpers in `build-data.mjs` with
   the `./lib/fetch.mjs` import (deletion + one import line, shown above).

6. **Step 8 — warm-cache comparison** (cache from step 4 still on disk):
   ```
   node tools/build-data.mjs 2021 2025 --out <scratchpad>/after-warm-data.js
   ```
   Completed in ~2.8s wall time (`time` output: `real 0m2.768s`), confirming it
   read from cache rather than the network. Same per-year log lines and byte
   count (121KB, 5 seasons, 150 lineups).
   ```
   node -e "...baseline-data.js vs after-warm-data.js..."
   ```
   **Result: IDENTICAL.**

7. **Cold-cache comparison** (per the controller's instruction, since the warm
   run proves nothing about the network path):
   ```
   rm -rf data/.cache   # was 160 files, 17M
   node tools/build-data.mjs 2021 2025 --out <scratchpad>/after-cold-data.js
   ```
   Took `real 0m2.833s` — essentially the same wall time as the warm run,
   which is plausible given the pooled concurrency and the small size of each
   individual statsapi/Savant response; `data/.cache` was repopulated to the
   same 160 files / 17M afterward, confirming the network path was actually
   exercised (not silently skipped).
   ```
   node -e "...baseline-data.js vs after-cold-data.js..."
   ```
   **Result: IDENTICAL.**

8. **Step 9 — full suite**:
   ```
   node tools/run-tests.mjs
   ```
   **Result: `14/14 test files passed`.** (Baseline before this task, run once
   at the very start for reference, was `13/13 test files passed` — the new
   14th file is `tests/fetchlib.test.js`.) All checks in every file passed,
   including `defense-stress.test.js`, `anim.test.js`, and the two untracked
   user test files (`batters.test.js`, `multiplate.test.js`), which ran as part
   of the suite even though they aren't part of this task's diff.

9. **Step 10 — commit**:
   ```
   git add tools/lib/fetch.mjs tests/fetchlib.test.js tools/build-data.mjs
   git commit -m "refactor: extract cached fetch helpers into tools/lib/fetch.mjs" ...
   ```
   Commit: `ec1f7bb`. `git status --short` afterward confirmed only the
   pre-existing user-dirty files remain modified/untracked; nothing extra was
   staged or committed.

## Byte-identity summary

| Comparison | Result |
|---|---|
| Step 6 baseline vs committed working-tree `data.js` | IDENTICAL |
| Step 6 baseline vs Step 8 warm-cache rerun | IDENTICAL |
| Step 6 baseline vs Step 8 cold-cache (`data/.cache` deleted) rerun | IDENTICAL |

## Things I was unsure about

- The cold-cache run finishing in ~2.8s, about the same as the warm run,
  initially looked like it might mean the cache silently survived the
  `rm -rf`. I checked: `data/.cache` had 0 files immediately after the delete
  and was back to 160 files / 17M immediately after the run, so the network
  path was genuinely exercised — the API responses here are just small and the
  concurrency pool makes even ~270-webrequest-per-year workloads fast on a
  decent connection. Noting it here since the brief's own comment ("a full
  2021-2025 run takes several minutes") suggested I should expect much
  longer; it did not turn out that way for me. Flagging in case that
  discrepancy is worth a second look, though the byte-identity result stands
  regardless of wall time.
- `tools/build-data.mjs` was listed as untracked (`??`) in the original git
  status, not modified (`M`) — so `git add` for it staged it as a new file
  (matching the plan's Task 1 having presumably left it untracked). This
  matched the brief's explicit instruction to `git add` exactly that path, so
  I did not treat it as an anomaly, just noting it since it differs from the
  "existing working code" framing in the task description.

## Fix round 1 — cache poisoning and cache invalidation

Two Important review findings against `tools/lib/fetch.mjs`, both defects in
the plan's own mandated code (not deviations introduced by this task). Fixed
per the coordinator's explicit rulings, which overrode the brief text.

### Finding 1 — cache poisoning on malformed JSON

`getText` wrote the raw response body to disk before any caller validated it.
`getJson` was `JSON.parse(await getText(url))`, so a bad body (rate-limit HTML,
truncated JSON) got cached permanently — `fs.existsSync` short-circuited
`retry` on every later run, and only a manual `rm data/.cache/<hash>` would
recover.

**Fix applied** (smallest change, per ruling): `getText` now takes an optional
`validate` callback that runs on the freshly-fetched body *before* the cache
write; `getJson` passes `JSON.parse` as that validator.

```js
export const getText = async (url, validate) => {
  const p = cachePath(url);
  if (process.env.MBB_CACHE_REFRESH !== '1' && fs.existsSync(p)) {
    hits++;
    return fs.readFileSync(p, 'utf8');
  }
  misses++;
  const body = await retry(url, 'text');
  if (validate) validate(body);   // throws BEFORE anything reaches the cache
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return body;
};

export const getJson = async (url) => JSON.parse(await getText(url, JSON.parse));
```

All existing single-argument `getText(url)` call sites are unaffected —
`validate` is optional.

### Finding 2 — no cache invalidation / no staleness signal

`cachePath` was a bare sha1 of the URL with no TTL, version, or metadata, so a
rebuild months later could silently serve stale MLB-revised season lines with
no way to tell.

**Fix applied** (per ruling — no TTL; an explicit escape hatch plus
observability instead):

- `MBB_CACHE_REFRESH=1`, read via `process.env` inside `getText` on every call
  (not captured once at module load), makes the cache-hit branch fall through
  to a refetch and overwrite. This lets a test (or a future builder) toggle it
  at runtime.
- Module-scope `hits`/`misses` counters, exported as `cacheStats()` returning
  `{ hits, misses }` and `resetCacheStats()`. No builder was changed to use
  these in this task, per the ruling — only the functions were added.

### Tests added to `tests/fetchlib.test.js`

Appended to the existing five checks, in the same `check(label, ok, detail)`
style, using fresh URLs (`bad.json`, `refresh.csv`, `stats.csv`) so they don't
collide with the first block's cached `x.csv` entry:

1. **Malformed body is not cached, and a later valid fetch recovers.** Set the
   injected fetch to return `<html>rate limited</html>`; call `getJson` and
   assert it throws; assert `fs.existsSync(lib.cachePath(badUrl))` is `false`;
   then swap the injected fetch to return valid JSON and assert the second
   `getJson` call succeeds and returns the parsed body.
2. **`MBB_CACHE_REFRESH=1` forces a refetch.** Prime the cache with one body
   ("first"), set the env var, change the injected fetch to return a different
   body ("second"), call `getText` again, assert the fetch mock was invoked a
   second time and the new body was returned; `delete process.env
   .MBB_CACHE_REFRESH` immediately after so it can't leak into later checks.
3. **`cacheStats()` reports a miss then a hit.** `resetCacheStats()`, fetch
   once (miss=1, hits=0), fetch the same URL again (hits=1, misses=1).

### Commands run and output

```
node tests/fetchlib.test.js
```
Output: 13 `ok` lines (the original 5 plus 8 new), exit 0:
```
ok    cache returns the same body — "a,b\n1,2\n"
ok    cache avoids a second network call — calls=1
ok    csv parses one row — rows=1
ok    csv respects quoted commas — two, comma
ok    pool visits every item — 1,2,3,4
ok    malformed json throws
ok    malformed body is not cached
ok    a later valid response recovers — {"ok":true}
ok    refresh: initial fetch populates cache — first
ok    MBB_CACHE_REFRESH forces a second network call — refreshCalls=2
ok    MBB_CACHE_REFRESH returns the new body — second
ok    cacheStats records a miss — {"hits":0,"misses":1}
ok    cacheStats records a hit — {"hits":1,"misses":1}
```

```
node tools/run-tests.mjs
```
Output (tail): `14/14 test files passed`.

```
node tools/build-data.mjs 2021 2025 --out <scratchpad>/after-fix-data.js
node -e "...after-warm-data.js vs after-fix-data.js..."
```
Output: same per-year log lines (`clubs 30  sprint matched 270  median-filled 0`
for each of 2021-2025), `wrote data.js  121KB  5 seasons  150 lineups`, and the
comparison against the original Step 8 warm-cache artifact (`after-warm-data.js`)
printed **`IDENTICAL`**.

### Commit

```
git add tools/lib/fetch.mjs tests/fetchlib.test.js
git commit -m "fix: prevent cache poisoning and add refresh escape hatch + cache stats" ...
```
Commit: `9d8acf1`. `git status --short` before and after showed only the
pre-existing user-dirty files (README.md, data.js, editor.js, field3d.js,
fielders.js, graphsim.js, index.html, layout.js, style.css,
tests/anim.test.js, trisim.js, ui.js) and untracked
tests/batters.test.js / tests/multiplate.test.js — none of them staged or
modified by this fix round.

### Uncertainties in this round

- None outstanding. The wall-clock-timing observation from the original round
  (cold-cache run finishing in ~3s rather than "several minutes") still
  applies here since the fix round's build-data.mjs run went through the same
  path; not re-flagging it as new since it was already noted above.
