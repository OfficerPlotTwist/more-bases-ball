# moreBasesBall — agent guidance (mined from Aug 2026 sessions)

- When you produce or update the site/page, open it in the browser AND print the clickable URL in the same message — don't wait to be asked.
- Pages here load ES modules: serve them (`npx serve <dir>`) instead of opening `file://`, which breaks module loading.

## The 3D field (field3d.js)

- `field3d.js` is the only ES module here; everything else is an IIFE that
  hangs itself off `window`. It is loaded with `<script type="module">` and
  an importmap pointing `three` at `vendor/three.module.js`.
- It renders `entry.anim` and decides nothing. If a play looks wrong on
  screen, check the engine that built the timeline before touching the
  renderer.
- One clock, and it matters: `buildAnim` must time the throw off
  `entry.defense.tSecure` — the same number `resolveBallOut` used to decide
  the play — never off raw flight time. Timing them separately is what made
  the ball leave before the fielder arrived on 58% of throws, so he ran to
  an empty patch of grass and the throw came from nobody. `tests/anim.test.js`
  guards this.
- Ball height is NOT in the data — the engine stores ground positions only.
  Arcs are rebuilt per leg in `arcHeight()` off the `leg` tag each ball
  waypoint carries (`pitch` / `batted` / `homer` / `throw`).
- Canvas textures need `colorSpace = THREE.SRGBColorSpace`, or three treats
  them as linear and the turf washes out to sage.
- Camera framing is computed from field size and lens, never hard-coded —
  a 90ft diamond and a 250ft triangle both have to fill the frame.
- The shadow frustum is fitted to the field in `fitShadows()`. A fixed one
  spreads the shadow map thin enough that the outfield shadows itself.

## Classic games

Classic N-gon outcomes come from `sim.js` and must stay that way — the run
environment in the README (1 base ≈ 18 runs/game, 7 ≈ 6) is a published
result. `ngon.js` only adds geometry on top; `tests/ngon.test.js` asserts the
box score is byte-identical before and after.

## Tests

`node tools/run-tests.mjs` (portable) or
`for t in tests/*.test.js; do node $t; done` — all 21 files must pass.
`tests/defense-stress.test.js` is the one to run after touching anything in
`fielders.js` or `resolveBallOut`: it covers the awkward custom layouts.

- The outfield plane must keep `receiveShadow = false`. It extends far past
  the shadow frustum and the boundary shows up as dark triangles on the
  turf; the per-player contact blobs are what actually read at this scale.

## Runner rules

`resolveBallOut` owes the runners two real rules, and both have bitten:

- **Force** is a chain from the batter's first base through every occupied
  base in front of it, stopping at the first gap. It is NOT "everyone runs
  on a ground ball" — that shoved runners off bases they never had to leave
  and doubled them up for it.
- **A catch removes every force**, and a tagging runner cannot leave until
  the ball is in the glove (`tGo` on the move, seconds after contact; the
  animation waits on it).

Fielder depth is not purely a function of the base ring. Batted-ball carry
is fixed physics, so the outfield floor is `OF_DEPTH_FT`; without it a small
field's outfielders stand closer than a routine fly ball, nothing is ever
caught, and the tag-up rules can never fire.

Prefer testing runner rules as a **differential on one play** (same ball,
two runners; or same runners, ground ball vs catch). "He did not move" alone
proves nothing — an unforced runner still advances whenever the bag is
poorly covered, which is by design.

## Players must not vanish mid-play

Only the ball fades during a play. Runners and fielders hold full opacity
until the play ends and `renderRunners` cuts at the boundary. Fading retired
and scored runners deleted the player you were watching at the exact moment
the red or green body was the point — who was out, and where. 100% of them
were vanishing early, 0.54s on average.

A player is four materials (body, head, contact shadow, name sprite). Fade
them together via `setPlayerOpacity` — fading `userData.mat` alone leaves a
solid head floating over a solid shadow.

## Data spine

`data.js` is the small, committed slice the browser sim loads. The **spine**
under `data/` is the full population the service simulates against: every
player 1876-2025, both roles, plus Statcast tracking from 2015. It is
generated and gitignored.

- **Sources.** Season lines and team totals come from the MLB Stats API
  (`statsapi.mlb.com`), not Lahman/Baseball Databank — that mirror 404s, it
  is gone, and repeating the old claim would send the next person fetching a
  dead repo. Statcast tracking is six Baseball Savant leaderboards, each with
  its own era start. The player id crosswalk is the Chadwick Register. All
  free, none key-gated.
- Build it: `node tools/build-spine.mjs`. Builders run in dependency order
  and share an HTTP cache at `data/.cache`, so a rebuild is cheap (warm
  ~30s; cold, a few minutes; `MBB_CACHE_REFRESH=1` forces refetch).
- Query it through `tools/lib/spine.mjs` only. Nothing else reads Parquet —
  that is what keeps the storage layout swappable.
- Team codes are the **modern** MLB abbreviations (`LAD`, `NYY`), not
  Lahman's historical forms — the source is the Stats API, which never used
  `LAN`/`NYA`. There are 163 distinct codes across history including
  Federal League forms like `BAL-F`; do not assume the set is 30.
- **Three gates guard a customer-facing number, and all three have to hold
  for `coverage.json` to mean anything:**
  - `build-seasons.mjs` writes `data/_build.json` with `complete: true` only
    when the year loop finished, no club fetch failed, and every year
    fetched the number of clubs MLB lists. A partial build never exits 0.
  - `build-coverage.mjs` refuses to run unless `complete === true`.
    `coverage.json` is what intake reads before charging a fan for a rule;
    measuring a truncated spine and reporting it as whole is the worst
    failure mode this project has, worse than refusing to answer at all.
  - `openSpine()` refuses for the same reason, with `{ allowIncomplete:
    true }` as a debugging-only escape.
- **`_build.json` is MERGED, never replaced.** A scoped run
  (`node tools/build-seasons.mjs 2023 2024`) rewrote the whole manifest from
  its own argv, so a 150-year manifest became a 2-year one while all 150
  parquet files sat untouched beside it — and it still said `complete: true`,
  truthfully, for the two years it now described. All three gates passed on a
  manifest accounting for none of the other 148 years, and `leagueOnlySeasons`
  (derived from it) would have collapsed from 111 club-years to whatever those
  two held, stripping a 1924 results page of its Negro Leagues provenance.
  `mergeManifest(existing, run)` is pure and exported for exactly this reason:
  the bug lived behind a multi-minute network build and could not be tested
  until it came out. `tests/manifest-merge.test.js` asserts the year count.
  `writeManifest()` then checks the merged claim against disk and demotes any
  year whose parquet has gone — an inherited entry is only worth what the
  files back.
- `spine.mjs` validates every query parameter and throws rather than
  interpolating it raw: `year` must be an integer, `team` must match
  `/^[A-Z]{2,4}(-[A-Z])?$/`, `role` must be `bat` or `pit`. These parameters
  originate in a customer request in the product this serves and land
  straight in SQL — a `year: '2024 OR 1=1'` and a `team: "LAD' OR '1'='1"`
  payload both defeated the filters before the guards went in;
  `tests/spine-query.test.js` carries both as regressions.
- `coverage.json` also carries `leagueOnlySeasons` — 111 club-seasons that
  have team totals but no player rows, overwhelmingly Negro Leagues clubs
  1920-1948 (MLB recognised them as major leagues in 2020, so they appear in
  the team list while player-level data stays thin) plus the 1914-15
  Federal League. Surface that on a results page touching those years; it is
  provenance, not an apology.
- **The HTTP cache has no TTL, and must not get one** — baseball history is
  immutable, and existence-keyed caching is what makes a warm rebuild ~30s
  across ~6000 requests. The one exception is a season that is not over yet:
  every per-year fetch passes `{ fresh: isVolatileSeason(year) }` (the current
  year and the one before it, which still takes late corrections) so it
  refetches and overwrites its cache entry. Add a per-year fetch without it and
  a September rebuild serves March: that year lands in parquet as a
  half-season, `_build.json` still says `complete: true`, and `coverage.json`
  reports it as whole — all three gates pass, because each only asks whether
  the build lost anything it fetched, never whether what it fetched was
  current. A forced refetch counts as a cache MISS and both builders name the
  refetched seasons in their cache line, so `cache N hits 0 fetched` can never
  describe a run that went to the network.
- Spine tests skip cleanly when `data/` is absent, so a fresh clone with no
  network still shows the original twelve green. The pure halves do NOT skip —
  `requireCoverage`, `requireKpis` and `stdevOfDeltas` decide whether a fan is
  charged, so they are tested with no data and no network.
- **`coverage.json` answers two different questions and they must not be
  confused.** `stats` says a COLUMN exists and since when. `kpis` says a
  DIAGNOSTIC can be COMPUTED — for which years, with what gaps, and against what
  sigma. `season_batting` reaches 1876; on-base percentage starts at 1954,
  because nobody recorded a sacrifice fly before then. All 11 spec KPIs are
  reported; 10 are computable and `run_distribution_variance` is carried with
  `available: false` because it needs per-GAME runs and the spine holds
  team-SEASON totals. Never omit an unavailable KPI — an absent key reads as
  "not a KPI", which is a different and wrong statement from "we have no data
  for it", and only the second tells the next person what to build.
- **KPI definitions live in ONE place**: `KPIS` in `tools/lib/spine.mjs`.
  `sigma()` computes from it and `build-coverage.mjs` measures from it. Two
  copies would let a baked-in sigma and a live `sigma()` disagree, ranking a
  rule's effect against the wrong yardstick with nothing going red.
- **`?? null` in the league-row mapping is load-bearing, never `?? 0`.** The
  Stats API omits a stat key for eras that never recorded it (`sf` before 1954,
  `cs` before ~1950, `gidp` before 1933) instead of returning zero, so a null
  reaches Parquet and each KPI reports its real first year. A zero default would
  have published a plausible-looking pre-1954 "OBP" that is not OBP.
- **A first/last range is not a coverage answer.** A KPI's middle can be hollow:
  `strikeout_rate` spans 1876-2025 but 13 seasons (1897-1909) never tabulated
  batter strikeouts. Each entry carries `missingYears`, and `requireKpis()`
  checks it — a gap inside the range is its own refusal with its own sentence,
  distinct from out-of-range and from unavailable.
- The spine's decision record — 32 rulings with their cost-if-wrong, every task
  brief and report — is committed at `docs/decisions/2026-09-15-data-spine/`.
  Three builders cite it by path for why they are shaped as they are. The review
  diffs are not committed; the README there lists every commit range so
  `git diff <range>` reproduces them exactly.
- **`data.js` is unchanged and stays that way.** It is the committed slice
  the browser sim loads; its run environment is published in the README and
  `tests/ngon.test.js` asserts the box scores do not move. Regenerating it
  from the spine is a later sub-project, gated by a golden-run identity test
  — do it here and the published numbers move under the reader and the test
  suite goes red.
