# Task 3 report — season lines for every player, 1871+

Status: **BLOCKED** on an external resource, not on code. See "Blocker" below.

## Files created

- `tools/lib/duck.mjs` — written verbatim from the brief's Step 3. `openDb(file?)`
  wraps `DuckDBInstance.create` / `connect` and exposes `{ conn, all, run, close }`;
  `sqlPath()` normalises backslashes for SQL string literals.
- `tests/seasons-data.test.js` — written from the brief's Step 1, with one
  deliberate deviation (see "SQL/test adjustments" below): the Pedro Martinez
  query includes `AND ipouts > 600` from the start, since the brief itself warns
  two Pedro Martinezes pitched in MLB and names this exact fix. I applied it
  pre-emptively instead of waiting for a failing run, since I could not
  actually exercise the query against real data (see blocker) to find out
  empirically. Expected values (`p_so === 284`, `ipouts === 651`) are unchanged
  from the brief.
- `tools/build-seasons.mjs` — written from the brief's Step 4, with two changes:
  1. Added the cache-usage line per the additional requirement: imported
     `cacheStats` alongside `getText`/`cachePath` from `tools/lib/fetch.mjs`,
     and added `const cs = cacheStats(); console.log(\`cache  ${cs.hits} hits  ${cs.misses} fetched\`);`
     right after the existing summary lines, before `db.close()`.
  2. **SQL type-mismatch fix in the `seasons` view's `UNION ALL`** (see next
     section for why).

## SQL adjustment — HUGEINT/BIGINT mismatch

The brief's draft `seasons` view unions a batting branch and a pitching branch.
In the batting branch, `b.pa, b.ab, b.h, ...` are real `sum()` results (DuckDB
types these as `HUGEINT`), while the placeholder columns for the *other* role's
stats — `ipouts, er, bf, p_h, p_bb, p_so, p_hr` — were typed `NULL::BIGINT`. In
the pitching branch, the *actual* values for those same columns
(`q.ipouts, q.er, q.bf, q.p_h, q.p_bb, q.p_so, q.p_hr`) are themselves `sum()`
results, i.e. `HUGEINT`. That's a `BIGINT` vs `HUGEINT` mismatch on the same
UNION ALL column position, which DuckDB rejects.

The batting branch's `pa/ab/h/d2/d3/hr/bb/so/sb/cs/hbp` placeholders were
already typed `NULL::HUGEINT` in the pitching branch, so those columns were
already consistent — only the seven pitching-stat placeholder columns in the
batting branch needed to change from `NULL::BIGINT` to `NULL::HUGEINT`. I made
that one change and left the query structure otherwise untouched, per the
brief's instruction to prefer consistent casts over restructuring.

This is verified only by static reading of DuckDB's typing rules for `sum()`
— I could not execute the query end-to-end because the CSV inputs are
unreachable (see blocker below). I flag this so the next person who can reach
the network verifies it actually runs; the fix is minimal and directly
addresses the stated failure mode, but it is untested against a live DuckDB.

## Blocker — source URL is dead: `chadwickbureau/baseballdatabank` has been taken down

Running `node tools/build-seasons.mjs` fails immediately:

```
Error: failed https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core/People.csv
    at retry (tools/lib/fetch.mjs:27:9)
    ...
```

I verified this is not a transient network blip or sandbox restriction — other
hosts (api.github.com, raw.githubusercontent.com for other repos) are
reachable fine from this environment. Specifically:

- `curl -I https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core/People.csv`
  → `HTTP/1.1 404 Not Found` (genuine GitHub 404, not a redirect, not rate limiting).
- `curl https://api.github.com/repos/chadwickbureau/baseballdatabank` → `404 Not Found`.
- `curl https://api.github.com/orgs/chadwickbureau/repos?type=all` lists the
  org's current 6 public repos: `chadwick`, `retrosheet`, `register`,
  `retrosplits`, `data-boxscores`, `chadwickbureau.github.io`. There is no
  `baseballdatabank` repo under this org anymore — not renamed, not archived,
  just gone.
- A web search corroborates this independently: search results state
  "The Baseball Databank is no longer available. If you were using this data
  and would like help in hosting something similar, [get in touch]" — i.e.
  this is a real, recent discontinuation of the canonical hosting, not a
  local/environment problem.

I looked for a live substitute rather than stopping at the first dead end:

| Candidate | Result |
|---|---|
| `orrski/baseballdatabank` | Old 2014-era snapshot — uses `Master.csv` (pre-2016 schema), not `People.csv`; no confirmed recent seasons. |
| `cbwinslow/baseballdatabank` | Has `People.csv` in the expected schema, but `pushed_at: 2022-10-31` — last Batting.csv row I could infer would stop well short of "2024 or later," which `tests/seasons-data.test.js` requires (`hi >= 2024`). |
| `xorq-labs/baseballdatabank` | Explicitly described as "Mirror of the Baseball Databank... Used by xorq tutorials," pushed 2026-05-14 (recent), correct schema (`People.csv` present). But `core/Batting.csv` I fetched ends at **2021** — three seasons short of the test's `hi >= 2024` requirement. |

None of the three forks I found satisfy the brief's own coverage requirement
(current through at least 2024). Picking one anyway would mean either (a)
silently shipping a data spine that fails Step 6's own coverage assertion, or
(b) quietly relaxing that assertion — both are decisions about the
foundational dataset four later tasks read, which I don't think is mine to
make unilaterally. This is a genuine "new external dependency /
provenance trade-off" call, not a discoverable rename I can just fix and
move on from.

## What did NOT run, and why

- `node tools/build-seasons.mjs` — fails at the CSV download step above.
  No `data/seasons/`, no `data/league/` were created. Nothing under `data/`
  was written (the dir doesn't even get created before the failed
  `Promise.all`, since `localise()` throws first).
- `node tests/seasons-data.test.js` — I ran this once before attempting the
  build, to confirm Step 2's skip guard:
  ```
  skip  data/seasons not built — run `node tools/build-seasons.mjs`
  exit=0
  ```
  This is the only run possible without the builder succeeding, and it is
  the correct pre-build state per the brief.
- `node tools/run-tests.mjs` — run after adding `seasons-data.test.js`:
  reports **15/15 test files passed**. This is the "no network" green suite
  (`seasons-data.test.js` self-skips cleanly since `data/seasons` doesn't
  exist), not the "seven ok lines" pass the brief's Step 6/7 describe for a
  successful build — that state is unreachable until the blocker is resolved.
- No row counts for `bat`/`pit`, no year span, no `cache` line exist because
  the builder never got far enough to print them.
- **No commit was made.** Per the brief's Step 8 and the task instructions,
  a commit implies a working, tested build. Since the pipeline cannot
  currently produce `data/seasons` or `data/league` at all, I left the
  working tree with the three new/modified files unstaged and did not
  `git add` or `git commit` anything.

## Files as written (ready to run once a source is confirmed)

- `C:\Users\nik\Documents\AI\more-bases-ball\tools\lib\duck.mjs`
- `C:\Users\nik\Documents\AI\more-bases-ball\tools\build-seasons.mjs`
- `C:\Users\nik\Documents\AI\more-bases-ball\tests\seasons-data.test.js`

All three are believed correct against the brief's spec (modulo the one
untested HUGEINT/BIGINT cast fix above) and should run to completion as soon
as a reachable, current (through 2024+) source for `Batting.csv`, `Pitching.csv`,
`People.csv`, and `Teams.csv` in Lahman/baseballdatabank schema is confirmed —
whether that's a resurrected `chadwickbureau/baseballdatabank`, an official
successor repo, or an explicitly-approved mirror/pin (e.g. a tagged release
or a Kaggle/Zenodo archive) with a date range that actually reaches 2024+.

## Things I'm unsure about

1. Whether `chadwickbureau/baseballdatabank` is truly gone permanently or
   temporarily unpublished — I found no announcement with a firm date or
   reason, only a secondary reference saying it's "no longer available."
   It's possible it comes back.
2. Whether the HUGEINT cast fix is sufficient — I could not run it against
   real CSVs. If DuckDB's `sum()` typing differs from what I assumed (e.g.
   varies based on input column width), the UNION ALL might still need
   another adjustment once real data flows through it.
3. Whether relaxing the test's `hi >= 2024` bound (e.g. to accept a stale
   mirror) is an acceptable stopgap — I did not do this, since the brief
   states this bound deliberately and downstream tasks likely assume recent
   coverage.
