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
