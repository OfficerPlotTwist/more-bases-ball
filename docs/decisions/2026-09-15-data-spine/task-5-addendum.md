# Task 5 — ADDENDUM (controller ruling, overrides the brief's BOARDS table)

I probed every Savant endpoint in the brief before dispatching. All six URLs are
alive, but **four of the five board definitions have wrong column names**, and the
name extraction is wrong on all of them. Left as written, the build would either
throw "schema drifted" or silently write columns of nulls — the exact failure the
brief's guard was designed to prevent, caused by the guard's own expectations
being wrong.

## What I measured

| Board | Status | Problem |
|---|---|---|
| `sprint_speed` | correct as written | none |
| `expected_statistics` | **wrong** | has no `avg_hit_speed` / `avg_launch_angle`. Its columns are `ba, est_ba, slg, est_slg, woba, est_woba, pa, bip` |
| `outs_above_average` | correct as written | none |
| `arm-strength` | **wrong** | there is no `arm_overall`. Real columns: `max_arm_strength`, `arm_1b`…`arm_of` |
| `bat-tracking` | **wrong** | column is `swing_length`, not `avg_swing_length`; the id column is `id`, not `player_id` |
| exit velo / launch angle | **missing board** | lives on `/leaderboard/statcast`, which the brief never fetches |

Row counts confirming each is live: sprint_speed 2015 → 550, expected_statistics
2015 → 964, outs_above_average 2016 → 544, arm-strength 2020 → 242,
bat-tracking 2023 → 203, statcast 2015 → **480**.

> **CORRECTION (controller, after Task 5's build).** This document originally
> stated statcast 2015 → 1543. That was my transcription error: 1543 was the line
> count of the **HTML error page** returned by `exit_velocity_barrels`, which I
> mistakenly copied onto the `statcast` row. Re-probed: `min=50` returns 480
> consistently, which is what the implementer measured. It reported the mismatch
> and declined to guess a replacement URL — the correct behaviour, and the reason
> this got caught.
>
> `min=50` is retained deliberately. It is Savant's own qualified threshold, and a
> player's average exit velocity over fewer than 50 batted balls is noise rather
> than a measurement. `min=0` would return 964 for 2015, roughly doubling the
> player count at the cost of meaningless averages for players with a handful of
> batted balls. Task 6's `coverage.json` measures what actually lands, so the
> narrower EV/LA coverage is reported honestly rather than hidden.

`/leaderboard/exit_velocity_barrels` returns an HTML page, not CSV. Do not use it.

## Replace the BOARDS table with exactly this

Six boards, not five. Every column name below I read off the live response.

```js
const BOARDS = [
  { key: 'speed', from: 2015, id: 'player_id',
    needs: ['player_id', 'sprint_speed', 'hp_to_1b'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/sprint_speed`
      + `?year=${y}&position=&team=&min=10&csv=true`,
    map: (r) => ({ spd: +r.sprint_speed, hp1: +r.hp_to_1b }) },

  { key: 'xstats', from: 2015, id: 'player_id',
    needs: ['player_id', 'est_woba'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/expected_statistics`
      + `?type=batter&year=${y}&position=&team=&min=50&csv=true`,
    map: (r) => ({ xwoba: +r.est_woba }) },

  // The exit-velocity / launch-angle board the brief omitted.
  { key: 'statcast', from: 2015, id: 'player_id',
    needs: ['player_id', 'avg_hit_speed', 'avg_hit_angle'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/statcast`
      + `?type=batter&year=${y}&position=&team=&min=50&csv=true`,
    map: (r) => ({ ev: +r.avg_hit_speed, la: +r.avg_hit_angle }) },

  { key: 'oaa', from: 2016, id: 'player_id',
    needs: ['player_id', 'outs_above_average'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/outs_above_average`
      + `?type=Fielder&startYear=${y}&endYear=${y}&min=1&csv=true`,
    map: (r) => ({ oaa: Math.round(+r.outs_above_average) }) },

  { key: 'arm', from: 2020, id: 'player_id',
    needs: ['player_id', 'max_arm_strength'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/arm-strength`
      + `?type=player&year=${y}&minThrows=10&csv=true`,
    map: (r) => ({ arm: +r.max_arm_strength }) },

  { key: 'bat', from: 2023, id: 'id',
    needs: ['id', 'avg_bat_speed', 'swing_length'],
    url: (y) => `https://baseballsavant.mlb.com/leaderboard/bat-tracking`
      + `?year=${y}&type=batter&min=50&csv=true`,
    map: (r) => ({ bat_speed: +r.avg_bat_speed, swing_len: +r.swing_length }) },
];
```

Note each board now declares its own `id` column. Replace the brief's
`idOf = (r) => +(r.player_id ?? r.id)` with `+r[board.id]` — an explicit
per-board key rather than a guess that happens to work.

## Player names — the brief's extraction produces empty strings

The brief builds the name from `r.first_name` and `r.last_name`. **Neither column
exists on any of these boards.** Every row would get `name: ""`.

Four of the six boards carry a single column literally named
`last_name, first_name` — a quoted CSV header containing a comma, so after
`parseCsv` the key is the exact string `"last_name, first_name"` and the value
looks like `"Ohtani, Shohei"`. `arm-strength` uses `fielder_name` and
`bat-tracking` uses `name`; both are already in `First Last` order.

Handle all three shapes:

```js
/* Savant is inconsistent: most boards carry one column literally named
 * "last_name, first_name" holding "Ohtani, Shohei"; arm-strength uses
 * fielder_name and bat-tracking uses name, both already First Last. */
const nameOf = (r) => {
  const combined = r['last_name, first_name'];
  if (combined && combined.includes(',')) {
    const [last, first] = combined.split(',').map((s) => s.trim());
    return `${first} ${last}`;
  }
  return (combined || r.fielder_name || r.name || '').trim();
};
```

Do not fall back to an empty string silently. If a row yields no name, keep the
row — `mlbam` is the key that matters — but count those rows and print the count
in the per-year log line so a future header rename is visible.

## Everything else in the brief stands

The schema-drift guard, the per-year parquet write, the `data/statcast/{year}.parquet`
column list, and the test are unchanged — except that the test's
`first('bat_speed') === 2023` and `first('arm') === 2020` assertions now hold
against the corrected boards rather than failing on null columns.

Add `ev`/`la` first-year coverage to the test too: `first('ev')` must be 2015,
since that board now exists.

Keep the cache-summary line every other builder prints:
`console.log(\`cache  ${cs.hits} hits  ${cs.misses} fetched\`)`.

## Why the guard did not save us

The brief's `needs` check throws when a declared column is missing — good design,
and it would have fired here. But it can only be as correct as the column names
someone wrote into it, and four of five were wrong. A drift guard validates the
response against your *belief* about the response; it cannot tell you the belief
was never true. That is what the pre-flight probe is for, and it is why these six
column lists were read off live responses rather than recalled.

**Cost if this ruling is wrong:** the boards are fetched with names I verified on
one year each (2015, 2016, 2020, 2023). If Savant changed a column name for some
other season, the guard now fires correctly and loudly, which is the intended
behaviour.
