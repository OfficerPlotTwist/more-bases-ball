/* Spine query layer + the intake guard. Run: node tests/spine-query.test.js */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const spine = await import('../tools/lib/spine.mjs');

  // requireCoverage is pure — it must be testable with no data on disk.
  const cov = { stats: {
    sprint_speed: { first: 2015, last: 2025 },
    season_batting: { first: 1871, last: 2025 },
  } };
  const ok2024 = spine.requireCoverage(cov, ['sprint_speed'], 2024);
  check('guard allows a supported year', ok2024.ok === true, JSON.stringify(ok2024));

  const bad1927 = spine.requireCoverage(cov, ['sprint_speed'], 1927);
  check('guard rejects tracking in 1927', bad1927.ok === false, JSON.stringify(bad1927));
  check('guard names the offending stat',
    bad1927.missing.length === 1 && bad1927.missing[0].stat === 'sprint_speed',
    JSON.stringify(bad1927.missing));
  check('guard reports the real first year',
    bad1927.missing[0].first === 2015, JSON.stringify(bad1927.missing[0]));

  const unknown = spine.requireCoverage(cov, ['pitch_spin'], 2024);
  check('guard rejects an unknown stat', unknown.ok === false, JSON.stringify(unknown));

  // leagueOnlyClubs is also pure — a literal coverage object, no filesystem.
  const covLeague = { stats: {}, leagueOnlySeasons: {
    totalEmptyClubYears: 2,
    years: { 1924: ['BRG', 'CSE', 'DAY', 'HIL'] },
  } };
  const clubs1924 = spine.leagueOnlyClubs(covLeague, 1924);
  check('leagueOnlyClubs names the 1924 clubs',
    Array.isArray(clubs1924) && clubs1924.length === 4 && clubs1924.includes('HIL'),
    JSON.stringify(clubs1924));
  const clubs2024 = spine.leagueOnlyClubs(covLeague, 2024);
  check('leagueOnlyClubs returns empty array for a year with no gaps',
    Array.isArray(clubs2024) && clubs2024.length === 0, JSON.stringify(clubs2024));

  // openSpine must refuse an incomplete/missing spine, with allowIncomplete
  // as the only escape hatch. Exercise this against a directory that
  // definitely has no _build.json, regardless of whether data/ is built.
  const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'spine-empty-'));
  try {
    let threw = false;
    try {
      await spine.openSpine(emptyDir);
    } catch (e) {
      threw = true;
      check('refusal names the missing manifest', /_build\.json is missing/.test(e.message), e.message);
    }
    check('openSpine throws when data/_build.json is missing', threw);

    const s2 = await spine.openSpine(emptyDir, { allowIncomplete: true });
    check('allowIncomplete escape hatch opens despite missing manifest', !!s2);
    await s2.close();
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }

  // Also exercise the complete:false path with a synthetic manifest.
  const incompleteDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'spine-incomplete-'));
  try {
    fs.writeFileSync(path.join(incompleteDir, '_build.json'),
      JSON.stringify({ complete: false, failures: ['1994'] }));
    let threw = false;
    try {
      await spine.openSpine(incompleteDir);
    } catch (e) {
      threw = true;
      check('refusal names complete=false', /complete=false/.test(e.message), e.message);
    }
    check('openSpine throws when spine build reports complete=false', threw);
  } finally {
    fs.rmSync(incompleteDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(ROOT, 'data', 'coverage.json'))) {
    console.log('skip  data/ not built — query assertions skipped');
    process.exit(failures ? 1 : 0);
  }

  const s = await spine.openSpine();

  const c = await s.coverage();
  check('coverage loads', !!c.stats.season_batting, Object.keys(c.stats).join(','));

  const build = await s.buildInfo();
  check('buildInfo reports complete', build.complete === true, JSON.stringify(build.complete));

  const lines = await s.seasonLines({ year: 2024, role: 'bat', minPA: 502 });
  check('2024 qualified batters is a plausible count',
    lines.length > 100 && lines.length < 200, `n=${lines.length}`);
  check('seasonLines numerics are plain numbers, not BigInt',
    lines.length === 0 || typeof lines[0].pa === 'number', typeof lines[0]?.pa);

  const pitchers = await s.seasonLines({ year: 2024, role: 'pit' });
  check('2024 has pitchers', pitchers.length > 500, `n=${pitchers.length}`);

  const lad = await s.teamLineup({ year: 2024, team: 'LAD' });
  check('lineup returns nine batters', lad.length === 9, `n=${lad.length}`);
  check('lineup carries statcast speed',
    lad.filter((p) => p.spd != null).length >= 7,
    `with spd=${lad.filter((p) => p.spd != null).length}`);
  check('lineup has the fields sim.js needs',
    lad[0] && ['name', 'pos', 'pa', 'h', 'd2', 'd3', 'hr', 'bb', 'so']
      .every((k) => lad[0][k] != null), JSON.stringify(lad[0]));

  const sd = await s.sigma('runs_per_game', 2000, 2024);
  check('season-to-season sigma is a small positive number',
    sd > 0 && sd < 1.5, `sigma=${sd}`);

  await s.close();
  process.exit(failures ? 1 : 0);
})();
