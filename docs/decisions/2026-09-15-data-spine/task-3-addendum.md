# Task 3 — ADDENDUM (controller ruling, overrides the brief's source section)

The brief's data source is dead. `chadwickbureau/baseballdatabank` returns 404 on
both `master` and `main`; the Baseball Databank is no longer published. Every
candidate fork is stale (2014 / 2021 / 2022), so none satisfies the brief's own
"reaches 2024 or later" assertion.

**Replacement source: the MLB Stats API (`statsapi.mlb.com`).** Free, no key, and
already the source `tools/build-data.mjs` trusts in this repo — so this is not a
new source of truth, it is the one the project already uses. I verified all of
the following directly before writing this:

| Probe | Result |
|---|---|
| `teams?sportId=1&season=1876` | 8 clubs — history reaches 1876 |
| `teams?sportId=1&season=1901` | 16 clubs |
| 1901 roster + `hydrate=person(stats(...group=hitting))` | 31 players, 30 with `plateAppearances` |
| 1901 roster + `...group=pitching` | 10 with `inningsPitched` |
| Pedro Martinez 2000 (`people/118377/stats`) | **IP 217.0 → ipouts 651, SO 284, ER 42, BF 817** |
| `teams/stats?group=hitting&season=2019` | 30 teams, **R/G = 4.831 per team-game** |

The two assertions the brief's test depends on both hold against this source
unchanged. Do not alter the expected values.

## What changes

### 1. Fetch pattern — per club, not one leaderboard

**Do NOT use** `/api/v1/stats?stats=season&group=...&playerPool=All&limit=N`. I
probed it: for 2000 pitching it returned only 606 splits and silently omitted
Pedro Martinez entirely. It is incomplete and it carries no team attribution.

**Use the roster-hydrate pattern `tools/build-data.mjs` already uses**, which is
proven in this repo. For each year, and each club in that year, two fetches:

```
https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${year}
  -> .teams filtered to t.sport && t.sport.id === 1

https://statsapi.mlb.com/api/v1/teams/${club.id}/roster
  ?season=${year}&rosterType=fullSeason
  &hydrate=person(stats(type=season,group=hitting,season=${year}))

  ...and the same URL again with group=pitching
```

Read each entry as `spot.person.stats[0].splits[0].stat`; skip entries where that
is missing. `spot.person.id` is the MLBAM id, `spot.person.fullName` the name,
`spot.position.abbreviation` the position.

Go through `getText`/`getJson` from `tools/lib/fetch.mjs` so everything is cached,
and use its `pool(items, 8, fn)` for concurrency. Roughly 150 years x ~20 clubs x
2 groups ≈ 6000 cached requests; expect two to three minutes cold, seconds warm.

Default year range: **1876 to 2025**, overridable by argv exactly as the brief
specifies. 2026 is in progress and is deliberately excluded from the default.

### 2. `seasons` schema — two columns change

`mlbam` is now **populated natively** (`spot.person.id`), not NULL. This is
strictly better than the plan assumed: it means Task 7 can join seasons directly
to statcast on `mlbam` with no crosswalk hop.

`bbref` is **not available** from this source. Write it as NULL. Keep the column
so the schema is stable for plan 1b (Retrosheet), which will populate it via the
Chadwick register from Task 4.

Add one column the brief omitted: **`pos VARCHAR`** from
`spot.position.abbreviation`. Task 7 must return "the same shape `data.js` hands
`sim.js` today", and `data.js`'s `P()` carries `pos` — so it is required, not
scope creep.

Final column list for `data/seasons/{year}.parquet`:

```
year INT, mlbam INT, bbref VARCHAR, name VARCHAR, pos VARCHAR,
team VARCHAR, lg VARCHAR, role VARCHAR,
pa INT, ab INT, h INT, d2 INT, d3 INT, hr INT, bb INT, so INT,
sb INT, cs INT, hbp INT,
ipouts INT, er INT, bf INT, p_h INT, p_bb INT, p_so INT, p_hr INT
```

`role` is `'bat'` or `'pit'`; a two-way player has one row of each. A player
traded mid-season appears once per club — that is correct and matches how the
roster endpoint reports it. Do not collapse those rows.

### 3. Field mapping

Batting (`group=hitting`) — note `plateAppearances` is **native**, so the brief's
`pa = AB + BB + HBP + SH + SF` derivation is gone, and with it that whole class of
bug:

```
pa  <- plateAppearances      ab  <- atBats        h   <- hits
d2  <- doubles               d3  <- triples       hr  <- homeRuns
bb  <- baseOnBalls           so  <- strikeOuts    hbp <- hitByPitch
sb  <- stolenBases           cs  <- caughtStealing
```

Keep `bb` and `hbp` separate here. (`data.js` folds HBP into `bb`; that is a
consumer decision, made in Task 7, not in storage.)

Pitching (`group=pitching`):

```
er <- earnedRuns   bf <- battersFaced   p_h <- hits
p_bb <- baseOnBalls   p_so <- strikeOuts   p_hr <- homeRuns
```

**`inningsPitched` is a string in thirds, not a decimal.** `"217.0"` is 217
innings, `"216.1"` is 216 and one third, `"216.2"` is 216 and two thirds. Convert:

```js
const toOuts = (ip) => {
  if (ip == null) return null;
  const [w, f] = String(ip).split('.');
  return Number(w) * 3 + Number(f || 0);
};
```

Treating it as a float would silently corrupt every pitcher line. Write a tiny
unit check for `toOuts('217.0') === 651` and `toOuts('216.1') === 649` in the test
file — it needs no network, so it runs even on a fresh clone.

### 4. `league` dataset

Replaces the Teams.csv source. Two fetches per year:

```
https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting&season=${year}&sportId=1
https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=pitching&season=${year}&sportId=1
```

Each returns `.stats[0].splits`, one per club, with `split.team` and `split.stat`.
Join the two on team id.

```
year INT, team VARCHAR, lg VARCHAR, g INT, r INT, ra INT,
ab INT, h INT, d2 INT, d3 INT, hr INT, bb INT, so INT
```

`g <- gamesPlayed` and `r <- runs` from the hitting split; `ra <- runs` from the
pitching split. **Drop `w` and `l`** from the brief's schema — they need the
standings endpoint and nothing in the plan reads them.

### 5. Test changes — these three only

1. `'every row carries a player id'` must now count `mlbam IS NULL`, not
   `bbref IS NULL`. `bbref` is legitimately NULL from this source.
2. Add the two `toOuts` unit checks from section 3. Put them ABOVE the
   `data/seasons` existence guard so they run without network.
3. If the Pedro assertion returns more than one row, disambiguate with
   `AND ipouts > 600`. Do not change 284 / 651 — I verified both.

Everything else in the brief's test stays exactly as written, including the 1871
check — **change that one to 1876**, which is the real first season in this
source and in MLB.

### 6. Unchanged from the brief

`tools/lib/duck.mjs` exactly as specified. DuckDB still writes every Parquet file
and answers every later query; only the ingest changes, from `read_csv_auto` to
inserting rows you have already parsed from JSON. The `"2B"`/`"3B"` SQL quoting
hazard disappears with the CSVs — your column names are now yours to choose.

The cache-summary line I asked for still applies:
`console.log(\`cache  ${cs.hits} hits  ${cs.misses} fetched\`)`.

## Why this is better than what the plan specified

Native `plateAppearances` removes a derivation. Native `mlbam` removes a join hop
for Task 7. Position comes along free. And the spine now draws from the same
first-party source `build-data.mjs` already uses, instead of a second, unmaintained
mirror — which is what just broke.

**Cost if this ruling is wrong:** the build makes ~6000 cached HTTP requests
instead of four CSV downloads, and early-era coverage for some fields (caught
stealing, HBP before the 1950s) may be thinner than Lahman's. `coverage.json` in
Task 6 measures that honestly from what actually lands — which is exactly what it
exists for.
