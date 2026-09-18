# Era Rules — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the era-rules foundation — the 112-rule catalog as a loadable module, a league-line query on the spine, and engine parameters threaded through `sim.js` — while proving with committed fixtures that the default simulation is byte-for-byte unchanged.

**Architecture:** A new pure IIFE (`rules.js`) holds the catalog and resolves a year or a hand-picked selection into `{structural, modifiers, declared}`. The engines gain an appended, default-null `rules` parameter that takes the legacy code path when falsy. Nothing is user-visible in this phase; its entire deliverable is the safety net that makes phases 2 and 3 possible.

**Tech Stack:** Vanilla ES2020 in browser-compatible IIFEs (CommonJS `module.exports` fallback for tests), Node 20+ test scripts using the project's hand-rolled `check()` harness, DuckDB via `tools/lib/spine.mjs` for spine queries.

**Spec:** `docs/superpowers/specs/2026-09-18-era-rules-design.md`

## Why this plan stops at Phase 1

Phase 2 calibrates twelve rules against historical deltas. The shape of a
coefficient — which of the six rates it touches, how multipliers compose, what
the clamps do at extreme values — is not knowable until `applyModifiers` exists
and the identity fixtures prove the engine is untouched. Tasks written for
phase 2 today would be guesses dressed as instructions. Phase 2 gets its own
plan, written against the real API this phase produces.

## Global Constraints

- **Byte-identity is the hard gate.** With `rules` falsy, `simGame` output must be identical to the fixtures captured in Task 1. Any task that reddens `tests/rules-identity.test.js` is rejected, not patched.
- **Never restructure `sim.js:96`.** `(hitValue === 1 && rnd() < 0.32) || (hitValue === 2 && rnd() < 0.22)` consumes 1 draw on a single, 1 on a double, 0 on a triple or homer. Changing the *thresholds* is in scope; changing the *expression shape* is forbidden.
- **Never insert a row into the `events` array** at `sim.js:75-81`. New outcomes are branch-gated, never rate-gated.
- **A rules object must never be truthy-by-default on the classic path.** `DEFAULT_CFG.rules` is `null`.
- **`data.js` is not touched.** It is generated, its box scores are frozen, and `tests/ngon.test.js` asserts them.
- **No new runtime dependencies.** `package.json` gains nothing. DuckDB is already present for spine work.
- **Write LF line endings**, forward-slash paths in code, no `C:\` literals — the repo is Windows-now, Linux-later.
- **All test files must pass** via `node tools/run-tests.mjs`. Count goes 22 → 25 across this phase (catalog, resolve, identity); phase 2 adds direction and calibration for 27 in total.
- **IIFE pattern:** every new browser file follows `(function (global) { 'use strict'; ... if (typeof module !== 'undefined' && module.exports) module.exports = API; else global.MBB_X = API; })(typeof window !== 'undefined' ? window : globalThis);`
- **Test style:** CommonJS `require`, the local `check(label, ok, detail)` helper, `process.exit(failures === 0 ? 0 : 1)` at the end. Copy the shape from `tests/mound.test.js`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `rules.js` | create | The catalog, tier assignment, and pure resolution of year → rules. No engine imports. |
| `tools/capture-identity.mjs` | create | One-shot fixture generator. Records current engine output before any engine edit. |
| `tests/fixtures/identity-golden.json` | create | The committed baseline. Generated once, never hand-edited. |
| `tests/rules-catalog.test.js` | create | Catalog integrity: counts, required fields, tier assignment, no duplicate ids. |
| `tests/rules-identity.test.js` | create | The freeze guard. Fixtures, stream identity, Tier-C-is-inert. |
| `tests/rules-resolve.test.js` | create | Pure resolution: composition, order-independence, year filtering. |
| `sim.js` | modify | Appended `rules` params; `DEFAULT_CFG.rules`; parameterized literals; `applyModifiers`. |
| `graphsim.js` | modify | Mirror `cfg.rules` onto `geo`; forward to `plateAppearance`. |
| `trisim.js` | modify | Same two changes. |
| `ui.js` | modify | `readCfg()` returns `rules: null`. |
| `tools/lib/spine.mjs` | modify | Add `leagueLine(year)`. |
| `tests/spine-query.test.js` | modify | Cover `leagueLine` guards and shape. |
| `docs/superpowers/specs/2026-09-18-era-rules-design.md` | modify | Correct the test-file count (three new files → five). |

**Note on the spec deviation:** §6 of the spec names three new test files (identity, direction, calibration). This plan needs two more — catalog integrity and resolution algebra — because a catalog typo, a composition bug and an engine regression are three different failures with three different fixes. Five new files, 27 at project completion. Task 2 updates the spec's counts so the two documents agree.

---

### Task 1: Capture the identity baseline

This task must run **before any engine edit exists**. Its whole value is that
the fixtures are provably from untouched code.

**Files:**
- Create: `tools/capture-identity.mjs`
- Create: `tests/fixtures/identity-golden.json`
- Create: `tests/rules-identity.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/fixtures/identity-golden.json` — `{ generatedFrom: <git sha>, cases: [{ seed, cfg, box }] }` where `box` is a JSON string. Task 5 and Task 6 both assert against it.

- [ ] **Step 1: Confirm the working tree is clean and the engine is untouched**

```bash
git status --short
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: no modifications to `sim.js`, `graphsim.js`, `trisim.js`; `22/22 test files passed`. If the tree is dirty with engine changes, stop — the fixtures would bake in a change.

- [ ] **Step 2: Write the fixture generator**

Create `tools/capture-identity.mjs`:

```js
/* One-shot: record the classic engine's exact output so later work can
 * prove it did not move. Regenerating this file is a deliberate act --
 * if a fixture changes, the engine changed. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { TEAMS } = require(path.join(ROOT, 'data.js'));
const SIM = require(path.join(ROOT, 'sim.js'));

const LAD = TEAMS[0];
const NYY = TEAMS[1];

// Mirrors boxOf() in tests/ngon.test.js: the full play log, not just the score.
function boxOf(g) {
  return JSON.stringify({
    away: g.away,
    home: g.home,
    winner: g.winner,
    innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter, e.basesAfter]),
  });
}

const CFGS = [
  { bases: 3, innings: 9, outs: 3 },
  { bases: 3 },
  { bases: 1, innings: 9, outs: 3 },
  { bases: 7, innings: 9, outs: 3 },
  { bases: 4, innings: 12, outs: 5 },
];
const SEEDS = [7, 42, 99, 1234, 20260918];

const cases = [];
for (const cfg of CFGS) {
  for (const seed of SEEDS) {
    cases.push({ seed, cfg, box: boxOf(SIM.simGame(NYY, LAD, cfg, seed)) });
  }
}

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })
  .toString().trim();

const out = path.join(ROOT, 'tests', 'fixtures', 'identity-golden.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedFrom: sha, cases }, null, 2) + '\n', 'utf8');
console.log(`wrote ${cases.length} cases from ${sha.slice(0, 8)} -> ${path.relative(ROOT, out)}`);
```

- [ ] **Step 3: Generate the fixtures**

```bash
node tools/capture-identity.mjs
```

Expected: `wrote 25 cases from <sha> -> tests/fixtures/identity-golden.json`

- [ ] **Step 4: Write the identity test**

Create `tests/rules-identity.test.js`:

```js
/* The freeze guard. Run: node tests/rules-identity.test.js
 *
 * These fixtures were captured from the engine before the era-rules
 * parameters existed. If a case fails, the default simulation moved --
 * that is a regression, not a fixture to regenerate. */
'use strict';
const fs = require('fs');
const path = require('path');
const { TEAMS } = require(path.join(__dirname, '..', 'data.js'));
const S = require(path.join(__dirname, '..', 'sim.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const LAD = TEAMS[0], NYY = TEAMS[1];

function boxOf(g) {
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter, e.basesAfter]),
  });
}

const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'identity-golden.json'), 'utf8'));

let moved = 0;
for (const c of golden.cases) {
  if (boxOf(S.simGame(NYY, LAD, c.cfg, c.seed)) !== c.box) moved++;
}
check(`${golden.cases.length} golden box scores unchanged`, moved === 0,
  moved ? `${moved} case(s) diverged` : `captured from ${golden.generatedFrom.slice(0, 8)}`);

// plateAppearance must consume the same stream however the trailing
// no-op arguments are spelled.
const judge = NYY.lineup[2];
const variants = [
  ['(p, rnd)', (p, r) => S.plateAppearance(p, r)],
  ['(p, rnd, 0)', (p, r) => S.plateAppearance(p, r, 0)],
  ['(p, rnd, 0, null)', (p, r) => S.plateAppearance(p, r, 0, null)],
  ['(p, rnd, undefined, null)', (p, r) => S.plateAppearance(p, r, undefined, null)],
];
for (let v = 1; v < variants.length; v++) {
  const a = S.mulberry32(7), b = S.mulberry32(7);
  let same = true;
  for (let i = 0; i < 5000; i++) {
    if (variants[0][1](judge, a) !== variants[v][1](judge, b)) { same = false; break; }
  }
  check(`stream identical: ${variants[0][0]} vs ${variants[v][0]}`, same);
}

// The exact call tests/sim.test.js:24-25 relies on must still merge to a
// falsy rules value.
const merged = Object.assign({}, S.DEFAULT_CFG, { bases: 3 });
check('DEFAULT_CFG merge leaves rules falsy', !merged.rules,
  `rules = ${JSON.stringify(merged.rules)}`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 5: Run it — it must pass immediately**

```bash
node tests/rules-identity.test.js
```

Expected: PASS on all checks. The 4-argument variants already work because JS
ignores extra arguments, and `merged.rules` is `undefined`, which is falsy.
This is the one test in the plan that is green before its feature exists —
that is correct, because it is a regression guard, not a feature test.

- [ ] **Step 6: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `23/23 test files passed`

- [ ] **Step 7: Commit**

```bash
git add tools/capture-identity.mjs tests/fixtures/identity-golden.json tests/rules-identity.test.js
git commit -m "test: freeze the classic engine's output before era-rules work

25 golden box scores across 5 seeds and 5 configs, captured from the
engine as it stands. The plate-appearance stream is also pinned against
the trailing no-op arguments the rules layer will add.

If a case here fails later, the default simulation moved. That is a
regression to fix, not a fixture to regenerate."
```

---

### Task 2: The catalog module

**Files:**
- Create: `rules.js`
- Create: `tests/rules-catalog.test.js`
- Modify: `docs/superpowers/specs/2026-09-18-era-rules-design.md` (test counts)

**Interfaces:**
- Consumes: `docs/decisions/2026-09-18-era-rules/rules-catalog.json` (committed in `72fe5eb`).
- Produces:
  - `MBB_RULES.CATALOG` — frozen array of rule objects, each with `id` (string, `"<year>-<slug>"`), `year`, `league`, `name`, `what_changed`, `category`, `measured_effect`, `modelable_per_pa`, `confidence_year`, `confidence_effect`, `tier` (`'A' | 'B' | 'C'`).
  - `MBB_RULES.TIERS` — `{ A: string[], B: string[], C: string[] }` of rule ids.
  - `MBB_RULES.byId(id)` — rule object or `undefined`.
  - `MBB_RULES.forYear(year)` — `{ year, active: rule[] }`, rules whose `year <= year`, sorted ascending by year then id.

- [ ] **Step 1: Write the failing test**

Create `tests/rules-catalog.test.js`:

```js
/* Catalog integrity. Run: node tests/rules-catalog.test.js */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'rules.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

check('112 rules', R.CATALOG.length === 112, `${R.CATALOG.length}`);

const REQUIRED = ['id', 'year', 'league', 'name', 'what_changed', 'category',
  'measured_effect', 'modelable_per_pa', 'tier'];
const missing = R.CATALOG.filter((r) => REQUIRED.some((k) => r[k] === undefined));
check('every rule has every required field', missing.length === 0,
  missing.length ? `first gap: ${JSON.stringify(missing[0])}` : '');

const ids = R.CATALOG.map((r) => r.id);
check('ids are unique', new Set(ids).size === ids.length,
  `${ids.length - new Set(ids).size} duplicate(s)`);

const badYear = R.CATALOG.filter((r) => !Number.isInteger(r.year) || r.year < 1876 || r.year > 2026);
check('years are integers in 1876-2026', badYear.length === 0,
  badYear.length ? `${badYear[0].id}` : '');

const badTier = R.CATALOG.filter((r) => !['A', 'B', 'C'].includes(r.tier));
check('every rule has tier A, B or C', badTier.length === 0,
  badTier.length ? `${badTier[0].id} -> ${badTier[0].tier}` : '');

// Tier C is defined as "cannot be simulated". A rule that is both
// quantified and modelable has no business being there.
const wrongC = R.TIERS.C
  .map((id) => R.byId(id))
  .filter((r) => r.modelable_per_pa === 'yes' &&
    String(r.measured_effect).toLowerCase() !== 'unquantified');
check('no tier C rule is both quantified and modelable', wrongC.length === 0,
  wrongC.length ? `${wrongC[0].id}` : '');

// Tier B is the calibratable set: quantified AND modelable.
const wrongB = R.TIERS.B
  .map((id) => R.byId(id))
  .filter((r) => r.modelable_per_pa === 'no' ||
    String(r.measured_effect).toLowerCase() === 'unquantified');
check('every tier B rule is quantified and modelable', wrongB.length === 0,
  wrongB.length ? `${wrongB[0].id}` : '');

check('tiers partition the catalog',
  R.TIERS.A.length + R.TIERS.B.length + R.TIERS.C.length === R.CATALOG.length,
  `A${R.TIERS.A.length} + B${R.TIERS.B.length} + C${R.TIERS.C.length}`);

const y1968 = R.forYear(1968).active;
check('forYear(1968) excludes later rules',
  y1968.every((r) => r.year <= 1968) && y1968.length > 0, `${y1968.length} active`);
check('forYear(1968) includes the 1963 zone change',
  y1968.some((r) => r.year === 1963 && /strike zone/i.test(r.name)));
check('forYear(1968) excludes the 1969 mound change',
  !y1968.some((r) => r.year === 1969));
check('forYear is sorted ascending by year',
  y1968.every((r, i) => i === 0 || y1968[i - 1].year <= r.year));

check('catalog is frozen', Object.isFrozen(R.CATALOG));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/rules-catalog.test.js
```

Expected: FAIL — `Cannot find module '.../rules.js'`

- [ ] **Step 3: Generate the catalog data block**

The catalog JSON lives in `docs/`, which the browser does not serve. Inline it
into `rules.js` with a generator so it is never hand-copied:

Create `tools/build-rules.mjs`:

```js
/* Inline the committed rules catalog into rules.js. The browser does not
 * serve docs/, and a hand-copied catalog would drift from the ledger. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'docs', 'decisions', '2026-09-18-era-rules', 'rules-catalog.json');
const OUT = path.join(ROOT, 'rules.js');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

const seen = new Map();
const rules = raw.rules.map((r) => {
  let id = `${r.year}-${slug(r.name)}`;
  const n = (seen.get(id) || 0) + 1;
  seen.set(id, n);
  if (n > 1) id = `${id}-${n}`;

  const quantified = String(r.measured_effect).trim().toLowerCase() !== 'unquantified';
  // Tier A is assigned by hand below; everything else falls out of the data.
  const tier = quantified && r.modelable_per_pa === 'yes' ? 'B' : 'C';

  return {
    id, year: r.year, league: r.league, name: r.name,
    what_changed: r.what_changed, category: r.category,
    measured_effect: r.measured_effect, model_note: r.model_note || null,
    modelable_per_pa: r.modelable_per_pa,
    confidence_year: r.confidence_year, confidence_effect: r.confidence_effect,
    single_source: !!r.single_source,
    tier,
  };
});

// Tier A: expressible as game state, not as a rate. These are named
// explicitly because "structural" is a fact about this engine, not about
// the rule, and no field in the catalog can infer it.
const TIER_A = new Set(rules.filter((r) =>
  /automatic runner on second/i.test(r.name) ||
  /seven-inning doubleheader/i.test(r.name) ||
  /all runs count on a game-ending/i.test(r.name) ||
  /designated hitter/i.test(r.name)
).map((r) => r.id));
for (const r of rules) if (TIER_A.has(r.id)) r.tier = 'A';

const body = `/* moreBasesBall — the rules catalog and era resolution.
 *
 * 112 significant MLB rules changes, 1876-2026, from 27 sources. Pure data
 * and pure functions: this file imports nothing and cannot perturb a
 * simulation by being loaded.
 *
 * Tier A  structural — expressible as game state (innings, outs, lineup)
 * Tier B  rate       — a perturbation of the per-PA event distribution
 * Tier C  declared   — real, in effect, and not simulable by this engine
 *
 * Tier C ships visible rather than omitted, for the reason coverage.json
 * never omits an unavailable KPI: an absent entry reads as "this did not
 * exist", which is a different and wrong statement.
 *
 * GENERATED — rebuild with \`node tools/build-rules.mjs\`, do not hand-edit.
 * Source of truth: docs/decisions/2026-09-18-era-rules/rules-catalog.json
 */
(function (global) {
  'use strict';

  const CATALOG = Object.freeze(${JSON.stringify(rules, null, 2)}.map(Object.freeze));

  const BY_ID = new Map(CATALOG.map((r) => [r.id, r]));

  const TIERS = Object.freeze({
    A: Object.freeze(CATALOG.filter((r) => r.tier === 'A').map((r) => r.id)),
    B: Object.freeze(CATALOG.filter((r) => r.tier === 'B').map((r) => r.id)),
    C: Object.freeze(CATALOG.filter((r) => r.tier === 'C').map((r) => r.id)),
  });

  function byId(id) { return BY_ID.get(id); }

  // Every rule in force in a given season: adopted that year or earlier.
  // Repeals are their own catalog entries (1931 abolishes the sacrifice
  // fly, 1954 reinstates it), so this is a cumulative list, not a diff.
  function forYear(year) {
    if (!Number.isInteger(year)) throw new TypeError('year must be an integer');
    const active = CATALOG.filter((r) => r.year <= year)
      .sort((a, b) => (a.year - b.year) || (a.id < b.id ? -1 : 1));
    return { year, active };
  }

  const API = { CATALOG, TIERS, byId, forYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MBB_RULES = API;
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(OUT, body, 'utf8');
console.log(`wrote ${rules.length} rules -> rules.js (A${
  rules.filter((r) => r.tier === 'A').length} B${
  rules.filter((r) => r.tier === 'B').length} C${
  rules.filter((r) => r.tier === 'C').length})`);
```

- [ ] **Step 4: Generate and run**

```bash
node tools/build-rules.mjs
node tests/rules-catalog.test.js
```

Expected: generator prints the tier split; test PASSES all checks.

If `tiers partition the catalog` fails, a rule matched two Tier A patterns —
fix the patterns, not the test.

- [ ] **Step 5: Correct the spec's test counts**

The spec says three new test files; this plan adds four.

```bash
cd "$(git rev-parse --show-toplevel)"
sed -i 's/^Three new files, joining the existing 22\./Five new files, joining the existing 22./' docs/superpowers/specs/2026-09-18-era-rules-design.md
sed -i 's/Exit: 23 test files pass (22 existing plus the identity/Exit: 25 test files pass (22 existing plus catalog, resolve and identity/' docs/superpowers/specs/2026-09-18-era-rules-design.md
sed -i 's/Exit: all 112 rules reachable from the UI, 25 test files pass\./Exit: all 112 rules reachable from the UI, 27 test files pass./' docs/superpowers/specs/2026-09-18-era-rules-design.md
grep -n "test files pass\|Five new files" docs/superpowers/specs/2026-09-18-era-rules-design.md
```

Expected: three lines printed, reading 25, 27, and "Five new files".

- [ ] **Step 6: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `24/24 test files passed`

- [ ] **Step 7: Commit**

```bash
git add rules.js tools/build-rules.mjs tests/rules-catalog.test.js docs/superpowers/specs/2026-09-18-era-rules-design.md
git commit -m "feat: add the rules catalog as a loadable module

112 rules, tier-assigned. Tier B falls out of the data -- quantified
and modelable per plate appearance. Tier A is named by hand, because
'structural' is a fact about this engine rather than about the rule,
and no catalog field can infer it.

rules.js is generated from the committed ledger so the two cannot
drift. The module imports nothing, so loading it cannot move a game."
```

---

### Task 3: Resolution and modifier composition

**Files:**
- Modify: `tools/build-rules.mjs` (append `resolve` to the generated API)
- Create: `tests/rules-resolve.test.js`

**Interfaces:**
- Consumes: `MBB_RULES.CATALOG`, `MBB_RULES.forYear` from Task 2.
- Produces: `MBB_RULES.resolve(selection)` where `selection` is `{ year: number }` or `{ ids: string[] }`, returning:

```
{
  ids: string[],            // active rule ids, ascending by year
  structural: {},           // Tier A settings; empty in phase 1
  modifiers: {              // Tier B multipliers, 1 = no change
    bb: number, k: number, s1: number, d2: number, d3: number, hr: number
  },
  declared: [{ id, name, year, reason }]   // Tier C, for the UI
}
```

In phase 1 every Tier B rule contributes the identity multiplier `1`.
Coefficients arrive in phase 2. This task builds the composition machinery and
proves its algebra; it deliberately ships with no numbers.

- [ ] **Step 1: Write the failing test**

Create `tests/rules-resolve.test.js`:

```js
/* Era resolution: composition algebra. Run: node tests/rules-resolve.test.js */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'rules.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const RATES = ['bb', 'k', 's1', 'd2', 'd3', 'hr'];

const r1968 = R.resolve({ year: 1968 });
check('resolve({year}) returns all six rate keys',
  RATES.every((k) => typeof r1968.modifiers[k] === 'number'),
  JSON.stringify(r1968.modifiers));

check('phase 1 coefficients are all identity',
  RATES.every((k) => r1968.modifiers[k] === 1));

check('declared list is tier C only',
  r1968.declared.every((d) => R.byId(d.id).tier === 'C'),
  `${r1968.declared.length} declared`);

check('every declared entry carries a reason',
  r1968.declared.every((d) => typeof d.reason === 'string' && d.reason.length > 0));

check('ids match forYear', r1968.ids.length === R.forYear(1968).active.length);

// Multiplicative composition must be order-independent, or a hand-picked
// selection would depend on the order the user clicked things.
const a = R.resolve({ ids: ['1963-strike-zone-enlarged-shoulders-to-knees'] });
check('resolve({ids}) accepts an explicit selection', a.ids.length === 1,
  JSON.stringify(a.ids));

const someB = R.TIERS.B.slice(0, 5);
const fwd = R.resolve({ ids: someB });
const rev = R.resolve({ ids: someB.slice().reverse() });
check('composition is order-independent',
  RATES.every((k) => Math.abs(fwd.modifiers[k] - rev.modifiers[k]) < 1e-12),
  `${JSON.stringify(fwd.modifiers)} vs ${JSON.stringify(rev.modifiers)}`);

const empty = R.resolve({ ids: [] });
check('empty selection is the identity',
  RATES.every((k) => empty.modifiers[k] === 1) && empty.ids.length === 0);

// An unknown id is a programming error, not something to silently drop.
let threw = false;
try { R.resolve({ ids: ['no-such-rule'] }); } catch (e) { threw = true; }
check('unknown rule id throws', threw);

let threwYear = false;
try { R.resolve({ year: '1968' }); } catch (e) { threwYear = true; }
check('non-integer year throws', threwYear);

// Tier C must never touch a rate. This is the property the identity test
// depends on in Task 6.
const allC = R.resolve({ ids: R.TIERS.C });
check('tier C contributes no rate change',
  RATES.every((k) => allC.modifiers[k] === 1),
  JSON.stringify(allC.modifiers));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/rules-resolve.test.js
```

Expected: FAIL — `R.resolve is not a function`

- [ ] **Step 3: Add resolve to the generator's emitted body**

In `tools/build-rules.mjs`, inside the template literal, insert this
immediately before the `const API = ...` line:

```js
  const RATE_KEYS = ['bb', 'k', 's1', 'd2', 'd3', 'hr'];

  function identityMods() {
    const m = {};
    for (const k of RATE_KEYS) m[k] = 1;
    return m;
  }

  // Why a rule cannot be simulated, for the UI to show beside it.
  function declinedReason(r) {
    if (r.modelable_per_pa === 'no') {
      return r.model_note || 'not representable in a per-plate-appearance model';
    }
    return 'no quantified effect in the sources; shipped without a rate effect '
      + 'rather than with an invented one';
  }

  // Multipliers compose by multiplication, which is associative and
  // commutative -- that is what makes a hand-picked selection independent
  // of click order. Do not add an additive coefficient here; it would
  // silently break rules-resolve.test.js's order-independence check.
  function resolve(selection) {
    const sel = selection || {};
    let active;
    if (Array.isArray(sel.ids)) {
      active = sel.ids.map((id) => {
        const r = BY_ID.get(id);
        if (!r) throw new Error('unknown rule id: ' + id);
        return r;
      }).sort((a, b) => (a.year - b.year) || (a.id < b.id ? -1 : 1));
    } else {
      active = forYear(sel.year).active;
    }

    const modifiers = identityMods();
    const declared = [];
    const structural = {};

    for (const r of active) {
      if (r.tier === 'C') {
        declared.push({ id: r.id, name: r.name, year: r.year, reason: declinedReason(r) });
        continue;
      }
      if (r.tier === 'B' && r.rates) {
        for (const k of RATE_KEYS) {
          if (typeof r.rates[k] === 'number') modifiers[k] *= r.rates[k];
        }
      }
      // Tier A structural settings land here in phase 2.
    }

    return { ids: active.map((r) => r.id), structural, modifiers, declared };
  }
```

Then extend the emitted API line to:

```js
  const API = { CATALOG, TIERS, byId, forYear, resolve, RATE_KEYS };
```

Note `r.rates` is undefined for every rule today, so the multiply loop never
runs and every modifier stays `1`. Phase 2 adds `rates` to Tier B entries in
the generator and the machinery here needs no change.

- [ ] **Step 4: Regenerate and run**

```bash
node tools/build-rules.mjs
node tests/rules-resolve.test.js
```

Expected: PASS on all checks.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `25/25 test files passed`

- [ ] **Step 6: Commit**

```bash
git add rules.js tools/build-rules.mjs tests/rules-resolve.test.js
git commit -m "feat: resolve a year or a selection into composed modifiers

Multipliers compose by multiplication, so a hand-picked selection does
not depend on click order -- the test asserts that property directly,
because an additive coefficient added later would break it silently.

Phase 1 ships the machinery with every coefficient at identity. Tier C
contributes no rate change at all, which is the property the engine
identity guard leans on."
```

---

### Task 4: `leagueLine(year)` on the spine

**Files:**
- Modify: `tools/lib/spine.mjs`
- Modify: `tests/spine-query.test.js`

**Interfaces:**
- Consumes: the open spine handle from `openSpine()`.
- Produces: `spine.leagueLine(year)` → one object, league totals summed across every club in that season:

```
{ year, clubs, g, r, ra, ab, h, d2, d3, hr, bb, so, pa, hbp, sf, sb, cs, gidp }
```

Null-valued source columns stay `null`, never `0` — the same rule
`build-seasons.mjs` already follows, because `sf` before 1954 and `gidp`
before 1933 were never recorded and a zero would publish a plausible-looking
number that is not the statistic.

- [ ] **Step 1: Write the failing test**

Append to `tests/spine-query.test.js`, immediately before its final
`console.log`/`process.exit` pair:

```js
// ---- leagueLine: league totals per season, for era calibration ----
if (spine) {
  const l1968 = spine.leagueLine(1968);
  check('leagueLine(1968) returns one row with a year',
    l1968 && l1968.year === 1968, JSON.stringify(l1968 && l1968.clubs));
  check('leagueLine(1968) totals are plain finite numbers',
    ['g', 'r', 'pa', 'ab', 'h', 'hr', 'bb', 'so'].every(
      (k) => typeof l1968[k] === 'number' && Number.isFinite(l1968[k])));
  check('leagueLine(1968) runs/team-game is the known 3.42',
    Math.abs(l1968.r / l1968.g - 3.42) < 0.05,
    `${(l1968.r / l1968.g).toFixed(3)}`);
  check('leagueLine(1968) derived K/PA is the known .158',
    Math.abs(l1968.so / l1968.pa - 0.158) < 0.005,
    `${(l1968.so / l1968.pa).toFixed(4)}`);

  // The era columns that did not exist must be null, not zero.
  const l1930 = spine.leagueLine(1930);
  check('leagueLine(1930) sacrifice flies are null, not zero', l1930.sf === null,
    `sf = ${JSON.stringify(l1930.sf)}`);

  // Same trust boundary as every other query on this module.
  let badYear = false;
  try { spine.leagueLine('1968 OR 1=1'); } catch (e) { badYear = true; }
  check('leagueLine rejects a non-integer year', badYear);

  let outOfRange = false;
  try { spine.leagueLine(1800); } catch (e) { outOfRange = true; }
  check('leagueLine throws for a year with no data', outOfRange);
} else {
  console.log('skip  leagueLine checks — data/ absent');
}
```

Use whatever local variable the file already holds the open spine in; if it
opens inside a `try`, hoist the handle to a `let spine = null;` at the top and
assign it there, leaving the existing skip behaviour intact.

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/spine-query.test.js
```

Expected: FAIL — `spine.leagueLine is not a function` (or a clean skip if
`data/` is absent, in which case generate the spine first with
`node tools/build-spine.mjs`, which takes ~30s warm).

- [ ] **Step 3: Implement it**

In `tools/lib/spine.mjs`, inside the object `openSpine()` returns, add
alongside `seasonLines` and `teamLineup`:

```js
    // League totals for one season, summed across every club. The era-rules
    // calibration harness reads this; nothing else may open the parquet
    // directly, which is what keeps the storage layout swappable.
    leagueLine(year) {
      checkYear(year);
      const rows = conn.all(`
        SELECT
          ${year} AS year,
          COUNT(*)                       AS clubs,
          SUM(g) AS g, SUM(r) AS r, SUM(ra) AS ra, SUM(ab) AS ab,
          SUM(h) AS h, SUM(d2) AS d2, SUM(d3) AS d3, SUM(hr) AS hr,
          SUM(bb) AS bb, SUM(so) AS so, SUM(pa) AS pa,
          SUM(hbp) AS hbp, SUM(sf) AS sf, SUM(sb) AS sb,
          SUM(cs) AS cs, SUM(gidp) AS gidp
        FROM read_parquet('${leagueGlob}')
        WHERE year = ${year}
      `);
      if (!rows.length || rows[0].clubs === 0) {
        throw new Error(`no league rows for ${year}`);
      }
      const r = rows[0];
      const out = {};
      // DuckDB hands back BigInt for integer SUMs; the rest of this module
      // returns plain numbers, and callers do arithmetic on these.
      for (const k of Object.keys(r)) {
        out[k] = r[k] === null || r[k] === undefined ? null : Number(r[k]);
      }
      return out;
    },
```

Match the file's existing idiom for the parquet path — reuse whatever constant
`sigma()` already uses for the league dataset rather than introducing a new
glob literal. `SUM` over a column that is `NULL` in every row yields `NULL`,
which is exactly the 1930-sacrifice-fly behaviour the test asserts.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/spine-query.test.js
```

Expected: PASS, including the 3.42 and .158 checks that confirm the query is
reading real 1968 data rather than an empty aggregate.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `25/25 test files passed`

- [ ] **Step 6: Commit**

```bash
git add tools/lib/spine.mjs tests/spine-query.test.js
git commit -m "feat: add leagueLine(year) to the spine

Season totals summed across every club, for the era-rules calibration
harness. It goes through spine.mjs because nothing else reads parquet --
that is what keeps the storage layout swappable.

Null columns stay null. A zero for pre-1954 sacrifice flies would
publish a plausible-looking number that is not the statistic, the same
trap the ?? null mapping in build-seasons.mjs already avoids."
```

---

### Task 5: Thread `rules` through the classic engine

The risky task. The identity fixtures from Task 1 are the gate.

**Files:**
- Modify: `sim.js:20` (`DEFAULT_CFG`), `:60` (`plateAppearance`), `:93` (`hitAdvance`), `:113` (`walkAdvance`), `:127-178` (`playHalfInning` call sites)
- Test: `tests/rules-identity.test.js` (already exists, must stay green)

**Interfaces:**
- Consumes: `cfg.rules` — either `null` or the object Task 3's `resolve()` returns.
- Produces: `plateAppearance(p, rnd, moundDeltaFt, rules)`, `hitAdvance(bases, batter, hitValue, rnd, rules)`, `walkAdvance(bases, batter, rules)`, and `SIM.tunables(rules)` → `{ stretch1B, stretch2B, sacFly, doublePlay }` with defaults `0.32, 0.22, 0.26, 0.13`.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules-identity.test.js`, before its final `console.log`:

```js
// ---- tunables: the four bare literals become rule-addressable ----
const def = S.tunables(null);
check('tunables(null) returns the historical literals',
  def.stretch1B === 0.32 && def.stretch2B === 0.22 &&
  def.sacFly === 0.26 && def.doublePlay === 0.13,
  JSON.stringify(def));

const over = S.tunables({ tunables: { stretch1B: 0.5 } });
check('tunables override one value and keep the rest',
  over.stretch1B === 0.5 && over.stretch2B === 0.22 && over.sacFly === 0.26,
  JSON.stringify(over));

check('tunables treat 0 as a real value, not as missing',
  S.tunables({ tunables: { doublePlay: 0 } }).doublePlay === 0);

// An all-identity rules object must leave the game exactly where it was.
const R = require(path.join(__dirname, '..', 'rules.js'));
const inert = R.resolve({ ids: [] });
let inertMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: inert });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) inertMoved++;
}
check('an identity rules object does not move any golden box score',
  inertMoved === 0, inertMoved ? `${inertMoved} case(s) diverged` : '');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/rules-identity.test.js
```

Expected: FAIL — `S.tunables is not a function`

- [ ] **Step 3: Implement the threading**

In `sim.js`, make exactly these changes.

Change `DEFAULT_CFG` at line 20:

```js
  const DEFAULT_CFG = { bases: 3, innings: 9, outs: 3, rules: null };
```

Add above `adjustedRates`:

```js
  /* The four advancement constants below were bare literals. A rule may
   * address them by name; absent a rule they keep their original values,
   * and -- critically -- the number of rnd() draws never changes either
   * way. Only the comparison thresholds move. */
  const TUNABLE_DEFAULTS = Object.freeze({
    stretch1B: 0.32, stretch2B: 0.22, sacFly: 0.26, doublePlay: 0.13,
  });

  function tunables(rules) {
    const t = rules && rules.tunables;
    if (!t) return TUNABLE_DEFAULTS;
    const out = {};
    for (const k of Object.keys(TUNABLE_DEFAULTS)) {
      out[k] = typeof t[k] === 'number' ? t[k] : TUNABLE_DEFAULTS[k];
    }
    return out;
  }
```

Change the `plateAppearance` signature at line 60 to
`function plateAppearance(p, rnd, moundDeltaFt, rules) {` and leave its body
untouched. `rules` is accepted and unused in this task; Task 6 consumes it.
Adding the parameter and consuming it are separate commits so that if a box
score moves, the cause is unambiguous.

Change `hitAdvance` at line 93 to `function hitAdvance(bases, batter, hitValue, rnd, rules) {`
and replace only the `stretch` assignment:

```js
    const t = tunables(rules);
    const stretch =
      (hitValue === 1 && rnd() < t.stretch1B) || (hitValue === 2 && rnd() < t.stretch2B) ? 1 : 0;
```

**The expression shape is unchanged.** Both `rnd()` calls stay inside the same
short-circuited `||`, so a single still draws once, a double once, a triple and
a homer zero times.

Change `walkAdvance` at line 113 to `function walkAdvance(bases, batter, rules) {`,
body untouched.

In `playHalfInning`, add `const t = tunables(cfg.rules);` as the first line of
the function body, then update the three call sites and two thresholds:

- line 144: `const res = walkAdvance(bases, batter, cfg.rules);`
- line 148: `const res = hitAdvance(bases, batter, value, rnd, cfg.rules);`
- line 158: `} else if (bases[lastBase] && outs < cfg.outs && rnd() < t.sacFly) {`
- line 163: `} else if (bases[0] && outs < cfg.outs && rnd() < t.doublePlay) {`

Leave the `plateAppearance` call at line 136 as `plateAppearance(batter, rnd)` —
Task 6 changes it.

Add `tunables` to the exported `API` object.

- [ ] **Step 4: Run the identity test**

```bash
node tests/rules-identity.test.js
```

Expected: PASS, including all 25 golden box scores. If any diverged, the
`else if` chain or the stretch expression was restructured — revert and redo
Step 3 exactly as written.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `25/25 test files passed`. `tests/ngon.test.js` and
`tests/mound.test.js` are the two to watch.

- [ ] **Step 6: Commit**

```bash
git add sim.js tests/rules-identity.test.js
git commit -m "refactor: make the four advancement constants rule-addressable

0.32 / 0.22 / 0.26 / 0.13 were bare literals. A rules object may now
name them; absent one they keep their values, and the draw count is
identical either way -- only the comparison thresholds move.

The stretch expression keeps its exact shape. Both rnd() calls stay
inside the same short-circuited ||, so a single draws once, a double
once, and a triple or homer not at all. Hoisting them would change a
homer from zero draws to two and diverge every game from that plate
appearance on.

plateAppearance and walkAdvance take the new parameter without reading
it yet, so that if a box score moves the cause is unambiguous.

All 25 golden box scores unchanged."
```

---

### Task 6: Apply modifiers, and prove Tier C is inert

**Files:**
- Modify: `sim.js` (add `applyModifiers`, consume `rules` in `plateAppearance`)
- Modify: `tests/rules-identity.test.js`

**Interfaces:**
- Consumes: `rules.modifiers` from Task 3.
- Produces: `SIM.applyModifiers(rates, modifiers)` → a new rates object `{bb, hr, d3, d2, s1, k}` with the same clamps `adjustedRates` applies.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules-identity.test.js`, before its final `console.log`:

```js
// ---- applyModifiers ----
const baseRates = { bb: 0.09, hr: 0.04, d3: 0.004, d2: 0.05, s1: 0.14, k: 0.23 };
const same = S.applyModifiers(baseRates, { bb: 1, hr: 1, d3: 1, d2: 1, s1: 1, k: 1 });
check('identity modifiers return the same rates',
  Object.keys(baseRates).every((k) => Math.abs(same[k] - baseRates[k]) < 1e-12),
  JSON.stringify(same));

const doubled = S.applyModifiers(baseRates, { hr: 2 });
check('a single multiplier moves only its own rate',
  Math.abs(doubled.hr - 0.08) < 1e-12 && Math.abs(doubled.bb - 0.09) < 1e-12,
  `hr ${doubled.hr}`);

// The clamps that keep a game playable, inherited from adjustedRates.
const absurd = S.applyModifiers(baseRates, { bb: 9, hr: 9, d2: 9, s1: 9 });
const nonOut = absurd.bb + absurd.hr + absurd.d3 + absurd.d2 + absurd.s1;
check('non-out share is clamped at 0.92', nonOut <= 0.92 + 1e-9, nonOut.toFixed(4));
check('strikeouts never go below 2%', absurd.k >= 0.02 - 1e-9, absurd.k.toFixed(4));

check('applyModifiers does not mutate its input',
  Math.abs(baseRates.hr - 0.04) < 1e-12);

// The whole point of Tier C: it is real, it is listed, and it does nothing.
const tierC = R.resolve({ ids: R.TIERS.C });
let cMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: tierC });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) cMoved++;
}
check(`all ${R.TIERS.C.length} tier C rules active changes nothing`,
  cMoved === 0, cMoved ? `${cMoved} case(s) diverged` : '');

// A full historical year, with every coefficient still at identity.
const y1968 = R.resolve({ year: 1968 });
let yMoved = 0;
for (const c of golden.cases) {
  const cfg = Object.assign({}, c.cfg, { rules: y1968 });
  if (boxOf(S.simGame(NYY, LAD, cfg, c.seed)) !== c.box) yMoved++;
}
check('the 1968 rule set at identity coefficients changes nothing',
  yMoved === 0, yMoved ? `${yMoved} case(s) diverged` : '');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/rules-identity.test.js
```

Expected: FAIL — `S.applyModifiers is not a function`

- [ ] **Step 3: Implement**

In `sim.js`, add below `adjustedRates`:

```js
  /* Apply a composed set of rate multipliers, then the same two clamps
   * adjustedRates uses: keep the non-out share under 92% so a half-inning
   * can always end, and leave at least 2% strikeouts. Returns a new
   * object; the caller's rates are not touched. */
  function applyModifiers(rates, mods) {
    const m = mods || {};
    const mul = (k) => (typeof m[k] === 'number' ? m[k] : 1);
    let bb = rates.bb * mul('bb');
    let hr = rates.hr * mul('hr');
    let d3 = rates.d3 * mul('d3');
    let d2 = rates.d2 * mul('d2');
    let s1 = rates.s1 * mul('s1');
    let k = rates.k * mul('k');
    const nonOut = bb + hr + d3 + d2 + s1;
    if (nonOut > 0.92) {
      const scale = 0.92 / nonOut;
      bb *= scale; hr *= scale; d3 *= scale; d2 *= scale; s1 *= scale;
    }
    k = Math.min(k, 1 - (bb + hr + d3 + d2 + s1) - 0.02);
    return { bb, hr, d3, d2, s1, k: Math.max(0.02, k) };
  }
```

Then teach `plateAppearance` to use it. Replace the guard at line 61
(`if (moundDeltaFt) {`) with:

```js
    const mods = rules && rules.modifiers;
    const hasMods = !!mods && Object.keys(mods).some((k) => mods[k] !== 1);
    if (moundDeltaFt || hasMods) {
      let a = moundDeltaFt ? adjustedRates(p, moundDeltaFt) : {
        bb: p.bb / p.pa,
        hr: p.hr / p.pa,
        d3: p.d3 / p.pa,
        d2: p.d2 / p.pa,
        s1: (p.h - p.d2 - p.d3 - p.hr) / p.pa,
        k: p.so / p.pa,
      };
      if (hasMods) a = applyModifiers(a, mods);
```

and leave the rest of that branch — the `events` array, the two draws, the
`outShare` return — exactly as it is. The closing brace and the legacy branch
below are untouched.

`hasMods` is the load-bearing predicate: a resolved rules object whose
coefficients are all `1` is falsy for this purpose, so phase 1 never leaves the
legacy path. That is what makes the two new identity checks pass.

Add `applyModifiers` to the exported `API`.

- [ ] **Step 4: Run the identity test**

```bash
node tests/rules-identity.test.js
```

Expected: PASS on every check, including the 1968 and all-Tier-C runs.

- [ ] **Step 5: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `25/25 test files passed`

- [ ] **Step 6: Commit**

```bash
git add sim.js tests/rules-identity.test.js
git commit -m "feat: apply composed rate modifiers in plateAppearance

applyModifiers reuses the clamps adjustedRates already proved out: the
non-out share stays under 92% so a half-inning can always end, and
strikeouts never fall below 2%.

The guard is hasMods, not the mere presence of a rules object. A
resolved set whose coefficients are all 1 stays on the legacy path, so
loading a full historical rule set with no coefficients yet is provably
a no-op -- the 1968 set and all 29 tier C rules both leave every golden
box score untouched."
```

---

### Task 7: Carry `rules` to the graph and tri engines

**Files:**
- Modify: `graphsim.js:668` (`geo` construction), `:676` (PA call)
- Modify: `trisim.js:84` (`geo` construction), `:110` (PA call)
- Modify: `ui.js:237-243` (`readCfg`)
- Modify: `index.html` (script tag for `rules.js`)
- Modify: `tests/rules-identity.test.js`

**Interfaces:**
- Consumes: `cfg.rules`.
- Produces: `geo.rules` available to all six advancement functions in `graphsim.js` without changing their signatures. Phase 2 reads it; phase 1 only places it.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules-identity.test.js`, before its final `console.log`:

```js
// ---- graph and tri engines accept rules without moving ----
const L = require(path.join(__dirname, '..', 'layout.js'));
const G = require(path.join(__dirname, '..', 'graphsim.js'));

const lay = L.makeStarter();
function graphBox(cfg, seed) {
  const g = G.simGameGraph(NYY, LAD, lay, cfg, seed);
  return JSON.stringify({
    away: g.away, home: g.home, winner: g.winner, innings: g.innings,
    plays: g.log.map((e) => [e.type, e.sub, e.runs, e.outsAfter]),
  });
}
let graphMoved = 0;
for (const seed of [7, 42, 99]) {
  const plain = graphBox({ innings: 9, outs: 3 }, seed);
  const withRules = graphBox({ innings: 9, outs: 3, rules: R.resolve({ year: 1968 }) }, seed);
  if (plain !== withRules) graphMoved++;
}
check('graph engine: an identity rule set changes nothing', graphMoved === 0,
  graphMoved ? `${graphMoved} seed(s) diverged` : '');
```

If `L.makeStarter()` needs arguments in this codebase, match the call
`tests/graphsim.test.js` already uses rather than inventing one.

- [ ] **Step 2: Run it to verify it fails**

```bash
node tests/rules-identity.test.js
```

Expected: FAIL — the graph check fails, or throws, because `cfg.rules` is not
forwarded and `plateAppearance` never sees it.

Note: it may *accidentally* pass, since identity coefficients change nothing
either way. That is acceptable — the check's job is to stay green once the
wiring lands and to catch a real divergence in phase 2.

- [ ] **Step 3: Wire it**

In `graphsim.js`, at the `geo` construction (line 668), add the key:

```js
  const geo = { layout, rnd, rules: cfg.rules || null };
```

Match the existing property list rather than replacing it — read the line
first and add only `rules`.

At line 676, forward it:

```js
      const type = CORE.plateAppearance(batter, rnd, ctx.moundDelta, cfg.rules || null);
```

In `trisim.js`, make the identical two changes at lines 84 and 110.

In `ui.js`, extend `readCfg` (line 237):

```js
  function readCfg() {
    return {
      bases: +$('bases-range').value,
      innings: +$('innings-range').value,
      outs: +$('outs-range').value,
      rules: null,   // era selection lands here in phase 2
    };
  }
```

In `index.html`, add the script tag immediately before `sim.js` so the catalog
is available to the UI, keeping the existing load order otherwise:

```html
<script src="rules.js"></script>
```

- [ ] **Step 4: Run the identity test**

```bash
node tests/rules-identity.test.js
```

Expected: PASS on every check.

- [ ] **Step 5: Verify the page still loads with no console errors**

```bash
python -m http.server 4321 &
```

Open `http://localhost:4321/`, click PLAY BALL, switch to 3D, and confirm the
browser console is clean apart from a `favicon.ico` 404. Then stop the server.

- [ ] **Step 6: Run the full suite**

```bash
node tools/run-tests.mjs 2>&1 | tail -3
```

Expected: `25/25 test files passed`

- [ ] **Step 7: Commit**

```bash
git add graphsim.js trisim.js ui.js index.html tests/rules-identity.test.js
git commit -m "feat: carry cfg.rules to the graph and tri engines

rules rides on the existing geo object rather than a new parameter.
geo has two construction sites and already reaches all six advancement
functions, so this costs zero signature changes in graphsim.js where
threading a parameter would have cost six.

readCfg is the single UI chokepoint and now returns rules: null;
simMany, scanBases and both simMany* variants already forward cfg
opaquely, so nothing else needs to change.

Phase 1 complete: the catalog loads, the engines accept rules, and
every golden box score is where it was."
```

---

## Phase 1 exit criteria

- `node tools/run-tests.mjs` reports **25/25**.
- `tests/rules-identity.test.js` passes with: 25 golden box scores unchanged, all 29 Tier C rules active changing nothing, and the full 1968 rule set changing nothing.
- `rules.js` is generated, not hand-edited, and `node tools/build-rules.mjs` reproduces it byte-for-byte.
- `git diff d10fdf5..HEAD -- data.js` is empty.
- Nothing in the UI has changed.

## Self-review notes

**Spec coverage.** §2 tiers → Task 2. §3 determinism → Tasks 1, 5, 6. §4.1
`rules.js` → Tasks 2, 3. §4.2 engine changes → Tasks 5, 6, 7. §4.5 spine
addition → Task 4. §6 test files → Tasks 1, 2, 3 (four files, spec amended in
Task 2 Step 5). §8 phase 1 → this plan in full.

Deliberately **not** in this plan, and correctly so: §4.3 the DH stand-in, §4.4
`playerSeason`, §5 calibration, §7 the UI — all phase 2 or 3.

**Naming consistency.** `resolve()` returns `{ids, structural, modifiers,
declared}` in Task 3 and is consumed with exactly those keys in Tasks 5, 6, 7.
`tunables()` is defined in Task 5 and referenced nowhere earlier.
`applyModifiers(rates, mods)` is defined in Task 6 and used only there.
`RATE_KEYS` is `['bb','k','s1','d2','d3','hr']` in both `rules.js` and the
tests.

**One known soft spot.** Task 7 Step 2's test can pass before its
implementation, because identity coefficients are indistinguishable from no
coefficients. Flagged in the step itself rather than papered over; the check
earns its place in phase 2, when coefficients are real.

---

Generated by claude-opus-5 · task completed
