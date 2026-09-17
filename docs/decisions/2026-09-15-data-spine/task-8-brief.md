### Task 8: Orchestrator and documentation

**Files:**
- Create: `tools/build-spine.mjs`
- Modify: `AGENTS.md` (append a "Data spine" section)
- Modify: `README.md` (append a "Data spine" section under the existing `## Files` heading)

**Interfaces:**
- Consumes: every builder from Tasks 3–6.
- Produces: `node tools/build-spine.mjs` as the one command that builds the whole lake in dependency order.

- [ ] **Step 1: Write the orchestrator**

Create `tools/build-spine.mjs`:

```js
/* moreBasesBall — build the whole data spine.
 *
 *   node tools/build-spine.mjs
 *
 * Order matters only at the end: coverage.json is measured from everything else,
 * so it runs last. The first three are independent — statcast does NOT join
 * through players.parquet, because every Savant leaderboard already carries the
 * MLBAM id. The crosswalk is consumed by the query layer, not by the builders.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPS = ['build-players.mjs', 'build-seasons.mjs',
  'build-statcast.mjs', 'build-coverage.mjs'];

for (const s of STEPS) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [path.join(HERE, s)], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nbuild-spine: ${s} failed with status ${r.status}`);
    process.exit(r.status || 1);
  }
}
console.log('\nspine built — run `node tools/run-tests.mjs` to verify');
```

- [ ] **Step 2: Verify the orchestrator on a clean lake**

```bash
rm -rf data/seasons data/statcast data/players.parquet data/coverage.json
node tools/build-spine.mjs
```

Expected: four sections run in order and the final line prints. The HTTP cache under `data/.cache` survives, so this is fast; delete that too for a true cold run.

- [ ] **Step 3: Verify the whole suite against the rebuilt lake**

Run: `node tools/run-tests.mjs`
Expected: `19/19 test files passed`, including the original twelve.

- [ ] **Step 4: Document it in `AGENTS.md`**

Append:

```markdown
## Data spine

`data.js` is the small, committed slice the browser sim loads: nine batters per
club, 2021–2025, no pitchers. The **spine** under `data/` is the full
population the service simulates against — every player 1871+, both roles, plus
Statcast tracking from 2015. It is generated and gitignored.

- Build it: `node tools/build-spine.mjs`. Builders run in dependency order and
  share an HTTP cache at `data/.cache`, so a rebuild is cheap.
- Query it through `tools/lib/spine.mjs` only. Nothing else reads parquet —
  that is what keeps the storage layout swappable.
- `data/coverage.json` is **measured** from the written parquet, never
  hardcoded. Intake calls `requireCoverage()` with it to reject a rule the data
  cannot support before the fan is charged. A hardcoded table would drift away
  from the data it guards; `tests/coverage.test.js` asserts the builder does not
  hardcode years.
- Lahman team codes are not the modern abbreviations — the Dodgers are `LAN`,
  the Yankees `NYA`. `data.js` uses `LAD`/`NYY`. Do not conflate them.
- Savant rewrites its leaderboard URLs. `build-statcast.mjs` declares the
  columns each board must return and throws on drift, rather than writing a
  column of nulls — the same failure mode `build-data.mjs` warns about with
  median-filled sprint speeds.
- Spine tests skip cleanly when `data/` is absent, so a fresh clone with no
  network still shows the original twelve green.
```

- [ ] **Step 5: Document it in `README.md`**

Append a matching section under `## Files` describing `data/` layout, the one build command, and the coverage table's role on results pages.

- [ ] **Step 6: Commit**

```bash
git add tools/build-spine.mjs AGENTS.md README.md
git commit -m "feat: add spine orchestrator and document the data lake"
```

---

## What this plan does not cover

- **Tier B, Retrosheet event-level plate appearances 1912+.** A play-string
  parser (`64(1)3/GDP`, `S8/L.2-H`) is a separate subsystem from table
  reshaping, and the usual tool for it is a C binary that breaks the
  Windows→Linux constraint. Plan 1b.
- **Tier C pitch-level Statcast.** This plan lands the per-season *leaderboard*
  rates, not the per-pitch rows.
- **Regenerating `data.js` from the spine.** Deliberate: `data.js` must stay
  byte-identical through this work. Swapping its generator over is a task in
  sub-project 2, gated by the golden-run identity test.
