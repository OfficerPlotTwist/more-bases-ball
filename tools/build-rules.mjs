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
