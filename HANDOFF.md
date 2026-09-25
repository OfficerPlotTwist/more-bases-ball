# Handoff — 2026-09-25

State of the repo for whoever picks it up next, human or agent.
Read `AGENTS.md` first; it holds the rules that bite. This file holds the
things that are true only right now.

## Where things stand

| Branch | State | Next move |
|---|---|---|
| `main` | pushed, green, 26/26, **includes fielding errors** | — |
| `plan/statcast-coverage` | a plan document only, no code | read it, decide |

PR #1 (fielding errors) was merged on 2026-09-25 as `163cd51`; its branch and
`feat/era-rules-phase1` are deleted locally and on the remote. The errors model
is on `main` and still **off by default** (`cfg.errors`), so nothing
user-visible changed with the merge.

`git log --oneline` on `main` back to `d10fdf5` covers the data spine, the
mobile pass, and era-rules phase 1.

## What was built, in one line each

- **Era rules, phase 1** (merged). A 112-rule catalog 1876-2026 as a
  generated module, composition of per-rate multipliers with validated
  coefficients, `leagueLine(year)` on the spine, and a `rules` object threaded
  through all three engines. Nothing user-visible: the phase's whole
  deliverable is the safety net for phases 2 and 3.
- **Fielding errors** (PR #1). Errors derived from the travel-time margin the
  defense already computes. Off by default.
- **Mobile pass** (merged). The page is usable on a phone; the 3D field
  accepts touch.

## The live URL

The simulator is hosted as a private Claude Artifact:
https://claude.ai/artifact/HBx9C21FjEULvDCA1suJ5z

It is a **snapshot from before the era-rules and errors work** — it is not
rebuilt automatically. Republishing means re-running the Artifact publish with
the current `index.html` and its supporting files. A clickable launcher sits in
`C:\Users\nik\Documents\AI\Busdriver\dashboard\`.

## What to do next, in the order I would do it

1. **Era rules phase 2.** The plan does not exist yet; write it against the
   real API phase 1 produced. Three things MUST be in it, all of them carried
   forward deliberately:
   - Add a golden fixture case with a NON-ZERO mound delta. The composition
     `adjustedRates -> applyModifiers` is currently untested end to end, and
     phase 2's coefficients are the first thing to exercise it.
   - Decide ONE bucket name for Tier A — `structural` or `tunables` — and
     wire it. Both keys exist and are empty; two names for one bucket is how a
     coefficient becomes a silent no-op.
   - Calibrate the twelve largest documented effects. §5.4 of the era spec
     holds the confound policy; 2022's universal DH is the case that breaks a
     naive "reproduce the year-over-year delta" test, because real 2022 offense
     FELL while the DH's own effect was positive.
2. **Statcast coverage.** `plan/statcast-coverage` says the highest-value work
   is not any of the seven unused values but the shared transport: `data.js`
   emits no MLBAM id and no Statcast block past `spd`/`hp1`, and both the
   launch-angle and per-fielder-skill sub-projects are blocked on that one
   change. 4-6 hours.
3. **Real Statcast launch angle** (user-requested, spec'd nowhere yet). `la`
   is already fetched by `tools/build-statcast.mjs`; it just never reaches the
   browser. `field3d.js`'s `arcHeight()` has no physics in it at all — the
   homer arc is literally `par * Math.min(150, distFt * 0.27)`. Adding fields
   to `P()` provably cannot move a box score (nothing enumerates a player
   object's keys), so the existing identity fixtures are the regen gate.

## Known-wrong things nobody has fixed

None of these are bugs in the sense of "the code does not do what it says".
They are places where the model is honestly incomplete and the incompleteness
is written down rather than hidden.

- **Reached-on-error is 100%**, against a real ~83%. The recovered-error case
  (batter still out, or only a runner advances) needs a counterfactual
  evaluated. It undercounts rather than overcounts, so calibration is intact.
- **`slack` and `groundSlack` are on different scales** but share one gate and
  one decay constant, giving a 42/58 ground/fly error split where the real
  world puts outfielder errors in single digits.
- **`ORDINARY_S = 0.25` is judgement.** No source gives the ordinary-effort
  boundary in seconds. Re-fitting across 0.15/0.25/0.40 moves `e0` by under
  4%, so the calibration is NOT evidence that 0.25 is right.
- **`entry.type` stays `'OUT'` on a reach-on-error.** Correct for the box
  score; misleading to any consumer grouping by type. There is no UI surface
  for errors at all yet — `ui.js` renders one as a plain out.
- **`ERROR_E0` is exported but consumed by nothing** in the shipped path.
  Whoever flips the default has to wire it.
- **`data.js` still ships 2021-2025 only.** Era mode means modern players under
  old rules. The spine has the real 1927 players whenever that changes.

## Repo hygiene

- **`core.autocrlf=true` with no `.gitattributes`**, so committed blobs carry
  CRLF — `sim.js` and `data.js` have carried it since long before this work.
  A `* text=auto eol=lf` normalisation is worth doing, but it rewrites every
  file and must be its own commit or it buries whatever rides along with it.
- **Untracked and deliberately so:** `onlyprompts.json`, `onlyprompts-raw.json`
  (tool artifacts) and `ATTRIBUTION.md` (hook-generated — note its one row
  records this repo's OWN remote as a third-party source, with the shell
  redirect `2>&1` captured as the git ref, so the hook that writes it has a
  parsing bug worth looking at).
- **`data/` is gitignored and must stay so.** Rebuild with
  `node tools/build-spine.mjs` — warm ~30s, cold a few minutes. Spine tests
  skip cleanly without it, so a fresh clone with no network still shows green.

## The one process lesson worth carrying

Five task reviews passed on the fielding-errors branch. Every task built
exactly what its brief specified. The design was still wrong — 55% of charged
errors landed on balls the fielder caught, and the batter was out on 100% of
them. Task-scoped review cannot catch a brief that was wrong; only a
whole-branch reviewer asking "is this actually baseball?" found it, and it
found it by instrumenting the engine and counting outcomes, not by reading
code.

If you take one habit from this repo, take that one: for anything statistical,
measure the output distribution before believing the implementation.

———
Generated by claude-opus-5 · task completed
