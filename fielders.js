/* moreBasesBall — the defense, as real entities on the field.
 *
 * Until now the defense was a formula: a ball in play was "caught" at
 * 0.4s + flight time no matter where it landed, so a gap shot and an
 * infield pop were fielded equally fast. This module gives the defense
 * coordinates.
 *
 * Staffing rule — one rule, no special cases:
 *
 *     every plate gets a pitcher and a catcher; six more field the ball.
 *
 * So a classic one-plate field has 8 defenders and a three-plate field has
 * 12 — the shared pool stays at six however far the bases spread. That is
 * the whole point: adding bases adds ground to cover but no one to cover
 * it, so defense thins out as the polygon grows.
 *
 * The pool is placed by angle: the bases are sorted around the field
 * centroid and cut into six contiguous arcs, one fielder per arc, playing
 * alternately shallow and deep. Bases that fall between fielders are real
 * holes, and a ball hit into one takes real time to run down.
 *
 * Pure and Node-testable, like the rest of the engine.
 */
(function (global) {
  'use strict';

  const IS_NODE = typeof module !== 'undefined' && module.exports;
  const L = IS_NODE ? require('./layout.js') : global.MBB_LAYOUT;

  // Fielders run a shade slower than runners sprint: they read the ball,
  // break, and change direction. Runners are at 27 ft/s (graphsim RUN_FTS).
  const FIELD_FTS = 24;
  // Shared pool of position players, independent of how many bases exist.
  const POOL = 6;
  /* Where the pool stands.
   *
   * Infielders play just off the bags, so SHALLOW is a shade outside the
   * base ring rather than inside it.
   *
   * Outfielders are the interesting one. Depth cannot come from the base
   * ring alone: how far a ball carries is fixed physics (a batted ball
   * lands 40-330ft from the plate whatever the bases are doing), so
   * scaling the outfield to a 90ft diamond parked the deepest man 138ft
   * from home — closer than a routine fly ball — and nothing was ever
   * caught in the air. No catches means no tagging up and no force ever
   * being removed, so the runner rules could not work either.
   *
   * So the outfield plays at whichever is deeper: the base ring, or the
   * distance the ball actually travels. On a big field the bases win and
   * the outfield spreads with them; on a small one the ball wins and the
   * outfield backs up to where fly balls come down.
   */
  const DEEP = 1.55, SHALLOW = 1.15;
  // Carry-driven outfield depth from the field centre, in feet.
  const OF_DEPTH_FT = 215;
  // Catchers set up this far behind their plate, on the plate-to-centroid
  // line pointed away from the field.
  const CATCHER_FT = 9;

  function ftBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) / L.FT2PX;
  }

  // How long this fielder needs to reach a point, including the read-and-
  // break beat before the first step.
  function travelSec(slot, pt) {
    return 0.25 + ftBetween(slot, pt) / FIELD_FTS;
  }

  function angleAround(c, p) {
    return Math.atan2(p.y - c.y, p.x - c.x);
  }

  // Cut `n` items into `k` contiguous runs, as evenly as the division
  // allows (the leftovers land on the leading groups).
  function splitEvenly(n, k) {
    const groups = [];
    let at = 0;
    for (let i = 0; i < k; i++) {
      const take = Math.floor(n / k) + (i < n % k ? 1 : 0);
      groups.push([at, at + take]); // [start, end)
      at += take;
    }
    return groups;
  }

  /* The defensive alignment for a layout: pitchers on their rubbers,
   * catchers behind their plates, and the six-man pool spread by angle.
   * Positions are layout canvas units, same frame as nodes and homes.
   */
  function fielderSlots(layout) {
    const c = L.basesCentroid(layout);
    const slots = [];

    const mounds = L.moundPositions(layout);
    for (const h of layout.homes) {
      const m = mounds.find((x) => x.plate === h.id);
      if (m) slots.push({ id: 'P-' + h.id, role: 'P', plate: h.id, x: m.x, y: m.y });
      // catcher: behind the plate, on the far side from the field centre
      const dx = h.x - c.x, dy = h.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      slots.push({
        id: 'C-' + h.id, role: 'C', plate: h.id,
        x: h.x + (dx / len) * CATCHER_FT * L.FT2PX,
        y: h.y + (dy / len) * CATCHER_FT * L.FT2PX,
      });
    }

    // Mean base-ring radius sets how deep the pool plays.
    // An all-plate ring (every vertex is a home) has no separate bases; the
    // plates themselves are the ring that sets how deep the pool plays.
    const real = (layout.nodes.length ? layout.nodes : layout.homes).filter(finite);
    let R = 0;
    for (const n of real) R += ftBetween(c, n);
    R = real.length ? R / real.length : 90;
    if (!Number.isFinite(R) || R < 1) R = 90; // every base stacked on the centre

    const ring = real
      .map((n) => ({ n, a: angleAround(c, n) }))
      .sort((a, b) => a.a - b.a || (a.n.id < b.n.id ? -1 : 1));

    const wedges = fairWedges(layout, c);
    const deepCount = Math.floor(POOL / 2);
    let deepSeen = 0;

    for (let i = 0; i < POOL; i++) {
      const deep = i % 2 === 1;
      const depth = deep ? Math.max(R * DEEP, OF_DEPTH_FT) : R * SHALLOW;
      let a;
      if (deep) {
        // outfielders line up across fair ground, not around the plate
        a = angleInSpans(wedges, deepSeen++, deepCount);
      } else if (ring.length) {
        // one fielder per contiguous arc of bases; empty arcs (fewer bases
        // than fielders) fall back to an even spread
        const [s, e] = splitEvenly(ring.length, POOL)[i];
        if (e > s) {
          let sx = 0, sy = 0;
          for (let k = s; k < e; k++) { sx += ring[k].n.x; sy += ring[k].n.y; }
          a = angleAround(c, { x: sx / (e - s), y: sy / (e - s) });
        } else {
          a = (i / POOL) * Math.PI * 2 - Math.PI;
        }
      } else {
        a = (i / POOL) * Math.PI * 2 - Math.PI;
      }

      slots.push({
        id: 'F' + (i + 1), role: deep ? 'OF' : 'IF', plate: null,
        x: c.x + Math.cos(a) * depth * L.FT2PX,
        y: c.y + Math.sin(a) * depth * L.FT2PX,
      });
    }

    return slots;
  }

  function finite(p) {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  }

  /* Fair territory, as an angle around the field centre.
   *
   * Balls are hit out from a plate toward the middle of the field, so the
   * ground an outfielder can usefully stand on is the wedge on the far
   * side of a plate — never behind it. With one plate that is a single
   * wedge and the outfield lines up across it the way left, centre and
   * right do. With three plates the wedges tile the whole circle, because
   * balls really do come from every direction, and the outfield spreads
   * all the way round.
   */
  const WEDGE = (60 * Math.PI) / 180;   // half-width either side of a plate's line

  function fairWedges(layout, c) {
    const spans = [];
    for (const h of layout.homes) {
      if (!finite(h)) continue;
      const mid = angleAround(c, { x: 2 * c.x - h.x, y: 2 * c.y - h.y });
      spans.push([mid - WEDGE, mid + WEDGE]);
    }
    if (!spans.length) return [[-Math.PI, Math.PI]];
    // normalise to [-PI, PI) starts, sort, then merge what overlaps
    const norm = spans.map(([a, b]) => {
      let s0 = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      return [s0, s0 + (b - a)];
    }).sort((x, y) => x[0] - y[0]);
    const merged = [norm[0].slice()];
    for (const [a, b] of norm.slice(1)) {
      const last = merged[merged.length - 1];
      if (a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    let total = merged.reduce((t, [a, b]) => t + (b - a), 0);
    if (total >= 2 * Math.PI - 1e-9) return [[-Math.PI, Math.PI]];
    return merged;
  }

  // The i-th of k evenly spaced angles across a set of spans.
  function angleInSpans(spans, i, k) {
    const total = spans.reduce((t, [a, b]) => t + (b - a), 0);
    let want = ((i + 0.5) / k) * total;
    for (const [a, b] of spans) {
      const w = b - a;
      if (want <= w) return a + want;
      want -= w;
    }
    return spans[spans.length - 1][1];
  }

  function nearest(slots, pt, taken) {
    if (!finite(pt)) return null;
    let best = null, bestD = Infinity;
    for (const s of slots) {
      if (taken && taken.has(s.id)) continue;
      if (!finite(s)) continue;
      const d = ftBetween(s, pt);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /* Who does what on this ball.
   *   fielder   the slot that runs the ball down, and how long it takes
   *   coverers  one slot per bag the play could be made at, each with the
   *             time it needs to get there
   *   uncovered bags nobody was left to cover — free bases, and the reason
   *             a big field with a six-man pool leaks
   *
   * Two rules, in order. A plate is covered by its own catcher when that
   * catcher is free, which is what keeps a throw home quick even on a
   * sprawling field. Everyone else is matched to a bag shortest-distance
   * first across the whole play, so the nearest man to any bag gets it —
   * not whoever happened to be asked first. That matters on custom layouts,
   * where the bags in play are in no particular order and a naive
   * first-come assignment can send a deep outfielder to a bag that the man
   * standing next to it could have covered.
   *
   * No randomness anywhere: the same layout and the same bags always give
   * the same assignment, which is what keeps a seeded game reproducible.
   */
  function assignPlay(layout, slots, contact, nodeIds) {
    const taken = new Set();
    const fielder = nearest(slots, contact, null);
    if (!fielder) {
      return { fielder: null, tReach: Infinity, coverers: [], uncovered: (nodeIds || []).slice() };
    }
    taken.add(fielder.id);

    const bags = [];
    const seen = new Set();
    for (const id of nodeIds || []) {
      if (seen.has(id)) continue;         // the same bag asked for twice
      seen.add(id);
      const p = L.findNode(layout, id);
      if (!finite(p)) continue;           // missing or malformed node
      bags.push({ id, p });
    }

    const coverers = [];
    const pending = [];
    for (const b of bags) {
      const own = slots.find((s) => s.role === 'C' && s.plate === b.id);
      if (own && !taken.has(own.id) && finite(own)) {
        taken.add(own.id);
        coverers.push({ node: b.id, slot: own, tArrive: travelSec(own, b.p) });
      } else {
        pending.push(b);
      }
    }

    const pairs = [];
    for (const b of pending) {
      for (const s of slots) {
        if (taken.has(s.id) || !finite(s)) continue;
        pairs.push({ b, s, d: ftBetween(s, b.p) });
      }
    }
    // ids break ties so the result never depends on array order
    pairs.sort((x, y) =>
      x.d - y.d ||
      (x.b.id === y.b.id ? 0 : x.b.id < y.b.id ? -1 : 1) ||
      (x.s.id === y.s.id ? 0 : x.s.id < y.s.id ? -1 : 1));

    const covered = new Set();
    for (const pr of pairs) {
      if (covered.has(pr.b.id) || taken.has(pr.s.id)) continue;
      covered.add(pr.b.id);
      taken.add(pr.s.id);
      coverers.push({ node: pr.b.id, slot: pr.s, tArrive: travelSec(pr.s, pr.b.p) });
    }

    return {
      fielder,
      tReach: travelSec(fielder, contact),
      coverers,
      uncovered: pending.filter((b) => !covered.has(b.id)).map((b) => b.id),
    };
  }

  // The covering fielder for one node, or null if nobody is assigned.
  function covererFor(assign, nodeId) {
    return (assign.coverers.find((c) => c.node === nodeId) || null);
  }

  /* ---- fielding difficulty -------------------------------------------
   * Both functions are PURE: numbers in, a number out, no rnd. The
   * sampling lives in graphsim.js, which already owns every random draw
   * in the defense. That is what keeps the "No randomness anywhere"
   * contract above true, and tests/fielders.test.js and
   * tests/defense-stress.test.js both depend on it.
   *
   * `slack` is seconds to spare: the ball's hang time minus the time the
   * fielder needs to reach it. Positive means he is waiting for it.
   */
  const CATCH_K = 5.2;        // pinned by the observed 5-star catch rate
  const ORDINARY_S = 0.25;    // below this, Rule 9.12 forbids an error
  const MUFF_DECAY_S = 0.90;  // how fast a routine play gets safe

  /* Probability he comes up with it. Anchored on Statcast's published
   * 5-star bands (5* = 0-25% caught, 4* = 26-50%, 3* = 51-75%, 2* =
   * 76-90%, 1* = 91-95%) and on the one hard figure published: 192 of
   * 2688 five-star chances were caught in 2025, 7.1%. CATCH_K = 5.2 is
   * chosen so slack = -0.5s lands on that 7.1%. A failure here is a HIT.
   */
  function catchChance(slack) {
    if (typeof slack !== 'number' || Number.isNaN(slack)) return 0;
    if (slack === Infinity) return 1;
    if (slack === -Infinity) return 0;
    return 1 / (1 + Math.exp(-CATCH_K * slack));
  }

  /* Probability he butchers a play he actually had. Zero below ordinary
   * effort: MLB Rule 9.12 charges an error only where ordinary effort
   * would have made the play, so a failure on anything harder is scored
   * a hit and never an error. That gate is why this curve is not simply
   * the inverse of catchChance -- real errors concentrate at the EASY
   * end. Above the gate the risk is highest right at the edge of
   * ordinary effort and decays as the play gets more routine.
   * A failure here is an ERROR.
   */
  function muffChance(slack, e0) {
    if (typeof e0 !== 'number' || !Number.isFinite(e0) || e0 <= 0) return 0;
    if (typeof slack !== 'number' || !Number.isFinite(slack)) return 0;
    if (slack < ORDINARY_S) return 0;
    return e0 * Math.exp(-(slack - ORDINARY_S) / MUFF_DECAY_S);
  }

  const API = {
    FIELD_FTS, POOL, DEEP, SHALLOW, OF_DEPTH_FT, CATCHER_FT,
    finite, fairWedges, angleInSpans, WEDGE,
    fielderSlots, assignPlay, covererFor, travelSec, splitEvenly,
    catchChance, muffChance, CATCH_K, ORDINARY_S, MUFF_DECAY_S,
  };
  if (IS_NODE) module.exports = API;
  else global.MBB_FIELDERS = API;
})(typeof window !== 'undefined' ? window : globalThis);
