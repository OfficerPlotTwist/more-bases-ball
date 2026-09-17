/* The eleven diagnostic KPIs: the pure intake guard, and the measured
 * coverage.json section it reads. Run: node tests/kpi-coverage.test.js
 *
 * Two halves on purpose. The guard half is pure and runs on a fresh clone with
 * no data/ and no network — it is the part that decides whether a fan is
 * charged, so it must never be untested just because the spine is absent. The
 * measured half skips when coverage.json has not been built.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'coverage.json');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const spine = await import('../tools/lib/spine.mjs');
  const { KPIS, requireKpis, stdevOfDeltas } = spine;

  // --- The spec's KPI list is the contract. -------------------------------
  // docs/superpowers/specs/2026-09-15-sim-as-a-service-design.md section 4
  // names these eleven. Dropping one silently would mean a rule could be sold
  // on a diagnostic nobody measures.
  const SPEC_KPIS = [
    'runs_per_game', 'batting_average', 'on_base_percentage', 'slugging',
    'home_runs_per_game', 'strikeout_rate', 'walk_rate', 'steal_attempt_rate',
    'steal_success_rate', 'double_play_rate', 'run_distribution_variance',
  ];
  check('KPIS covers all eleven spec KPIs',
    SPEC_KPIS.every((k) => Object.hasOwn(KPIS, k)),
    SPEC_KPIS.filter((k) => !Object.hasOwn(KPIS, k)).join(', ') || 'none missing');
  check('KPIS adds nothing the spec did not name',
    Object.keys(KPIS).length === SPEC_KPIS.length, String(Object.keys(KPIS).length));

  // --- stdevOfDeltas: the effect-size yardstick. ---------------------------
  // A perfectly linear series has ZERO variation in its deltas — this is the
  // difference between stdev of the series (non-zero) and stdev of its
  // year-over-year change (zero), and getting it backwards would make every
  // rule score as era-defining.
  check('stdevOfDeltas of a linear series is 0',
    stdevOfDeltas([1, 2, 3, 4, 5]) === 0, String(stdevOfDeltas([1, 2, 3, 4, 5])));
  check('stdevOfDeltas returns null, not NaN, for a series too short',
    stdevOfDeltas([1, 2]) === null && stdevOfDeltas([]) === null,
    `${stdevOfDeltas([1, 2])} / ${stdevOfDeltas([])}`);

  // --- requireKpis: pure, no filesystem. ----------------------------------
  const cov = { kpis: { list: {
    runs_per_game: { available: true, first: 1876, last: 2025, missingYears: [] },
    strikeout_rate: { available: true, first: 1876, last: 2025, missingYears: [1900, 1901] },
    run_distribution_variance: { available: false, reason: 'season totals only' },
  } } };

  check('guard allows a KPI in a covered year',
    requireKpis(cov, ['runs_per_game'], 2024).ok === true);

  const out1850 = requireKpis(cov, ['runs_per_game'], 1850);
  check('guard rejects a year before coverage', out1850.ok === false);
  check('guard names the range it rejected against',
    out1850.missing[0].first === 1876 && out1850.missing[0].last === 2025,
    JSON.stringify(out1850.missing[0]));

  // The gap case — the reason missingYears exists. 1900 is INSIDE
  // strikeout_rate's 1876-2025 range but has no populated `pa`, so a
  // first/last check alone answers ok:true and the fan is charged for a
  // diagnostic that cannot be computed.
  const gap = requireKpis(cov, ['strikeout_rate'], 1900);
  check('guard rejects a hollow year inside the range', gap.ok === false,
    JSON.stringify(gap));
  check('guard distinguishes a gap from an out-of-range year',
    gap.missing[0].reason === 'gap inside coverage', JSON.stringify(gap.missing[0]));
  check('guard still allows a populated year in the same range',
    requireKpis(cov, ['strikeout_rate'], 1999).ok === true);

  // An unavailable KPI is a refusal with its OWN sentence — intake has to be
  // able to tell a fan "we cannot compute that at all" apart from "not for
  // that season", because only one of them is fixed by picking another year.
  const un = requireKpis(cov, ['run_distribution_variance'], 2024);
  check('guard rejects an unavailable KPI', un.ok === false);
  check('guard carries the unavailable KPI own reason',
    un.missing[0].reason === 'season totals only', JSON.stringify(un.missing[0]));
  check('guard rejects an unknown KPI rather than passing it',
    requireKpis(cov, ['batting_wizardry'], 2024).ok === false);

  // --- The measured half. -------------------------------------------------
  if (!fs.existsSync(FILE)) {
    console.log('skip  data/coverage.json not built — run `node tools/build-coverage.mjs`');
    process.exit(failures ? 1 : 0);
  }
  const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const list = c.kpis && c.kpis.list;
  check('coverage.json carries a kpis section', !!list);
  check('coverage reports all eleven spec KPIs',
    SPEC_KPIS.every((k) => list[k]), SPEC_KPIS.filter((k) => !list[k]).join(', '));
  check('coverage certifies ten of eleven',
    c.kpis.certified === 10 && c.kpis.total === 11,
    `${c.kpis.certified}/${c.kpis.total}`);

  const available = SPEC_KPIS.filter((k) => list[k].available);
  check('every available KPI has a finite sigma',
    available.every((k) => Number.isFinite(list[k].sigma)),
    available.filter((k) => !Number.isFinite(list[k].sigma)).join(', '));
  check('every available KPI has a non-zero sigma',
    available.every((k) => list[k].sigma > 0),
    available.filter((k) => !(list[k].sigma > 0)).join(', '));
  check('first is never after last',
    available.every((k) => list[k].first <= list[k].last));

  // run_distribution_variance is the one the spine genuinely cannot answer.
  // It must be PRESENT and marked, never omitted: an absent key reads as
  // "not a KPI", which is a different and wrong statement from "we have no
  // game-level data" — and only the second one tells the next person what to
  // build. This is the rule unconsumedColumns already follows for bbref.
  const rdv = list.run_distribution_variance;
  check('run_distribution_variance is present and marked unavailable',
    rdv && rdv.available === false, JSON.stringify(rdv && rdv.available));
  check('the unavailable KPI says what would unblock it',
    !!(rdv && rdv.blockedBy && /game-level/.test(rdv.blockedBy)),
    rdv && rdv.blockedBy);
  check('the unavailable KPI carries no sigma to mistake for a yardstick',
    rdv && rdv.sigma === undefined);

  // Era starts are measured, not assumed. The Stats API omits a stat for the
  // years nobody recorded it, and build-seasons.mjs preserves that as NULL —
  // so OBP must begin at the sacrifice fly (1954), not at the league (1876).
  // If this ever reads 1876, a `?? 0` crept into the league-row mapping and
  // every pre-1954 OBP on a results page is fiction.
  check('on_base_percentage starts at 1954, the first sacrifice-fly season',
    list.on_base_percentage.first === 1954, String(list.on_base_percentage.first));
  check('double_play_rate starts at 1933, not 1876',
    list.double_play_rate.first === 1933, String(list.double_play_rate.first));
  check('runs_per_game does reach 1876 (the columns that always existed)',
    list.runs_per_game.first === 1876, String(list.runs_per_game.first));

  // gapYears must agree with the list it summarises, or a results page could
  // print "0 missing" over a list of missing years.
  check('gapYears equals missingYears.length for every available KPI',
    available.every((k) => list[k].gapYears === list[k].missingYears.length),
    available.filter((k) => list[k].gapYears !== list[k].missingYears.length).join(', '));
  check('strikeout_rate reports its dead-ball gap rather than claiming 1876-2025 whole',
    list.strikeout_rate.gapYears > 0 && list.strikeout_rate.missingYears.includes(1900),
    JSON.stringify(list.strikeout_rate.missingYears.slice(0, 3)));

  // Sanity against real baseball: if the expressions are wrong, these are the
  // numbers that say so. 2025 ran roughly 4.4 R/G on a .245/.315/.404 line.
  const latest = (k) => list[k].latestSeason.value;
  check('2025 runs/game is in the 3.5-5.5 band',
    latest('runs_per_game') > 3.5 && latest('runs_per_game') < 5.5,
    String(latest('runs_per_game')));
  check('2025 batting average is in the .230-.270 band',
    latest('batting_average') > 0.230 && latest('batting_average') < 0.270,
    String(latest('batting_average')));
  check('2025 OBP exceeds batting average (it must, by construction)',
    latest('on_base_percentage') > latest('batting_average'),
    `${latest('on_base_percentage')} vs ${latest('batting_average')}`);
  check('2025 slugging exceeds batting average (it must, by construction)',
    latest('slugging') > latest('batting_average'),
    `${latest('slugging')} vs ${latest('batting_average')}`);
  check('2025 steal success is a rate between 0.6 and 0.9',
    latest('steal_success_rate') > 0.6 && latest('steal_success_rate') < 0.9,
    String(latest('steal_success_rate')));
  check('2025 strikeout rate is in the 0.15-0.30 band',
    latest('strikeout_rate') > 0.15 && latest('strikeout_rate') < 0.30,
    String(latest('strikeout_rate')));

  // Provenance, the standard the rest of coverage.json is held to.
  check('every KPI names its source and dataset',
    SPEC_KPIS.every((k) => list[k].source && list[k].dataset === 'league'));
  check('the sigma definition is stated, not implied',
    /stdev of the year-over-year change/.test(c.kpis.sigmaDefinition || ''));

  process.exit(failures ? 1 : 0);
})();
