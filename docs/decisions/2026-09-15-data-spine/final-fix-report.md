# Final fix wave — one commit, seven findings

Branch `data-spine`. All work landed in a single commit. The working tree's
unrelated user changes (data.js, editor.js, field3d.js, fielders.js,
graphsim.js, index.html, layout.js, style.css, tests/anim.test.js, trisim.js,
ui.js, onlyprompts.json, tests/batters.test.js, tests/multiplate.test.js) were
not staged, reverted or modified.

## Finding 1 — the failures-less manifest guard on the second gate

`tools/build-coverage.mjs`: `manifest.failures.length` becomes
`(manifest.failures || []).length`, matching the guard already in
`tools/lib/spine.mjs`.

To make the gate testable without touching the repo's own `data/`, the builder
now reads its data directory from `MBB_DATA_DIR` when that variable is set,
falling back to `<repo>/data`. The override exists only so the refusal path can
be exercised against a synthetic manifest in a temp dir.

Regression added to `tests/coverage.test.js`, following the temp-dir pattern in
`tests/spine-query.test.js`. It spawns the builder with `MBB_DATA_DIR` pointing
at a temp dir holding `{"complete": false}` and asserts all three of: non-zero
exit, the refusal wording present in stderr, and no `TypeError` in stderr. The
test block was moved above the `data/coverage.json` skip gate so it runs on a
fresh clone with no data; that skip now exits `failures ? 1 : 0` rather than a
flat `0`.

Output:

    ok    build-coverage exits non-zero on complete:false with no failures key — status=1
    ok    build-coverage prints its refusal, not a TypeError — build-coverage: data/_build.json reports complete=false (0 failures). Refusing to measure coverage against a partial spine — fix the build first.
    ok    refusal reports 0 failures rather than crashing on the missing key — build-coverage: data/_build.json reports complete=false (0 failures). Refusing to measure coverage against a partial spine — fix the build first.

## Finding 3 — coverage.json vs the manifest, at read time

`tools/lib/spine.mjs`'s `coverage()` now reads `_build.json` alongside
`coverage.json` and throws when `cov.spineBuiltAt !== manifest.finishedAt`,
naming both timestamps and pointing at `node tools/build-coverage.mjs`. The
comparison is skipped only when the manifest is absent, which can happen only
under the `allowIncomplete` debugging escape hatch.

Test added to `tests/spine-query.test.js`: a temp dir with
`_build.json { complete: true, finishedAt: ... }` and a deliberately older
`coverage.json`; it asserts the throw, asserts the message carries both
timestamps and the word "stale", then rewrites `coverage.json` with a matching
timestamp and asserts `coverage()` returns normally.

Output:

    ok    coverage() throws when coverage.json is stale vs the manifest — spine: coverage.json is stale relative to the spine build — coverage.json reports spineBuiltAt="2026-09-01T00:00:00.000Z" but data/_build.json finished at "2026-09-16T03:43:14.982Z". Re-run `node tools/build-coverage.mjs` against the current spine.
    ok    staleness error names both timestamps — (same message)
    ok    coverage() returns normally when the timestamps agree — "2026-09-16T03:43:14.982Z"

## Finding 4 — the CSV validator at all three call sites

`tools/lib/fetch.mjs` exports `csvBody(text)`: strips a BOM, throws if the body
starts with `<` (an HTML error or rate-limit page served with a 200), throws if
the first line contains no comma (not a CSV header). It returns the original
text unmodified, so it slots into `getText`'s existing `validate` hook, which
runs before the disk write — a poisoned body never reaches the cache.

Passed at all three CSV call sites:

- `tools/build-statcast.mjs:99` — `parseCsv(await getText(b.url(year), csvBody))`
- `tools/build-players.mjs:24` — `await getText(url, csvBody)`
- `tools/build-data.mjs:76` — the sprint-speed leaderboard fetch

`build-data.mjs` was otherwise untouched apart from this argument, its import
line, and the Finding 7 header.

Behaviour check (no new test file — `tests/fetchlib.test.js` was outside the
permitted stage list):

    threw ok   html body :: csvBody: response body starts with "<" — looks like HTML, not CSV
    threw ok   no comma :: csvBody: no comma in the first line — not a CSV header
    valid csv passes: true
    bom csv passes: true

`csvBody` is safe against the "empty leaderboard" path in `build-statcast.mjs`:
a leaderboard with zero data rows still returns its comma-bearing header line,
which is exactly what the existing `if (!rows.length)` branch handles.

## Finding 6 — the header, and a reported bbref probe

`tools/build-players.mjs`'s header is rewritten. It now states plainly that
nothing in this repo joins through the table, why (Task 3's source swap left
`seasons.bbref` 100% NULL, Savant already carries MLBAM, and
`tools/lib/spine.mjs` never opens `players.parquet`), what the table *is* built
for (the Retrosheet work in a later plan, keyed on `retro` ids, and resolving
one player across id systems), and that the never-match-on-names warning still
stands for when a join does arrive.

Probe added to `tools/build-coverage.mjs`: key `player_bbref_ids`, dataset
`seasons`, `WHERE bbref IS NOT NULL`.

**The judgement call, stated plainly.** Yes — a zero-row probe *does* hit the
existing "omit if nothing matched" path (`if (r.first == null) { WARN ...;
continue; }`). I did **not** let it be omitted. It is reported with `rows: 0`.

But I report it under a new top-level `unconsumedColumns` section, **not** under
`stats`, and that part was a deliberate departure worth naming. Putting a
zero-row entry into `stats` would have been actively harmful: `requireCoverage()`
reads `cov.stats[stat]`, and with `first: null, last: null` both
`year < c.first` and `year > c.last` evaluate false, so intake would answer
`ok: true` for bbref in *every* year — advertising a join with no rows behind
it, which is the precise failure this probe exists to prevent. It would also
have broken two pre-existing `coverage.test.js` assertions (`every stat carries
a non-zero row count` and `first is never after last`), which I was told not to
adjust. Keeping the probe out of `stats` leaves both of those untouched and
green while still making the zero visible.

Reported value:

    player_bbref_ids       0 rows (unconsumed column probe)

    {"first":null,"last":null,"rows":0,"players":0,
     "source":"MLB Stats API (statsapi.mlb.com)","dataset":"seasons","grain":"player-season"}

Three checks added to `tests/coverage.test.js`: the probe is present, it carries
`rows === 0` rather than being omitted, and it is NOT in `stats`.

    ok    coverage reports the bbref probe — ["player_bbref_ids"]
    ok    player_bbref_ids is reported with rows: 0, not omitted — {"first":null,"last":null,"rows":0,...}
    ok    player_bbref_ids is NOT in stats (intake must not treat it as available)

## Finding 7 — the freeze notice and the npm script

Documentation only. No behavioural change; `data.js` was not regenerated and is
not part of this commit.

Added a header block to `tools/build-data.mjs` stating (a) `data.js` is frozen
because its run environment is a published result — the runs/game figures in
`README.md` and the byte-identical box score `tests/ngon.test.js` asserts — and
(b) the traded-player double-count: the hydrate omits `,team)`, so
`stats.splits[0]` is the player's combined season line stamped on whichever club
happened to fetch him (18 affected players in 2024 alone), which
`tools/build-seasons.mjs` fixes via its `ownSplit` helper plus a `,team)` on the
hydrate. It concludes that running the script both unfreezes `data.js` and
reintroduces the bug.

`package.json`: `"build:data"` renamed to `"build:data:frozen-do-not-run"`.

## Finding 10 — the dedupe partitions on the cast value

`tools/build-players.mjs`: `PARTITION BY key_mlbam` becomes
`PARTITION BY TRY_CAST(key_mlbam AS INTEGER)`, with a comment naming the
`'660271'` / `'0660271'` case.

Rebuilt from the warm cache (`cache  16 hits  0 fetched` — no network).
**All four ground-truth counts are unchanged:**

    ok    player count is 23666 (register as of 2026-09-15) — n=23666
    ok    bbref non-null count is 23664 — n=23664
    ok    retro non-null count is 23200 — n=23200
    ok    fangraphs non-null count is 21177 — n=21177
    ok    mlbam is unique — dupes=0

A source-level regression was added to `tests/players-data.test.js` asserting
the QUALIFY clause partitions on `TRY_CAST(key_mlbam AS INTEGER)`. It runs
before the `players.parquet` skip gate, so it holds on a fresh clone with no
data — which matters, because the bug is latent and a data-level assertion can
only catch it once upstream actually ships a zero-padded id.

## Finding 11 — the orchestrator runs the suite

`tools/build-spine.mjs` now spawns `run-tests.mjs` as a final step and exits
non-zero if it fails. **The two failure modes print different lines**, as asked:

Build-step failure (pre-existing, unchanged):

    build-spine: <step>.mjs failed with status <n>

Verification failure (new):

    build-spine: VERIFICATION FAILED — every builder completed and the spine is
    on disk, but tools/run-tests.mjs reported failures. This is not a build
    failure; the data was written and then failed its assertions. Read the test
    output above before trusting anything under data/.

The success line changed from ``spine built — run `node tools/run-tests.mjs` to
verify`` to `spine built and verified`.

## Commands run

    node tools/build-players.mjs      # warm cache, 16 hits / 0 fetched, 23666 players
    node tools/build-coverage.mjs     # rewrote data/coverage.json (gitignored)
    node tools/run-tests.mjs          # 19/19, run twice (after the edits, and again before the commit)

## Manifest and suite

`data/_build.json` was never modified. Both new refusal tests write their
synthetic manifests into `mkdtemp` directories and remove them in a `finally`
block. Verified after the run:

    complete: true years: 150 finishedAt: 2026-09-16T03:43:14.982Z

`data/coverage.json` was regenerated — it is gitignored, and it had to pick up
the new `unconsumedColumns` section. Its `spineBuiltAt` still matches the
manifest, which the new Finding 3 guard now enforces at read time.

Final suite result: **19/19 test files passed**. New checks: 3 in
`tests/coverage.test.js` for Finding 1, 3 more there for Finding 6, 3 in
`tests/spine-query.test.js` for Finding 3, and 1 in
`tests/players-data.test.js` for Finding 10. No pre-existing check was altered
or removed.

———
Generated by claude-opus-5 · task completed
