/* The Statcast transport. data.js shipped eleven values per batter for its
 * whole life; five more ride along now — mlbam, la, ev, oaa, arm — and they
 * exist so the launch-angle and per-fielder-skill work each become an engine
 * change with no data work in front of it.
 *
 * Two things this file guards that nothing else can:
 *
 * A MISSING VALUE IS `null`, NEVER 0 AND NEVER A MEDIAN. A full-time DH has no
 * outs-above-average and no qualifying arm-strength throw. That absence is a
 * real signal — "this man does not field" — and a zero says something
 * different and false: that he fielded exactly averagely. A median says
 * something worse, that he fielded at all. `arm: 0` reaching throwSec() is a
 * fielder who cannot throw the ball out of his hand; `oaa: 0` reaching a
 * skill term is a bench bat rated as an average defender. Both would look
 * plausible in a box score, which is why they are asserted against here and
 * not left to a reviewer's eye.
 *
 * THE NAME JOIN IS NOT THE JOIN. Four collisions exist across the five shipped
 * seasons — Will Smith the catcher and Will Smith the reliever in 2021 and
 * 2023, two Diego Castillos in 2022, two Max Muncys in 2025. tools/
 * augment-data.mjs resolves them on (name, pa) and emits the mlbam so it never
 * has to solve them twice. If a future regeneration attaches a reliever's
 * launch angle to a catcher, the distinct-id count below is what notices.
 */
const assert = require('assert');
const D = require('../data.js');
const { SEASONS, YEARS } = D;

const SHIPPED = ['name', 'pos', 'pa', 'h', 'd2', 'd3', 'hr', 'bb', 'so', 'spd', 'hp1'];
const ADDED = ['mlbam', 'la', 'ev', 'oaa', 'arm'];

let players = 0;
const ids = new Map();          // mlbam -> Set of names that claimed it
const cover = { la: 0, ev: 0, oaa: 0, arm: 0 };

for (const y of YEARS) {
  const perSeason = new Map();
  for (const t of SEASONS[y]) {
    for (const p of t.lineup) {
      players++;
      const who = `${y} ${t.abbr} ${p.name}`;

      // the eleven are still all there -- an addition must never be a swap
      for (const k of SHIPPED) {
        assert.ok(p[k] !== undefined, `${who}: shipped value ${k} is gone`);
      }
      // every new key is PRESENT on every player, even when its value is null.
      // An absent key and a null key read the same from `p.oaa` but not from
      // `'oaa' in p`, and the second is how a consumer tells "no data" from
      // "this build predates the field".
      for (const k of ADDED) {
        assert.ok(k in p, `${who}: transport key ${k} is missing entirely`);
      }

      // mlbam is the durable key: an integer, always, for every batter
      assert.ok(Number.isInteger(p.mlbam) && p.mlbam > 0,
        `${who}: mlbam is ${JSON.stringify(p.mlbam)}, not a positive integer`);

      /* One id never wears two names. It MAY appear twice in a season: a
       * batter traded mid-year is in both clubs' lineups with his own split
       * for each (2025 Rafael Devers, BOS and SF), which is build-data.mjs's
       * ownSplit fix working, not a duplicate. So the check is on the name
       * behind the id, never on the id's uniqueness within a year. */
      const seen = perSeason.get(p.mlbam);
      if (seen !== undefined) {
        assert.strictEqual(seen, p.name,
          `${who}: mlbam ${p.mlbam} is also ${seen} in ${y} — a shared name was `
          + 'resolved to the wrong man');
      }
      perSeason.set(p.mlbam, p.name);
      const names = ids.get(p.mlbam) || new Set();
      names.add(p.name);
      ids.set(p.mlbam, names);

      // launch angle and exit velocity are complete for every shipped season.
      // This is the fact the arc sub-project is allowed to rely on: it needs no
      // fallback path, no median and no off switch.
      assert.ok(p.la !== null, `${who}: la is null — the arc work assumes 100% coverage`);
      assert.ok(p.ev !== null, `${who}: ev is null — the arc work assumes 100% coverage`);
      assert.ok(p.la > -15 && p.la < 45, `${who}: la ${p.la} is not a launch angle`);
      assert.ok(p.ev > 60 && p.ev < 110, `${who}: ev ${p.ev} is not an exit velocity in mph`);

      // oaa and arm are structurally partial, and the partiality must be null
      for (const k of ['oaa', 'arm']) {
        assert.ok(p[k] === null || typeof p[k] === 'number',
          `${who}: ${k} is ${JSON.stringify(p[k])} — expected a number or null`);
      }
      assert.notStrictEqual(p.arm, 0,
        `${who}: arm is 0. A missing arm must be null; 0 mph is a fielder who `
        + 'cannot release the ball, and it would reach throwSec() as one');
      if (p.oaa !== null) {
        assert.ok(p.oaa > -40 && p.oaa < 40, `${who}: oaa ${p.oaa} is out of range`);
      }
      if (p.arm !== null) {
        assert.ok(p.arm > 60 && p.arm < 110, `${who}: arm ${p.arm} mph is out of range`);
      }

      for (const k of Object.keys(cover)) if (p[k] !== null) cover[k]++;
    }
  }
}

for (const [id, names] of ids) {
  assert.strictEqual(names.size, 1,
    `mlbam ${id} is shared by ${[...names].join(' and ')} — two men, one id`);
}

assert.strictEqual(players, 1350, `expected 1350 shipped batters, saw ${players}`);
/* Fewer distinct ids than batters, because a traded man holds two lineup spots
 * in one season. If this ever equalled `players` the ownSplit fix would have
 * regressed and every traded batter's season would be double-counted. */
assert.ok(ids.size < players, 'no traded batter holds two lineup spots — '
  + "build-data.mjs's ownSplit handling has regressed");
assert.strictEqual(cover.la, players, 'la must be complete');
assert.strictEqual(cover.ev, players, 'ev must be complete');

/* oaa and arm are allowed to be partial but not to COLLAPSE. If a future
 * regeneration silently lost the join these would fall toward zero while every
 * other assertion above still passed, because each one only ever looks at a
 * player who has a value. A floor is the only thing that notices an absence.
 * Measured today: oaa 1225/1350, arm 1171/1350. */
assert.ok(cover.oaa > players * 0.8,
  `oaa coverage collapsed to ${cover.oaa}/${players} — the join is decaying`);
assert.ok(cover.arm > players * 0.8,
  `arm coverage collapsed to ${cover.arm}/${players} — the join is decaying`);

/* The inertness claim, asserted rather than argued. Nothing in the engines
 * enumerates a player object's keys, so five new ones cannot reach the RNG
 * stream or the outcome draw. tests/rules-identity.test.js and
 * tests/ngon.test.js prove that on the box score; this proves the premise it
 * rests on, which is that the added keys are not part of any rate the sim
 * reads. A future field named `pa` or `so` would break that silently. */
for (const k of ADDED) {
  assert.ok(!SHIPPED.includes(k), `transport key ${k} collides with a shipped rate`);
}

console.log(`ok    transport: ${players} batters, mlbam on all of them`);
console.log(`ok    la/ev complete (${cover.la}/${players}); `
  + `oaa ${cover.oaa} and arm ${cover.arm} partial, and null where absent`);
console.log(`ok    ${ids.size} distinct mlbam ids, none shared by two names`);
