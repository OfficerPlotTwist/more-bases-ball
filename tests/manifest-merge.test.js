/* data/_build.json is MERGED, never replaced. Run: node tests/manifest-merge.test.js
 *
 * `node tools/build-seasons.mjs 2023 2024` used to overwrite a 150-year
 * manifest with a 2-year one while all 150 parquet files stayed on disk. The
 * downgraded manifest still said complete:true, so build-coverage.mjs and
 * openSpine() both passed it — and coverage.json's leagueOnlySeasons, derived
 * from this file, would have collapsed from 111 club-years to whatever those
 * two years hold.
 *
 * mergeManifest is pure (no fs, no network, no globals) precisely so this can
 * run on a fresh clone with no data/ and no network. */
'use strict';
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const year = (y, over) => ({
  year: y, clubsExpected: 30, clubsFetched: 30, clubsWithRows: 30,
  clubsEmpty: [], seasonRows: 1000, leagueRows: 30, ...over,
});

/* 1876-2025, the real shape: 150 entries, a couple of them carrying the
 * league-only clubs that coverage.json reports as leagueOnlySeasons. */
function existing150() {
  const years = [];
  for (let y = 1876; y <= 2025; y++) years.push(year(y, { seasonRows: y }));
  const y1924 = years.find((y) => y.year === 1924);
  y1924.clubsExpected = 38;
  y1924.clubsFetched = 38;
  y1924.clubsWithRows = 30;
  y1924.clubsEmpty = ['BLB', 'CAG', 'DTS', 'HBG', 'KCM', 'MRS', 'SLS', 'WSP'];
  return {
    tool: 'build-seasons.mjs',
    startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:30:00.000Z',
    complete: true,
    firstYear: 1876,
    lastYear: 2025,
    years,
    failures: [],
  };
}

const scopedRun = (over) => ({
  tool: 'build-seasons.mjs',
  startedAt: '2026-09-17T10:00:00.000Z',
  finishedAt: '2026-09-17T10:00:30.000Z',
  firstYear: 2023,
  lastYear: 2024,
  years: [year(2023, { seasonRows: 999999 }), year(2024, { seasonRows: 999999 })],
  failures: [],
  finishedLoop: true,
  ...over,
});

(async () => {
  const mod = await import(
    require('node:url').pathToFileURL(path.join(__dirname, '..', 'tools', 'build-seasons.mjs')).href);
  check('importing build-seasons.mjs exports mergeManifest without building',
    typeof mod.mergeManifest === 'function');
  const { mergeManifest } = mod;

  /* THE HEADLINE. A 2-year scoped run must not shrink a 150-year manifest. */
  {
    const m = mergeManifest(existing150(), scopedRun());
    check('scoped 2023-2024 run keeps all 150 years', m.years.length === 150,
      `years=${m.years.length}`);
    check('firstYear stays 1876', m.firstYear === 1876, `firstYear=${m.firstYear}`);
    check('lastYear stays 2025', m.lastYear === 2025, `lastYear=${m.lastYear}`);
    check('complete stays true', m.complete === true, `complete=${m.complete}`);
    check('years are sorted ascending',
      m.years.every((y, i) => i === 0 || m.years[i - 1].year < y.year));

    /* The rebuilt years carry THIS run's entries, not the stale ones. */
    const y23 = m.years.find((y) => y.year === 2023);
    const y24 = m.years.find((y) => y.year === 2024);
    check('2023 carries the run entry, not the existing one', y23.seasonRows === 999999,
      `seasonRows=${y23.seasonRows}`);
    check('2024 carries the run entry, not the existing one', y24.seasonRows === 999999,
      `seasonRows=${y24.seasonRows}`);

    /* An untouched year is byte-for-byte what it was, clubsEmpty included —
     * that array is the Negro Leagues provenance. */
    const y1924 = m.years.find((y) => y.year === 1924);
    check('1924 keeps its existing entry untouched', y1924.seasonRows === 1924,
      `seasonRows=${y1924.seasonRows}`);
    check('1924 keeps its 8 clubsEmpty entries', y1924.clubsEmpty.length === 8
      && y1924.clubsEmpty[0] === 'BLB', y1924.clubsEmpty.join(','));
    check('total clubsEmpty across the merged manifest is preserved',
      m.years.reduce((a, y) => a + y.clubsEmpty.length, 0) === 8);

    /* lastRun says what the invocation did; firstYear/lastYear say what the
     * manifest as a whole describes. A reader needs both. */
    check('lastRun reports the invocation range 2023-2024',
      m.lastRun.firstYear === 2023 && m.lastRun.lastYear === 2024,
      `${m.lastRun.firstYear}-${m.lastRun.lastYear}`);
    check('lastRun.finishedAt matches the run', m.lastRun.finishedAt === m.finishedAt);
  }

  /* First ever build: no regression on the normal path. */
  {
    const m = mergeManifest(null, {
      ...scopedRun(), firstYear: 1876, lastYear: 1877,
      years: [year(1876), year(1877)],
    });
    check('existing=null yields exactly the run years', m.years.length === 2,
      `years=${m.years.length}`);
    check('existing=null yields the run range',
      m.firstYear === 1876 && m.lastYear === 1877, `${m.firstYear}-${m.lastYear}`);
    check('existing=null with a clean finished loop is complete', m.complete === true);
  }

  /* A prior failure in a year this run did not touch must survive, and must
   * keep complete false until that year is rebuilt. */
  {
    const e = existing150();
    e.complete = false;
    e.failures = [{ year: 1901, club: 'BOS', error: 'HTTP 503' }];
    const m = mergeManifest(e, scopedRun());
    check('a prior failure in an untouched year survives the merge',
      m.failures.length === 1 && m.failures[0].year === 1901,
      JSON.stringify(m.failures));
    check('an inherited failure keeps complete false', m.complete === false);
  }

  /* A failure inside the rebuilt range is superseded by the rerun. */
  {
    const e = existing150();
    e.complete = false;
    e.failures = [{ year: 2023, club: 'LAD', error: 'HTTP 503' }];
    const m = mergeManifest(e, scopedRun());
    check('a failure inside the rebuilt range is cleared by the rerun',
      m.failures.length === 0 && m.complete === true, JSON.stringify(m.failures));
  }

  /* An aborted loop is never complete, however clean the merged years look. */
  {
    const m = mergeManifest(existing150(), scopedRun({ finishedLoop: false }));
    check('finishedLoop:false yields complete:false even with clean years',
      m.complete === false && m.years.length === 150,
      `complete=${m.complete} years=${m.years.length}`);
  }

  /* A short year anywhere in the merged set blocks completeness. */
  {
    const e = existing150();
    e.years.find((y) => y.year === 1950).clubsFetched = 15;
    const m = mergeManifest(e, scopedRun());
    check('an inherited short year keeps complete false', m.complete === false);
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
