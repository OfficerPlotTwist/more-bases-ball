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

// composeModifiers is tested directly, not through resolve(), and with a
// deliberately unsorted list. resolve() sorts its `active` array by
// (year, id) before composing, so a forward id list and a reversed one
// always produce the identical, already-sorted array resolve() actually
// composes from -- testing resolve({ids}) forward vs reversed can never
// falsify a broken (order-dependent) composition, because both calls feed
// composition the same canonical order regardless of what the caller
// passed in. Calling composeModifiers directly, with genuinely different
// orderings and no sort in between, is what makes this check real.
// The expected value is computed independently (plain left-to-right
// multiplication over a fixed set), so any composition that is not truly
// order-independent -- e.g. an additive coefficient, which turns each
// rule's contribution into a non-commutative affine step instead of a
// scalar product -- lands on a different number and fails here regardless
// of which ordering produced it.
function ruleWithRates(id, rates) { return { id, tier: 'B', rates }; }
const synthetic = [
  ruleWithRates('t1', { bb: 1.10, hr: 1.20 }),
  ruleWithRates('t2', { bb: 0.95, k: 1.05 }),
  ruleWithRates('t3', { hr: 0.90, s1: 1.02 }),
];
const expectedProduct = {
  bb: 1.10 * 0.95, k: 1.05, s1: 1.02, d2: 1, d3: 1, hr: 1.20 * 0.90,
};
const orderings = {
  forward: synthetic,
  reversed: synthetic.slice().reverse(),
  shuffled: [synthetic[1], synthetic[2], synthetic[0]],
};
for (const [label, ordering] of Object.entries(orderings)) {
  const got = R.composeModifiers(ordering).modifiers;
  check(`composeModifiers(${label}) matches the order-independent expected product`,
    RATES.every((k) => Math.abs(got[k] - expectedProduct[k]) < 1e-12),
    JSON.stringify(got));
}

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
