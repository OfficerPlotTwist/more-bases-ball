/* moreBasesBall — prove a candidate data.js did not move anything that ships.
 *
 *   node tools/check-data-identity.mjs [candidate.js] [--against <baseline.js>]
 *
 * Default: compares the working-tree data.js against the last COMMITTED
 * data.js (via `git show HEAD:data.js`), which is the check you want after
 * running tools/augment-data.mjs in place.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARDS, AND WHY THE TEST SUITE IS NOT ENOUGH
 *
 * tests/rules-identity.test.js and tests/ngon.test.js freeze BOX SCORES. They
 * are the right backstop and they must stay green, but they are downstream:
 * they index TEAMS[0] and TEAMS[1] positionally, so they answer "did the
 * simulated game change" and not "did the data change". Several ways the data
 * can move produce a red suite with no clue as to why, and at least one way it
 * can move produces a GREEN suite while still being wrong:
 *
 *   - a club reordered, so TEAMS[0] is now a different team entirely;
 *   - a lineup reordered, because build-data.mjs picks "the nine batters with
 *     the most plate appearances" and a single corrected PA total swaps the
 *     ninth man;
 *   - a 2025 correction moving a PA, H or SO — 2025 is still open and
 *     build-data.mjs passes no `fresh`/isVolatileSeason flag, so whether a
 *     rebuild moves depends on whether data/.cache happens to be warm;
 *   - a spd or hp1 that silently fell back to a league median.
 *
 * The last one is the green-suite case: a median-filled runner on a bench bat
 * who never reaches base in the ten fixture games changes nothing the fixtures
 * look at, and ships anyway.
 *
 * So this compares the DATA, field by field, and names what moved. It is the
 * gate that runs BEFORE the suite, not instead of it.
 * ---------------------------------------------------------------------------
 *
 * It asserts, in order, and stops at the first failure with a specific name:
 *   1. identical season list;
 *   2. identical club count and club ORDER within every season;
 *   3. identical club id, name, abbr and color;
 *   4. identical lineup length and batter ORDER within every lineup;
 *   5. every one of the eleven shipped values EXACTLY equal — no epsilon.
 *      These are integers and verbatim floats; an epsilon here would be a
 *      licence for exactly the drift this file exists to catch.
 *   6. the only difference anywhere is the PRESENCE of new keys, which it
 *      lists so the report states positively what was added.
 *
 * Exit 0 means the addition is inert with respect to everything that shipped.
 * Exit 1 means something moved; the message says what, for which player, in
 * which season. It never writes a file and never "fixes" anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The eleven values data.js has always shipped, in the order P() decodes them.
 * This list is the contract. Adding to it is a deliberate act; a new key does
 * NOT belong here just because it now exists in the file. */
const SHIPPED = ['name', 'pos', 'pa', 'h', 'd2', 'd3', 'hr', 'bb', 'so', 'spd', 'hp1'];

const argv = process.argv.slice(2);
const againstFlag = argv.indexOf('--against');
const baselineArg = againstFlag >= 0 ? argv[againstFlag + 1] : null;
const candidateArg = argv.find((a, i) => !a.startsWith('--')
  && (againstFlag < 0 || i !== againstFlag + 1));

const candidatePath = path.resolve(candidateArg || path.join(ROOT, 'data.js'));

/* Loading data.js means running it. It is an IIFE that takes the CommonJS
 * branch when a `module` is in scope and otherwise hangs itself off globalThis
 * — so each side is handed its OWN `module`, and `globalThis` is shadowed by a
 * bare object. Sharing this process's real globalThis would let the second
 * load overwrite the first and turn this into a comparison of one file against
 * itself, which passes always and guards nothing. */
function load(source, label) {
  const mod = { exports: {} };
  const holder = {};
  const tail = '\nreturn (module.exports && module.exports.SEASONS)'
    + ' ? module.exports : globalThis.MBB_DATA;';
  const fn = new Function('module', 'globalThis', source + tail);
  const api = fn(mod, holder);
  if (!api || !api.SEASONS) throw new Error(`${label}: did not produce MBB_DATA.SEASONS`);
  return api;
}

let baselineSource;
let baselineLabel;
if (baselineArg) {
  baselineLabel = path.relative(ROOT, path.resolve(baselineArg));
  baselineSource = fs.readFileSync(path.resolve(baselineArg), 'utf8');
} else {
  baselineLabel = 'HEAD:data.js';
  baselineSource = execFileSync('git', ['show', 'HEAD:data.js'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const base = load(baselineSource, baselineLabel);
const cand = load(fs.readFileSync(candidatePath, 'utf8'), path.relative(ROOT, candidatePath));

const fail = (msg) => {
  console.error(`IDENTITY FAILED\n  ${msg}`);
  console.error(`\n  baseline:  ${baselineLabel}`);
  console.error(`  candidate: ${path.relative(ROOT, candidatePath)}`);
  console.error('\nThis is a refusal, not a fixture to recapture. Do not regenerate '
    + 'tests/fixtures/identity-golden.json to make it pass.');
  process.exit(1);
};

const eq = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

/* 1. seasons */
const bYears = Object.keys(base.SEASONS);
const cYears = Object.keys(cand.SEASONS);
if (bYears.join(',') !== cYears.join(',')) {
  fail(`season list moved: ${bYears.join(',')} -> ${cYears.join(',')}`);
}

const added = new Set();
let players = 0;

for (const y of bYears) {
  const bc = base.SEASONS[y];
  const cc = cand.SEASONS[y];

  /* 2 + 3. clubs, in order */
  if (bc.length !== cc.length) fail(`${y}: club count ${bc.length} -> ${cc.length}`);
  for (let i = 0; i < bc.length; i++) {
    for (const k of ['id', 'name', 'abbr', 'color']) {
      if (bc[i][k] !== cc[i][k]) {
        fail(`${y} club ${i}: ${k} ${JSON.stringify(bc[i][k])} -> `
          + `${JSON.stringify(cc[i][k])} — club ORDER or identity moved, which `
          + 'reindexes TEAMS[0]/TEAMS[1] and every fixture built on them');
      }
    }

    /* 4. lineups, in order */
    const bl = bc[i].lineup;
    const cl = cc[i].lineup;
    if (bl.length !== cl.length) {
      fail(`${y} ${bc[i].abbr}: lineup length ${bl.length} -> ${cl.length}`);
    }
    for (let j = 0; j < bl.length; j++) {
      if (bl[j].name !== cl[j].name) {
        fail(`${y} ${bc[i].abbr} slot ${j}: ${bl[j].name} -> ${cl[j].name} — batter `
          + 'ORDER moved. build-data.mjs picks the nine highest-PA batters, so one '
          + 'corrected PA total swaps a man and moves every box score downstream');
      }

      /* 5. the eleven, exactly */
      for (const k of SHIPPED) {
        if (!eq(bl[j][k], cl[j][k])) {
          fail(`${y} ${bc[i].abbr} ${bl[j].name}: ${k} `
            + `${JSON.stringify(bl[j][k])} -> ${JSON.stringify(cl[j][k])}`);
        }
      }

      /* 6. everything else must be an ADDITION, never a removal */
      for (const k of Object.keys(bl[j])) {
        if (!(k in cl[j])) {
          fail(`${y} ${bc[i].abbr} ${bl[j].name}: key ${k} was REMOVED`);
        }
      }
      for (const k of Object.keys(cl[j])) if (!(k in bl[j])) added.add(k);
      players++;
    }
  }
}

const cover = {};
for (const k of added) cover[k] = 0;
for (const y of cYears) {
  for (const t of cand.SEASONS[y]) {
    for (const p of t.lineup) {
      for (const k of added) if (p[k] !== null && p[k] !== undefined) cover[k]++;
    }
  }
}

console.log('IDENTITY HELD');
console.log(`  ${bYears.length} seasons, ${players} players compared`);
console.log(`  all ${SHIPPED.length} shipped values exactly equal: ${SHIPPED.join(' ')}`);
if (added.size) {
  console.log(`  keys added: ${[...added].join(' ')}`);
  for (const k of added) {
    console.log(`    ${k.padEnd(6)} ${cover[k]}/${players} non-null`);
  }
} else {
  console.log('  no keys added — the two files carry the same shape');
}
