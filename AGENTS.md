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
`for t in tests/*.test.js; do node $t; done` — all 27 files must pass.
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

## Era rules (rules.js)

`rules.js` is GENERATED. Rebuild it with `node tools/build-rules.mjs`; the
source of truth is the committed catalog at
`docs/decisions/2026-09-18-era-rules/rules-catalog.json` — 112 significant MLB
rules changes, 1876-2026, from 27 sources. Hand-editing `rules.js` is how the
two drift apart.

Rules sort into three tiers and the tiers partition the catalog exactly
(5 + 43 + 64 = 112, asserted by `tests/rules-catalog.test.js`):

- **A, structural** — expressible as game state (ghost runner, DH, 7-inning
  doubleheaders).
- **B, rate** — a perturbation of the per-PA event distribution, applied
  through `applyModifiers` in `sim.js` using the same clamps `adjustedRates`
  already proved out.
- **C, declared** — real, in effect, and not simulable here. These ship
  VISIBLE rather than omitted, for the reason `coverage.json` never omits an
  unavailable KPI: an absent entry reads as "this did not exist", which is a
  different and wrong statement. 29 are flatly unmodelable, 25 partial, and
  10 are modelable but were never quantified — only that last group is
  shrinkable by later work.

Every rule is a branch on a config value. `cfg.rules` is null by default and
`hasMods` — not the mere presence of a rules object — is what diverts
`plateAppearance` off the legacy path, so a fully loaded historical rule set
with no coefficients is provably a no-op.

Coefficients are validated finite and greater than zero at `resolve()` time,
and that guard is not optional politeness: a NaN coefficient used to make
every plate appearance an out with no error raised, and a negative one
deleted an event type while the probability accumulator ran backwards.

**`composeModifiers` must never sort its input.** Multipliers compose
multiplicatively, and `tests/rules-resolve.test.js` proves order-independence
by handing it forward, reversed and shuffled orderings of the same selection.
An earlier version sorted inside `resolve()` before composing, which made that
assertion unfalsifiable in any phase — it would have passed even against
additive composition.

Calibration asserts PROPORTIONAL deltas on a fixed modern player pool, never
absolute historical levels. The sim cannot be 1968: most of the gap is
players, not rules, and a single runs/game match would be a false positive
because a knob can always be tuned to hit one number.

## Fielding errors

Errors come out of a margin the defense already computed. `resolveBallOut`
subtracts the fielder's travel time from the ball's hang time; that difference
is `slack`, and it used to be thresholded at zero and discarded.

Two curves live in `fielders.js` as PURE functions — `catchChance(slack)` and
`muffChance(slack, e0)`. All sampling stays in `graphsim.js`. That split is
what keeps the "No randomness anywhere" contract on `assignPlay` true, and
`tests/fielders.test.js` and `tests/defense-stress.test.js` both depend on it.

The two curves are deliberately NOT inverses. MLB Rule 9.12 charges an error
only where ordinary effort would have made the play, so a botched diving stop
is a hit and a booted routine grounder is an error — real errors concentrate
at the EASY end of the difficulty range. `catchChance` rises with slack and
its failures are hits; `muffChance` is zero below `ORDINARY_S`, peaks there,
and decays.

**A muff must un-complete the play.** It is sampled only among plays the
defense would otherwise have finished, and it makes them fail. An earlier
version drew the muff independently and stapled the tag on afterwards, which
charged errors on 1203 of 2195 balls the fielder CAUGHT and retired the batter
on, left reached-on-error at structurally zero, and made `BOBBLE_S` inert at
any value. Five task reviews passed that version; only measuring the outcomes
caught it.

`ERROR_E0` is fitted on the 250ft starter ring and the graph engine ONLY. The
rate varies hard with field size (0.39 at 90ft, 0.01 at 400ft) because a big
field makes everything routine. Do not read it as universal.

Errors are behind `cfg.errors = { e0 }` and OFF by default.
`tests/fixtures/defense-golden.json` holds 10 boxes captured before any of
this existed; if one moves while errors are off, a draw is being consumed that
was not consumed before.

## Statcast transport

`data.js` ships sixteen values per batter. The first eleven are the batting
line and the two sprint numbers, and they are frozen. The last five —
`mlbam`, `la`, `ev`, `oaa`, `arm` — exist so the launch-angle and
per-fielder-skill work are engine changes with no data work in front of them.

- **It is an APPEND, not a rebuild, and the distinction is the whole design.**
  `tools/augment-data.mjs` reads the committed `data.js`, slices each
  `P([...])` literal's existing text, and appends after it. The eleven are
  never re-serialised and never refetched, so identity holds by construction.
  Running `tools/build-data.mjs` instead refetches 2025 — an open season still
  taking corrections, and unlike the spine builders it passes no
  `isVolatileSeason` flag — so one corrected PA total reorders "the nine
  batters with the most plate appearances", swaps the ninth man, and moves
  every box score that `tests/rules-identity.test.js` indexes positionally.
  A rebuild is a deliberate act with its own delta report. It is not how you
  add a field.
- **`tools/check-data-identity.mjs` compares the DATA, not the box score**, and
  runs BEFORE the suite. The suite is downstream and can go green on a moved
  value: a median-filled bench bat who never reaches base in the ten fixture
  games ships without reddening anything. The checker asserts the season list,
  club order, lineup order and all eleven values exactly — no epsilon — and
  reports what moved, for which player, in which season. It is negative-tested;
  moving one hit yields `2021 ATL Freddie Freeman: h 180 -> 181`.
- **A missing value is `null`, never 0 and never a median.** `oaa` and `arm` are
  absent for a full-time DH because he does not field and makes no qualifying
  throw — that absence is the real signal. `arm: 0` reaching `throwSec()` is a
  fielder who cannot release the ball; `oaa: 0` is a bench bat rated as an
  average defender. Both look plausible in a box score, so
  `tests/data-transport.test.js` asserts against them directly. Fill within a
  covered season; never fill an uncovered one.
- **The name join was NOT safe, and this is why `mlbam` is emitted.** Four
  names across the five shipped seasons belong to two men each — Will Smith the
  catcher and Will Smith the reliever (2021, 2023), two Diego Castillos (2022),
  two Max Muncys (2025). Taking the higher-PA row would have attached a
  reliever's launch angle to a catcher, silently. The join is `(name, pa)`
  against either the season total or any club split, because a batter traded
  mid-season holds TWO lineup spots with his own split for each (2025 Rafael
  Devers, BOS and SF) — so `ids.size < players` is the correct invariant, not
  one id per season. `build-data.mjs` now emits `p.id`, which it always had in
  hand, so this is solved once rather than every time.
- **`la`/`ev` are 1350/1350 complete** for every shipped season: the arc
  sub-project needs no fallback, no median and no off switch. `oaa` (1225) and
  `arm` (1171) are structurally partial. The test carries coverage FLOORS
  because every other assertion only inspects a player who has a value, so a
  collapsed join would pass all of them.
- **`xwoba`, `bat_speed` and `swing_len` are deliberately absent** from
  `data.js` and still fetched into the spine. `xwoba` collapses the five
  outcomes `plateAppearance` already draws from, so feeding it back either
  duplicates or contradicts the observed line; `bat_speed` is a second proxy
  for what `ev` carries and covers 0 of 270 batters in 2021 and 2022;
  `swing_len` has no surface in a simulator with no pitch location, count or
  swing decision. The full ruling is
  `docs/superpowers/plans/2026-09-23-statcast-coverage.md`.
- Query the new columns through `tools/lib/spine.mjs` `battersByName()` only,
  like everything else that touches Parquet.

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
  reported and all 11 are computable. Never omit an unavailable KPI — an absent
  key reads as "not a KPI", which is a different and wrong statement from "we
  have no data for it", and only the second tells the next person what to build.
- **`data/games/` is the spine's one OPTIONAL dataset**, and the only one below
  season grain: team-game rows (two per game) built by `tools/build-games.mjs`,
  1901-present, ~451k rows. It exists for exactly one KPI —
  `run_distribution_variance`, which is a property of the per-game distribution
  and cannot be reconstructed from season totals. Its absence demotes that ONE
  KPI to `available: false` with the build command attached; it never fails the
  whole measurement, which is the opposite of the `_build.json` gate, because
  there a partial spine makes every number suspect.
  - Coverage starts at **1901**: the schedule endpoint returns `totalGames: 0`
    for 1876-1900. Season lines for those years exist; the game log does not.
  - **Dedupe on `gamePk`.** A suspended game is listed under both the date it
    started and the date it resumed, and `totalGames` counts it twice — so it
    arrived as four rows under one `gamePk` and was counted twice in the
    distribution. The manifest keeps the raw `gamesFetched` (a transport check
    against `totalGames`) separate from `gamesUnique`.
  - **Negro Leagues clubs are in the schedule but not in `/teams?season=Y`**
    for 1931/1934/1939, so `abbrForId()` falls back to `/teams/{id}`. Without
    it, 77 rows landed with `team: NULL` and one side of 77 real games vanished
    from the run distribution. This is the game-grain face of the same gap
    `leagueOnlySeasons` reports.
  - **An in-progress season is excluded from every game-grain KPI series** and
    named in `kpis.inProgressSeasons`. Its variance is a partial-season value;
    sigma is a series of year-over-year deltas, so one partial year corrupts
    two of them. Detected from a scheduled game dated in the future, never from
    `gamesScored < apiTotalGames` — that cannot tell "not played yet" from
    "never played", and 1994 and 2020 are the latter.
  - `var_pop`, not `var_samp`: a season's team-games are the whole population,
    not a sample. They differ by n/(n-1) — ~0.02% at 4860 team-games, invisible
    in the value, which is exactly why the wrong one would never be noticed.
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
- **`data.js`'s eleven shipped values are unchanged and stay that way.** It is
  the committed slice the browser sim loads; its run environment is published in
  the README and `tests/ngon.test.js` asserts the box scores do not move.
  REGENERATING it from the spine is still a later sub-project — do that here and
  the published numbers move under the reader.
  - It now carries five MORE values per batter (`mlbam`, `la`, `ev`, `oaa`,
    `arm`) and the eleven are untouched. See **Statcast transport** below for
    why appending is a different act from regenerating.
