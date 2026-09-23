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
