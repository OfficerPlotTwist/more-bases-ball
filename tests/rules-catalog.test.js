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
