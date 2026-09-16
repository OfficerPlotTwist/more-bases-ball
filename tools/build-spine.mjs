/* moreBasesBall — build the whole data spine.
 *
 *   node tools/build-spine.mjs
 *
 * Order matters only at the end: coverage.json is measured from everything else,
 * so build-coverage.mjs runs last. The first three are independent — statcast
 * does NOT join through players.parquet, because every Savant leaderboard
 * already carries the MLBAM id. The crosswalk is consumed by the query layer
 * and by the Retrosheet work in a later plan, not by the builders.
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
    if (s === 'build-coverage.mjs') {
      console.error('build-coverage refuses to measure an incomplete spine. '
        + 'Check data/_build.json for the failing years.');
    }
    process.exit(r.status || 1);
  }
}
/* Verification is not a suggestion. Several of this branch's guarantees — the
 * crosswalk row counts, coverage.json's measured years, the leagueOnlySeasons
 * totals — are enforced by the test suite and by no runtime gate, so a build
 * that "succeeded" without them is unverified, not done. Run them here and
 * fail the build if they fail, distinguishing the two failure modes in the
 * exit line so nobody mistakes a bad spine for a bad assertion. */
console.log('\n=== run-tests.mjs (verification) ===');
const v = spawnSync(process.execPath, [path.join(HERE, 'run-tests.mjs')], { stdio: 'inherit' });
if (v.status !== 0) {
  console.error('\nbuild-spine: VERIFICATION FAILED — every builder completed and the '
    + 'spine is on disk, but tools/run-tests.mjs reported failures. This is not a '
    + 'build failure; the data was written and then failed its assertions. Read the '
    + 'test output above before trusting anything under data/.');
  process.exit(v.status || 1);
}
console.log('\nspine built and verified');
