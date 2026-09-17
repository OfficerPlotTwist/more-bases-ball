# data.js traded-player double-count — fix report

**Date:** 2026-09-16 · **Branch:** `main` · **Scope:** `tools/build-data.mjs`, `data.js`, `package.json`

## The bug

`tools/build-data.mjs` read `stats.splits[0]` and stamped it with whichever club's
roster fetch returned it. For a player traded mid-season `splits[0]` is the
COMBINED season line (it carries `numTeams`), not that club's line — so a traded
player appeared in BOTH clubs' lineups carrying his full-season totals.

95 affected player-seasons across 2021-2025, touching all 30 clubs.

## The fix

Mirrored the already-proven fix from `tools/build-seasons.mjs` (`ownSplit`, ~line 51,
plus `,team` on the hydrate). Two parts, both required — without `,team` on the
hydrate `split.team` is absent on every split and the club match silently finds
nothing.

### Diff to tools/build-data.mjs

```diff
diff --git a/tools/build-data.mjs b/tools/build-data.mjs
index 04ee40e..eb56c48 100644
--- a/tools/build-data.mjs
+++ b/tools/build-data.mjs
@@ -3,26 +3,16 @@
  *   node tools/build-data.mjs [firstYear] [lastYear]      (default 2021 2025)
  *
  * ---------------------------------------------------------------------------
- * DO NOT RUN THIS. data.js is frozen, and this script has a known bug.
+ * Rerunning this REGENERATES data.js, the committed slice the browser sim
+ * loads. Its run environment is a published result — the runs/game figures in
+ * README.md and the box score tests/ngon.test.js asserts — so a rebuild moves
+ * numbers a reader may have already seen. Re-measure and report the delta
+ * rather than quietly shipping it.
  *
- * 1. data.js is frozen. It is the committed slice the browser sim loads, and
- *    its run environment is a PUBLISHED result — the runs/game figures in
- *    README.md (1 base ~18 runs/game, 7 bases ~6) and the byte-identical box
- *    score tests/ngon.test.js asserts. Regenerating data.js moves those
- *    numbers under the reader and turns the suite red. Regenerating it from
- *    the spine is a later sub-project, gated by a golden-run identity test.
- *
- * 2. This script double-counts traded players. The hydrate below asks for
- *    season hitting stats WITHOUT `,team)`, so `stats.splits[0]` (see the
- *    `split` line further down) is the player's COMBINED season line, and it
- *    gets stamped on whichever club happened to fetch him — 18 affected
- *    players in 2024 alone. tools/build-seasons.mjs fixes this with its
- *    `ownSplit` helper plus a `,team)` on the hydrate; this file was left
- *    unfixed deliberately, because fixing it would change data.js.
- *
- * So running this both unfreezes data.js and reintroduces the traded-player
- * double-count. The npm script is named `build:data:frozen-do-not-run` for
- * the same reason. Use tools/build-seasons.mjs for the data spine instead.
+ * The traded-player double-count this script used to carry is FIXED: the
+ * hydrate asks for `,team)` and `ownSplit` below picks the club's own split.
+ * Do not drop either half — see the comment on ownSplit for why a lone
+ * team-labelled split must never be accepted as a fallback.
  * ---------------------------------------------------------------------------
  *
  * Two sources, joined on MLBAM player id — an exact join, never name matching:
@@ -66,6 +56,24 @@ const COLORS = {
 const esc = (s) => JSON.stringify(String(s));
 const NL = '\n';
 
+/* A traded player's splits[0] is the COMBINED season total (carries
+ * numTeams), not that club's line — per-club lines are splits[1..N]. The
+ * hydrate must ask for `team` on the stat split or `split.team` is absent
+ * everywhere and a club-id match finds nothing. Never fall back to a
+ * numTeams-bearing split: a combined line attributed to one club is the
+ * exact bug this exists to prevent. Mirrors tools/build-seasons.mjs. */
+function ownSplit(stats, clubId) {
+  const splits = (stats && stats.splits) || [];
+  const own = splits.find((s) => s.team && s.team.id === clubId);
+  /* A lone split may only be used as a fallback if it carries NO team at
+   * all. If it names a team, that team must match clubId — a roster spot
+   * fetched from a DIFFERENT club can return the same single split and it
+   * must not be accepted just because it's the only split present. */
+  const teamless = splits.length === 1 && !splits[0].team && !splits[0].numTeams
+    ? splits[0] : null;
+  return own || teamless || null;
+}
+
 const seasons = {};
 for (const year of YEARS) {
   const list = await getJson(
@@ -75,12 +83,12 @@ for (const year of YEARS) {
   const rows = await pool(clubs, 4, async (club) => {
     const url = `https://statsapi.mlb.com/api/v1/teams/${club.id}/roster`
       + `?season=${year}&rosterType=fullSeason`
-      + `&hydrate=person(stats(type=season,group=hitting,season=${year}))`;
+      + `&hydrate=person(stats(type=season,group=hitting,season=${year},team))`;
     const j = await getJson(url);
     const players = [];
     for (const spot of j.roster || []) {
       const stats = spot.person && spot.person.stats && spot.person.stats[0];
-      const split = stats && stats.splits && stats.splits[0];
+      const split = ownSplit(stats, club.id);
       const st = split && split.stat;
       const pos = spot.position && spot.position.abbreviation;
       if (!st || !st.plateAppearances || pos === 'P') continue;
```

`package.json`: `build:data:frozen-do-not-run` renamed back to `build:data`, the
freeze being lifted.

## Backup of the old data.js

The pre-fix working-tree `data.js` (including the user's uncommitted state) was
copied before anything was regenerated, to:

```
C:\Users\nik\AppData\Local\Temp\claude\C--Users-nik-Documents-AI-more-bases-ball\cee1895b-8455-4399-9fa6-b2e6f6162d9d\scratchpad\data.js.pre-fix-backup
```

Note: inspecting `git diff data.js` showed the user's uncommitted edits were
themselves a prior output of this same generator (the 2021-2025 multi-season
form; the committed HEAD version is the older hand-written 2024-only file). So
the regeneration supersedes a generated file with a corrected generated file
rather than discarding hand work. The backup preserves it either way.

## Run environment — before vs after

NYY vs LAD, seed 1234, 3000 games per configuration, via
`SIM.simMany(A, B, {bases}, 3000, 1234)`.

| bases | before (runs/team-game) | after | before (both teams) | after |
|------:|------------------------:|------:|--------------------:|------:|
| 1 | 9.19 | **9.26** | 18.4 | **18.5** |
| 2 | 6.40 | **6.40** | 12.8 | **12.8** |
| 3 | 4.86 | **4.89** |  9.7 |  **9.8** |
| 4 | 3.97 | **4.00** |  7.9 |  **8.0** |
| 5 | 3.59 | **3.59** |  7.2 |  **7.2** |
| 6 | 3.38 | **3.40** |  6.8 |  **6.8** |
| 7 | 3.29 | **3.27** |  6.6 |  **6.5** |

The curve barely moved — every point shifted by at most 0.07 runs/team-game.

### README impact — NOT edited, user's decision

README lines 23 and 176-177 publish "1 base ≈ 18 runs/game, 7 bases ≈ 6". Both
still hold after the fix: 1 base is 18.5 both-teams (was 18.4), 7 bases is 6.5
(was 6.6). **No README edit was made.** Whether to refresh the figures is the
user's call; as approximations they remain accurate.

## Duplicate counts — before vs after

Counted as: a player name appearing in two or more clubs' lineups in the same
season with an identical PA value.

| season | before | after |
|-------:|-------:|------:|
| 2021 | 23 | 0 |
| 2022 | 18 | 0 |
| 2023 | 17 | 0 |
| 2024 | **18** | **0** |
| 2025 | 19 | 0 |
| **total 2021-2025** | **95** | **0** |

Both pre-fix figures reproduced the numbers supplied in the brief exactly
(18 for 2024, 95 across the span) before any change was made.

## Soler spot-check

Before: `ATL:574  SF:574` (the combined line, stamped twice).

After: `SF:392` only.

Verified directly against the Stats API
(`people/624585?hydrate=stats(type=season,group=hitting,season=2024,team)`):

```
COMBINED numTeams=2 PA=574
SF       numTeams=-  PA=392
ATL      numTeams=-  PA=182
```

392 + 182 = 574, matching his old combined figure. He correctly appears only
under SF; his 182-PA ATL leg did not crack ATL's top nine by plate appearances,
which is the documented selection rule ("the nine batters with the most plate
appearances"). This is the fix working, not a dropped player.

## Structural checks

Regenerated `data.js` parses, and for every season 2021-2025: 30 clubs, nine
batters each. Build log reported `sprint matched 270  median-filled 0` for all
five years — every batter carries his own measured Statcast numbers, none fell
back to a league median, and no club was flagged THIN.

## Tests

`node tools/run-tests.mjs` → **19/19 test files passed**, both before and after.
`tests/ngon.test.js` and `tests/sim.test.js` are green. No test was modified or
adjusted to accommodate the new data.

## Things I was unsure about

- **`tests/ngon.test.js` byte-identical box score.** AGENTS.md describes it as
  asserting the box score is byte-identical across the ngon/sim boundary. It
  passed, so the assertion is internal-consistency (sim vs ngon on the same
  data), not a golden snapshot pinned to specific data values. Worth confirming
  that reading is right.
- **The 2025 season slice.** 2025 lines were fetched live and are treated as a
  complete season by the builder. If that season is not final at the source, the
  2025 rows will drift on any future rebuild.
- **README figures left alone**, per instruction. They happen to still be
  accurate, but the underlying numbers did move slightly.
- **Roster churn beyond the duplicate fix.** Correcting the splits changed which
  nine batters lead some clubs by PA, so a handful of lineups differ by more than
  just corrected stat lines. That is the intended consequence, but it means the
  diff to `data.js` is wider than 95 rows.

———
Generated by claude-opus-5 · task completed
