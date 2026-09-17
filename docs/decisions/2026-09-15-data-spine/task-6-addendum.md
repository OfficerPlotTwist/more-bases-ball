# Task 6 — ADDENDUM (controller rulings accumulated across Tasks 3 and 5)

The brief is structurally correct — every probe in its `PROBES` list still
resolves against the columns Tasks 3 and 5 actually wrote, and the
"measured, never hardcoded" principle is exactly right. Four things changed
underneath it since it was written, and one assertion in its test is now wrong.

`coverage.json` is the artifact **intake trusts before charging a customer**.
Everything below exists because measuring a truncated or misleadingly-uniform
spine and reporting it as complete is the single worst failure this project has.

## 1. The test's 1871 assertion is wrong — it is 1876

The brief's test asserts `s.season_batting.first === 1871` and
`s.season_pitching.first === 1871`. Task 3's data source changed from the Lahman
databank to the MLB Stats API, whose history begins at **1876**, the first
National League season. Change both assertions to `1876`. Everything else in
that test stands.

## 2. Refuse to run on an incomplete spine — this is the gate

Task 3 writes a build manifest at `data/_build.json`. Before any probe runs,
`build-coverage.mjs` must:

```js
const manifestPath = path.join(DATA, '_build.json');
if (!fs.existsSync(manifestPath)) {
  console.error('build-coverage: data/_build.json is missing — run '
    + '`node tools/build-seasons.mjs` first. Refusing to measure coverage '
    + 'against an unverified spine.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.complete !== true) {
  console.error('build-coverage: data/_build.json reports complete=false '
    + `(${manifest.failures.length} failures). Refusing to measure coverage `
    + 'against a partial spine — fix the build first.');
  process.exit(1);
}
```

Copy `manifest.generatedAt`-style provenance into the output: include
`"spineBuiltAt": manifest.finishedAt` in `coverage.json` so a reader can tell
which build the coverage describes.

Add a test check asserting `coverage.json` carries `spineBuiltAt`.

## 3. Per-column population, not just first/last/rows

The brief records `{first, last, rows, source, grain}` per stat. That is not
enough, and Task 5's review found the concrete case:

**Exit velocity and launch angle cover roughly half the players that expected-woba
covers in the very same row.** `ev`/`la` come from a board gated at 50 batted
balls (~480-500 players/year); `xwoba` comes from one gated at 50 plate
appearances (~650-1050/year). A consumer filtering on `ev IS NOT NULL` silently
gets half the population and is told nothing.

Add two fields to every stat entry:

```
"players": <count of DISTINCT mlbam with a non-null value>,
"playerYearsPerSeason": <rows / (last - first + 1), rounded>
```

and, for the Statcast-derived stats only, a comparison against the widest
Statcast column in the same dataset:

```
"populationVsWidest": <this stat's DISTINCT mlbam / the widest stat's, 2dp>
```

So `batted_ball_tracking` should come out around 0.5 and `sprint_speed` near 1.0,
making the asymmetry a number on the page rather than a surprise in a query.

Add a test asserting `batted_ball_tracking.populationVsWidest < 0.8` and
`sprint_speed.populationVsWidest > 0.8` — if those ever converge, the gating
changed upstream and someone should look.

## 4. Empty club-years are a first-class coverage fact

Task 3's manifest records `clubsEmpty: ["ABBR", ...]` per year: clubs that MLB
lists for that season but for which the source has no player rows. There are
**111** of them. They are not build failures and they are not random:

- **Negro Leagues, roughly 1920-1948.** MLB recognised the Negro Leagues as major
  leagues in 2020, so `sportId=1` returns those clubs, but player-level statistics
  for them are thin. 1924 lists 34 clubs, 18 of them Negro Leagues.
- **Federal League, 1914-1915.** Team totals exist; player rows do not.
- **Franchises listed before they played** — Tampa Bay and Arizona appear under
  1996 but debuted in 1998.

Add a top-level section to `coverage.json`:

```json
"leagueOnlySeasons": {
  "totalEmptyClubYears": 111,
  "note": "Clubs MLB lists for a season that have team totals but no player-level rows in this source.",
  "years": { "1924": ["BRG","CSE","DAY","HIL"], "1914": ["BAL-F", "..."] }
}
```

Read it from the manifest's `clubsEmpty`; do not recompute it. Include only years
that actually have entries.

**Why this is a feature, not an apology.** A fan who asks a 1924 question should
be told, on his own results page, that player-level data for the Negro Leagues in
that era is league-only in this source. That sentence is honest provenance and it
is the kind of thing that makes a paid analysis product trustworthy. Burying it
would be the alternative, and the alternative is worse.

Add a test asserting `leagueOnlySeasons.totalEmptyClubYears === 111` and that
`years["1924"]` is a non-empty array.

## 5. Unchanged from the brief

The `PROBES` list, the measured-not-declared principle, the
`build-coverage.mjs` output format, the per-stat `source` and `grain` fields, and
the test that greps the builder's own source to confirm it does not hardcode a
year — all stand exactly as written. The eleven probes still resolve correctly
against the columns Tasks 3 and 5 wrote; I checked each one.

Keep the cache-summary convention only if the builder fetches anything. It does
not — it reads local parquet — so omit it here.

**Cost if these rulings are wrong:** `coverage.json` grows by three fields per
stat and one top-level section, and the builder gains a refusal path that can
stop a run. The refusal is the point; the rest is reporting.
