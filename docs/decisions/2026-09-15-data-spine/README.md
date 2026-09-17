# Data-spine build ledger — 2026-09-15

The decision record for the sub-project that built `data/` (the spine).
Plan: `docs/superpowers/plans/2026-09-15-data-spine.md`.
Spec: `docs/superpowers/specs/2026-09-15-sim-as-a-service-design.md`.

This lived under `.superpowers/sdd/2026-09-15-data-spine/`, which is ignored by
`.superpowers/sdd/.gitignore` — it existed on one machine only. It is here now
because three source files cite it by path for *why* they are shaped the way
they are (`build-seasons.mjs`, `build-statcast.mjs`, `build-coverage.mjs`), and
a comment that points at an ignored directory points at nothing for everyone
except the person who ran the build.

## What is here

- `progress.md` — the spine of the record: every ruling made during the build,
  each with its cost-if-wrong. Read this first.
- `task-N-brief.md` / `task-N-report.md` — the brief each task agent was given
  and what it reported back. `-addendum.md` files are corrections written after
  a review found the report overstated something; where a report and its
  addendum disagree, **the addendum is the finding that held**.
- `*-report.md` (cache-scope, data-js-fix, manifest-merge, final-fix) — the
  post-merge fixes, each tied to a commit on `main`.

## The review diffs are not committed — regenerate them

Each review in the ledger was taken against a commit range. All 23 endpoints
are ancestors of `main` and pushed to `origin/main`, so the diffs are
reproducible exactly and 416 KB of blobs would only duplicate the object store:

```sh
git diff <range>            # e.g. git diff 348405c..f871a6b
```

| Range | Commits |
|---|---|
| `8891455..8ff096f` | docs: frozen-data.js rule; feat: spine orchestrator + docs |
| `8ff096f..2f05137` | fix: close the gaps the whole-branch review found |
| `ef32f37..1ee34ab` | build: duckdb dependency and portable test runner |
| `1ee34ab..ec1f7bb` | refactor: extract cached fetch helpers into `tools/lib/fetch.mjs` |
| `ec1f7bb..9d8acf1` | fix: prevent cache poisoning, add refresh hatch + cache stats |
| `9d8acf1..d829c79` | feat: season-line parquet 1876+, batters and pitchers |
| `d829c79..54c5c0b` | test: duplicate-row regression to full stat line |
| `54c5c0b..1aaf69d` | fix: narrow per-club try to the fetch, add a build manifest |
| `673dba0..f265c60` | feat: chadwick register id crosswalk parquet |
| `f265c60..27db09b` | fix: player crosswalk robustness |
| `27db09b..b89efb1` | feat: statcast tracking parquet 2015+ with schema-drift guards |
| `b89efb1..348405c` | fix: assert every statcast year present, not just each board's first |
| `348405c..f871a6b` | feat: coverage.json measured from the written parquet |
| `f871a6b..1335770` | fix: provenance strings; derive widest-column set |
| `f871a6b..e5cd77e` | fix: schema-derived widest column, grain-aware `team_totals` |
| `1335770..60314bc` | feat: spine query layer and the pure intake coverage guard |
| `60314bc..4006f20` | fix: SQL-injection hole in `spine.mjs` query methods |
| `60314bc..241751e` | fix: derive source from dataset, filter widest candidates by type |
| `4006f20..687c651` | fix: prototype-pollution gap in `sigma`'s stat guard |
| `687c651..4247aa2` | feat: spine orchestrator, document the data lake |

## Status

The spine is built and its three gates hold (`_build.json complete`,
`build-coverage.mjs` refusal, `openSpine()` refusal — see `AGENTS.md`).
Follow-on work, newest last:

- `kpi-coverage.md` — scoping `coverage.json` to the spec's full KPI list
  (3 of 11 certified → 10).
- `game-level-dataset.md` — `data/games/`, the team-game dataset that closed
  the eleventh (10 → **11 of 11**), and the three structural bugs its tests
  caught in a dataset that already looked right.
