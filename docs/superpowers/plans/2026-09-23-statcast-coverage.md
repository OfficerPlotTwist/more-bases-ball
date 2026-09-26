# Statcast Coverage — Representing the Seven Unused Values

> **STATUS: PLAN AWAITING APPROVAL. Nothing here is implemented.** No engine
> file, no `data.js`, and no builder was touched to produce this document. The
> only artefact is this file.

> **Two of the seven values are already spoken for by other work.** `la` and
> `ev` belong to the committed 3D-ball-arc sub-project (real per-batter launch
> angle replacing `arcHeight()`'s heuristic). `oaa` and `arm` are the inputs an
> in-flight fielding-error design is built on. This plan describes what those
> four enable and what they need from the transport layer; it does **not**
> propose a competing design for any of them. Its own territory is `xwoba`,
> `bat_speed`, `swing_len`, and the cross-cutting `data.js` bottleneck that all
> four owned sub-projects have to pass through.

**Goal:** Decide, per value, whether it should reach the simulator at all; build
the one piece of shared plumbing that every "yes" depends on; and prove with a
committed gate that adding it cannot move a published box score.

**Finding that prompted this:** `tools/build-statcast.mjs` fetches nine
per-player values from six Baseball Savant leaderboards into
`data/statcast/{year}.parquet`. Two of them (`spd`, `hp1`) drive the RUN MODEL
in `graphsim.js` and ship in `data.js`. The other seven — `xwoba`, `ev`, `la`,
`oaa`, `arm`, `bat_speed`, `swing_len` — are referenced by no line of `sim.js`,
`graphsim.js`, `trisim.js`, `fielders.js`, `layout.js`, `ngon.js`, `field3d.js`
or `data.js`.

**Spec:** none. This plan is written directly against the code, in the house
style of `docs/superpowers/plans/2026-09-18-era-rules-phase1.md`.

---

## Headline verdicts

| value | verdict | where it would land |
|---|---|---|
| `la` avg launch angle | **already owned** | `field3d.js` `arcHeight()` — the 3D ball-arc sub-project |
| `ev` avg exit velocity | **already owned** | same sub-project; also the honest carry term for `arcHeight()`'s apex |
| `oaa` outs above average | **likely claimed** | `fielders.js` `travelSec()` / a skill term in `resolveBallOut`'s margin |
| `arm` max arm strength | **likely claimed** | `graphsim.js` `throwSec()` — replaces the `THROW_FTS = 135` constant |
| `bat_speed` avg bat speed | **gated maybe — probably not** | `graphsim.js` `contactFor()` distance bands |
| `swing_len` swing length | **do not use** | no surface in this simulator at all |
| `xwoba` expected wOBA | **do not use in the sim** | keep it in the spine; it is a calibration/analytics number, not a sim input |

**The single highest-value piece of work in this document is not any one of the
seven.** It is Task A, the transport: `data.js` currently emits no MLBAM id and
no Statcast block beyond `spd`/`hp1`, so *both* owned sub-projects are blocked
on the same small change plus its identity gate. Build that once, correctly,
and `la`/`ev` and `oaa`/`arm` each become a renderer/engine change with no data
work in front of it.

---

## Evidence: measured coverage, not assumed coverage

Run against the built spine at `data/statcast/*.parquet` (non-null counts per
season) and joined by name against the exact batters `data.js` ships:

| season | shipped batters | `xwoba` | `ev`/`la` | `oaa` | `arm` | `bat_speed`/`swing_len` |
|---|---|---|---|---|---|---|
| 2021 | 268 | 268 | 268 | 250 | 235 | **0** |
| 2022 | 270 | 270 | 270 | 247 | 237 | **0** |
| 2023 | 270 | 270 | 270 | 247 | 232 | 113 |
| 2024 | 270 | 270 | 270 | 238 | 231 | 130 |
| 2025 | 269 | 269 | 269 | 240 | 233 | 161 |

Two facts fall straight out of this table and they drive most of the plan:

1. **`ev` and `la` are complete for every shipped season.** Nothing about the
   arc sub-project needs a fallback path for a missing player. That is a large
   part of why it is the right one to ship first.
2. **`bat_speed` and `swing_len` cover less than half the shipped lineup even in
   their best season, and nothing at all in two of the five.** Any model built
   on them is a model that is switched off for 40% of the league and 100% of
   2021–2022. That is the whole case against them, below.

`oaa` and `arm` are structurally incomplete rather than era-incomplete: a
full-time DH has no fielding OAA and no qualifying arm-strength throws. The
missing ~30–40 per season are a *real* signal ("this man does not field"), not
a data gap, and the owned fielding-error design should treat them as such.

---

## 1. What each value would actually change

### `la` — average launch angle · **already owned**

`field3d.js:82` `arcHeight(leg, u, distFt)` reconstructs every ball arc from a
leg tag and a distance, with no physics in it. The `batted` branch computes its
apex as `distFt < 110 ? 2 + distFt * 0.045 : Math.min(120, distFt * 0.24)` —
where `0.24` is a hand-tuned constant standing in for launch angle. A real
per-batter `la` replaces it, so a 19° hitter's 350-foot drive and a 7° hitter's
350-foot line drive stop drawing the identical parabola. **This sub-project is
already committed to the user and is not re-designed here.** What it needs from
this plan is only Task A: `la` present on the player object, and the batter's
identity reaching the animation. Note that `entry.anim` ball waypoints
(`graphsim.js` `buildAnim()`) currently carry `leg` and `distFt` but **not the
batter**, so the transport work has a second half for this consumer — an `la`
(or precomputed apex) field written onto the `batted` waypoint at build time.
That keeps `field3d.js` in its stated role: it renders `entry.anim` and decides
nothing.

### `ev` — average exit velocity · **already owned**

Same sub-project. `ev` is the other half of a real trajectory: `la` sets the
shape, `ev` sets the carry. It is also the honest replacement for the
`HIT_FTS = 110` flat batted-ball speed in `graphsim.js:20`, which currently
gives every batted ball the same hang time and therefore the same catch/no-catch
verdict in `resolveBallOut` — `const caught = !grounder && assign.tReach <=
contact.distFt / HIT_FTS`. **Flagged, not claimed.** Touching `HIT_FTS` changes
graph-engine outcomes and belongs to whoever owns the arc work, coordinated with
the fielding work below, because both land on the same line.

### `oaa` — outs above average · **likely claimed**

`fielders.js` is explicit that it has **"No randomness anywhere"** and that
`travelSec(slot, pt)` is `0.25 + ftBetween(slot, pt) / FIELD_FTS` with a single
league-wide `FIELD_FTS = 24`. `oaa` is the obvious per-fielder skill term: a
+15 OAA outfielder should get a shorter read-and-break beat or a higher
`FIELD_FTS`, which flows straight into `assign.tReach`, which is exactly the
quantity the in-flight error design measures its margin against. **Flagged as a
dependency, not designed here.** Two constraints that work will inherit and
should be told about now:

- `fielderSlots()` assigns slots by geometry (`F1`…`F6`, `P-H1`, `C-H1`) with
  **no link to a named player**. There is no roster of fielders in this project
  — `data.js` ships nine *batters* per club with a `pos` string. Giving a slot
  an OAA requires deciding which shipped batter stands in which slot, and that
  decision does not exist anywhere in the codebase today. That is the real cost
  of `oaa`, and it is larger than the value lookup.
- Any per-fielder term must keep `assignPlay()` deterministic and
  order-independent; its tie-breaks on slot id exist for exactly that reason.

### `arm` — max arm strength · **likely claimed**

`graphsim.js:76` `throwSec(ft)` is built on `THROW_FTS = 135` (~92 mph), a
single constant for every throw on the field. `arm` is the direct per-fielder
replacement: `throwSec(ft, armFts)`. The knock-on is immediate and desirable —
`playTime(nodeId)` in `resolveBallOut` is `tCatch + throwSec(...) + TRANSFER_S`,
so a weak-armed corner outfielder starts conceding the bases a strong one takes
away. **Flagged, not designed.** Same roster-identity blocker as `oaa`: the arm
belongs to a slot, and slots have no players. Note also that `arm` is *max* arm
strength, not average — using it as an every-throw velocity systematically
over-throws the whole league, so the owned design needs a scaling decision, not
a raw substitution.

### `bat_speed` — average bat speed · **gated maybe, probably not**

The only plausible surface is `graphsim.js` `contactFor()`, whose distance bands
are keyed on hit type alone: `OUT: [40, 300]`, `'1B': [90, 200]`, and so on,
with `distFt = R[0] + rnd() * (R[1] - R[0])`. Every batter's outs land in the
same 40–300 ft band. Scaling that band by the batter's bat speed would put a
72 mph swing's outs in the infield and a 78 mph swing's on the warning track,
which changes who catches them. Three reasons not to do it:

1. **`ev` does the same job better and is already spoken for.** Bat speed's
   effect on where a ball lands is mediated entirely through exit velocity,
   which this project already has, for 270/270 batters, in the hands of a
   sub-project that is going to plumb it anyway. Adding `bat_speed` as a
   *second* proxy for the same physical quantity is two numbers disagreeing
   about one thing.
2. **Coverage is disqualifying:** 0 of 268 in 2021, 0 of 270 in 2022, and
   113–161 of 270 thereafter. The feature is off for two of five shipped
   seasons and for roughly half the league in the rest.
3. It moves graph- and tri-engine outcomes (not the frozen classic box scores),
   so it is not free — it costs a re-measurement of the graph run environment.

**Recommendation: do not build it. Re-open only if the arc sub-project ships and
deliberately declines to touch `contactFor()`**, in which case it becomes a
3–4 hour change with a median fill and a per-season off switch.

### `swing_len` — swing length (feet of bat-head travel) · **do not use**

There is no surface for it. Swing length is a property of the bat's path to the
ball, and this simulator has no pitch location, no swing decision, no swing/take
model, no count, and no contact point — `plateAppearance()` draws an outcome
from six season-rate buckets and `contactFor()` places the ball by angle and
distance. Every use one could invent for `swing_len` is really a use for the
contact quality it correlates with, and that is `ev`. Coverage is identical to
`bat_speed`'s, i.e. unusable.

**Recommendation: do not plumb it into `data.js`. Keep fetching it.** It costs
nothing extra (the bat-tracking board is fetched anyway for `bat_speed`), and
`coverage.json` reports it as a real bat-tracking column with a 2023 era start —
which is a true and customer-facing statement about what the spine holds.

### `xwoba` — expected wOBA · **do not use in the simulator**

This is the most important "no" in the document, so the reasoning is spelled
out. `sim.js` `plateAppearance(p, rnd, moundDeltaFt, rules)` draws from the
batter's **real observed season rates** — `['BB', p.bb / p.pa]`,
`['HR', p.hr / p.pa]`, `['3B', p.d3 / p.pa]`, `['2B', p.d2 / p.pa]`,
`['1B', singles / p.pa]`, with the remainder split into `K`/`OUT` by
`p.so / p.pa`.

xwOBA is a single scalar that *collapses* exactly those five outcomes plus outs
into one weighted number. Feeding it back into a model already drawing from the
components it was computed from has only two possible results:

- **It duplicates.** If the xwOBA-derived rates are reconciled back to the
  player's actual line, the draw is unchanged and the value did nothing.
- **It contradicts.** If it is allowed to override, every batter's rates move to
  his *deserved* line instead of his real one — which is a different product.
  The published run environment in `README.md` (1 base ≈ 18 runs/game, 7 ≈ 6)
  is a result about the real 2021–2025 seasons. Swapping in expected stats
  invalidates it, reddens `tests/rules-identity.test.js` and
  `tests/ngon.test.js`, and is precisely the move `AGENTS.md` forbids.

There is a legitimate xwOBA-shaped feature — "simulate the season the league
*deserved*" as an explicit, opt-in alternate mode — but that is a product
decision and a second `data.js` payload, not a coverage gap to be closed. It
does not belong in this plan.

**Recommendation: no sim work. Do not add `xwoba` to `data.js`.** Keep it in the
spine, where it is the natural yardstick for the era-rules calibration phase
(see "Why this plan stops at Phase 1" in
`docs/superpowers/plans/2026-09-18-era-rules-phase1.md`) — comparing a rule's
modelled effect against an expected-stat series is a real use, and it is a
`tools/` use, not a browser use.

---

## 2. The `data.js` bottleneck

Every per-player value must reach the browser through `data.js`. It is
generated by `tools/build-data.mjs`, committed, and its box scores are frozen by
`tests/ngon.test.js` and `tests/rules-identity.test.js`.

### Can adding FIELDS to `P()` move a box score? **No. Provably not.**

`P(a)` builds a plain object with eleven named keys: `name, pos, pa, h, d2, d3,
hr, bb, so, spd, hp1`.

The proof is that **nothing in the engine ever enumerates a player object's
keys.** Every consumer names its fields:

- `sim.js` `plateAppearance()` / `adjustedRates()` read `p.pa, p.h, p.d2, p.d3,
  p.hr, p.bb, p.so` by name. The only `Object.keys` calls in `sim.js` are over
  `TUNABLE_DEFAULTS` (line 49) and a rules `mods` object (line 102) — neither is
  a player.
- `graphsim.js` copies runners field-by-field, never by spread:
  `Object.assign({ name, spd, hp1, target }, meta)` at lines 224 and 262, and
  every `entry.moves.push({ name, spd, hp1, path })`.
- `trisim.js`, `ngon.js`, `layout.js` and `fielders.js` never touch a player
  object's key set.
- The frozen `boxOf()` serialises `{away, home, winner, innings, plays}` where
  `away`/`home` are *team* summaries (`abbr, name, color, runs, hits, homers,
  line`) and `plays` are `[type, sub, runs, outsAfter, basesAfter]` — names and
  numbers, never a player object.

So a new key on `P()` is invisible to the RNG stream, to the outcome draw, and
to the serialised box. **The risk is not in the new fields. It is entirely in
re-running the generator**, which refetches the batting lines and the sprint
board and could return different *values* for the existing eleven — 2025 is an
in-progress season that still takes corrections, and unlike the spine builders
`build-data.mjs` passes no `fresh`/`isVolatileSeason` flag, so whether a rebuild
moves depends on whether `data/.cache` happens to be warm. That is not a gate.

Two further hazards worth writing down before anyone regenerates:

- **Lineup membership and club order are load-bearing.**
  `tests/rules-identity.test.js` and `tests/ngon.test.js` both index `TEAMS[0]`
  and `TEAMS[1]` positionally, and `build-data.mjs` selects "the nine batters
  with the most plate appearances". A single corrected PA total can reorder a
  lineup or swap the ninth man, which moves every downstream box score without
  any field being added.
- **`data.js` carries no MLBAM id.** `build-data.mjs` has `p.id` in hand when it
  builds the player record and drops it on the floor when writing `P([...])`.
  Every future per-player join is therefore a *name* join. It happens to be 100%
  clean today (measured: 268/268, 270/270, 270/270, 270/270, 269/269) but it is
  one accent or one "Jr." from silently median-filling a star. Emitting `mlbam`
  is the single cheapest durability win available here.

### The identity gate that must pass before `data.js` is regenerated

`build-data.mjs` already accepts `--out`, so the whole gate can run without ever
writing the committed file:

1. `node tools/build-data.mjs --out <tmp>/data.next.js`
2. A new `tools/check-data-identity.mjs` loads the committed `data.js` and the
   candidate side by side and asserts, **before anything is copied into place**:
   - identical season list, identical club count and club order per season;
   - identical lineup length and identical batter **order** within every lineup;
   - every one of the eleven existing values (`name, pos, pa, h, d2, d3, hr, bb,
     so, spd, hp1`) **exactly equal** — no epsilon, these are integers and
     verbatim floats;
   - the only difference anywhere is the presence of new keys.
3. Only if (2) is clean, copy into place and run `node tools/run-tests.mjs`.
   `tests/rules-identity.test.js` (the golden box scores in
   `tests/fixtures/identity-golden.json`) and `tests/ngon.test.js` (its
   "attaching geometry changes no outcome" and seed-reproducibility checks) are
   the backstop. **They already exist and serve exactly this purpose** — no new
   fixture is needed, and `tests/fixtures/identity-golden.json` must not be
   regenerated. If it goes red, the data moved; that is a refusal, not a fixture
   to recapture.

**Recommended shape: merge, do not rebuild.** Because step (2) can fail for
reasons that have nothing to do with the feature (a late 2025 correction), the
safer implementation is an *augment* pass that reads the committed `data.js`,
joins the new columns on from `data/statcast/*.parquet`, and re-emits with the
eleven existing values copied through verbatim — making step (2) true by
construction rather than by luck. The full `build-data.mjs` rebuild then remains
a separate, deliberate act with its own delta report, exactly as its header
comment already demands.

### A second path worth closing

`tools/build-data.mjs` fetches the sprint-speed leaderboard **directly from
Baseball Savant** and contains no reference to `data/statcast/` or to
`tools/lib/spine.mjs`. The same two numbers therefore have two independent
source paths with independent cache behaviour and independent median-fill logic.
`AGENTS.md` is explicit that the spine is queried through `tools/lib/spine.mjs`
only, and that nothing else reads Parquet. Consolidating `build-data.mjs` onto
the built statcast parquet would remove the drift risk, remove a chunk of
duplicated fetch/median code, and make all nine values available at one join
instead of one value at one fetch. It also introduces a build-order dependency
(`build-statcast.mjs` before `build-data.mjs`) and makes `data.js` unbuildable
without a built spine — a real cost on a fresh clone. **Recommendation: do it,
as part of Task A, but keep the direct fetch as an explicit fallback when
`data/statcast/` is absent.**

---

## 3. Era coverage across the shipped seasons

`data.js` covers **2021–2025**. Board era starts are `speed`/`xstats`/`statcast`
2015, `oaa` 2016, `arm` 2020, `bat-tracking` 2023.

**Available for all five shipped seasons:** `spd`, `hp1`, `xwoba`, `ev`, `la`
(complete, 268–270 of 268–270), and `oaa`/`arm` (era-complete, but structurally
partial at 238–250 and 231–237 of ~270 — the missing men are DHs and
non-qualifiers, not a coverage failure).

**Not available for all shipped seasons:** `bat_speed` and `swing_len`. Zero
rows for 2021 and 2022; 113/270, 130/270 and 161/270 for 2023–2025.

**What the sim should do for a season where a value is missing — one rule:**

> A missing value must make the model reduce **exactly** to today's constant,
> not to a median-filled approximation of it.

2021 must play in 2026 the way it plays today, byte for byte. Concretely: if
`throwSec` gains an `armFts` parameter, `throwSec(ft, null)` must return exactly
`throwSec(ft)`'s current value, and the tests must assert that against a 2021
lineup. This is the same discipline the era-rules phase applied to `rules: null`,
and it is the reason a per-value off switch is cheaper than a median fill.

The counter-precedent is real and should be acknowledged rather than ignored:
`build-data.mjs` **does** median-fill `spd`/`hp1` today and logs the count. That
is defensible for a board returning 560+ rows where ~270 are needed, and where a
fill covers a handful of men. It is not defensible for a season with **zero**
rows, where the "league median" is not a fill but a fabricated number for an
entire era — the same failure mode `AGENTS.md` names for `?? 0` in the
league-row mapping. Fill within a covered season; never fill an uncovered one.

---

## 4. Sequencing

```
Task A  transport (mlbam id + statcast block on P(), identity gate)
        |
        +-- la / ev  -> 3D ball arc            [ALREADY OWNED - ship first]
        |               \_ ev may also touch HIT_FTS; coordinate with below
        |
        +-- oaa / arm -> fielding errors       [LIKELY CLAIMED]
        |               \_ ALSO blocked on: slots have no player identity
        |
        +-- bat_speed -> contactFor()          [gated on the arc work declining ev]

xwoba      no engineering. A decision note, and it stays in the spine.
swing_len  no engineering. Keep fetching it; coverage.json is right to report it.
```

**Why A first, and alone.** Both owned sub-projects need the same three things —
a per-player Statcast block on `P()`, a stable id to join it on, and a gate
proving the addition did not move a box score. Building it twice, in two
branches, against a frozen generated file, is how the published run environment
gets moved by accident.

**Why the arc work second.** `ev`/`la` are the only two values with complete
coverage for every shipped season, so it is the one sub-project that needs no
missing-value policy, no median fill and no off switch. It exercises Task A's
transport end to end and proves it before the harder consumer arrives.

**Why fielding third, and why it is bigger than it looks.** `oaa` and `arm`
attach to a *fielder*, and `fielders.js` has no fielders — it has six geometric
slots assigned by angle, with no link to any shipped batter. That mapping has to
be invented, and it has to stay deterministic or `assignPlay()`'s "No randomness
anywhere" guarantee and every seeded game go with it. The data lookup is the
small half.

---

## 5. Sizing, and what is not worth doing

| piece | size | note |
|---|---|---|
| **Task A** — emit `mlbam` + a Statcast block on `P()`; `tools/augment-data.mjs`; `tools/check-data-identity.mjs`; run the existing identity tests | **4–6 h** | The whole unblock. Do this one. |
| Consolidate `build-data.mjs` onto `data/statcast/*.parquet` via `spine.mjs`, keeping the direct fetch as fallback | **2–3 h** | Do it inside Task A while the file is open. |
| Carry `la`/`ev` (or a precomputed apex) onto the `batted` ball waypoint in `buildAnim()` | **2–3 h** | Belongs to the arc sub-project; sized here because it is transport, not rendering. |
| `la`/`ev` → `arcHeight()` | *owned — not sized here* | ~1 day by the shape of the change; the owner's estimate governs. |
| `oaa`/`arm` → fielding errors | *owned — not sized here* | **2–3 days**, most of it the slot→player identity problem, not the values. |
| `bat_speed` → `contactFor()` bands | 3–4 h | **Not worth doing.** Gated on the arc work declining `ev`. |
| `swing_len` | — | **Not worth doing.** No surface exists. |
| `xwoba` in the sim | — | **Not worth doing.** Duplicates or contradicts the observed rates. |
| The `xwoba` ruling written down where the next person finds it | 30 min | Worth doing, so it is not re-derived. |

**Keep fetching all nine.** "Do not use" means "do not plumb into `data.js`", not
"drop the column". `build-statcast.mjs` is spine-grain, cached with no TTL, and
`coverage.json` is a customer-facing claim about what this project holds.
Deleting a column because the browser sim does not read it would shrink a true
product statement to buy nothing.

## Exit criteria for this plan

This document is complete when a human has ruled on the seven verdicts in the
headline table. It produces no code. Task A gets its own implementation plan,
written against whatever the arc sub-project's owner needs from the transport.

---

## Self-review notes

- The three values in this plan's own territory produced two "no"s and one
  "probably not". That is the honest answer, and it is why the plan's real
  deliverable is Task A rather than a feature.
- Coverage counts are measured from the built spine on this machine, not
  inferred from the board era-start table. The bat-tracking numbers in
  particular (113/270 in 2023) are much worse than the 2023 era start suggests,
  and that measurement is what turned `bat_speed` from "yes, small" into "no".
- The claim that new `P()` fields cannot move a box score was verified by
  grepping every `Object.keys` / `Object.entries` / `Object.values` /
  `Object.assign` / spread / `JSON.stringify` site in the engine, not by reading
  `plateAppearance` alone. Every player-object consumer names its fields.
- Not verified: whether the in-flight fielding-error design has already solved
  the slot→player identity problem. If it has, the "2–3 days" estimate is high.
