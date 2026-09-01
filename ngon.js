/* moreBasesBall — geometry for classic N-gon games.
 *
 * sim.js plays the classic game as a pure state machine: a base is an index
 * in an array, and a play is that array changing. Those are the outcomes the
 * project has always published (1 base ≈ 18 runs/game, 7 ≈ 6), so this
 * module does not touch them. It reads the finished log and works out where
 * on an actual field each play happened — which base each runner ran from
 * and to, where the ball was hit, where the throw went — and hands every
 * entry the same `anim` timeline the custom-layout engines produce.
 *
 * The result: the classic diamond animates in 2D and 3D exactly like a
 * custom layout, while the box score stays byte-for-byte what sim.js said.
 *
 * Base index i in `basesAfter` is node N(i+1); home is H1.
 */
(function (global) {
  'use strict';

  const IS_NODE = typeof module !== 'undefined' && module.exports;
  const L = IS_NODE ? require('./layout.js') : global.MBB_LAYOUT;
  const CORE = IS_NODE ? require('./sim.js') : global.MBB_SIM;
  const GS = IS_NODE ? require('./graphsim.js') : global.MBB_GSIM;
  const F = IS_NODE ? require('./fielders.js') : global.MBB_FIELDERS;
  const { contactFor, buildAnim } = GS._internals;

  const DEFAULT_SPACING = 90;

  const cache = new Map();
  // Layouts are immutable per (bases, spacing), so build each one once.
  function layoutFor(bases, spacingFt) {
    const key = bases + '@' + (spacingFt || DEFAULT_SPACING);
    if (!cache.has(key)) cache.set(key, L.makeNgon(bases, spacingFt || DEFAULT_SPACING));
    return cache.get(key);
  }

  const nodeAt = (i) => 'N' + (i + 1);

  // The node chain a runner covers going from base index `i` to base index
  // `j` (j > i), or all the way home when `j` is null.
  function ringPath(i, j, bases) {
    const out = [nodeAt(i)];
    const last = j == null ? bases - 1 : j;
    for (let k = i + 1; k <= last; k++) out.push(nodeAt(k));
    if (j == null) out.push('H1');
    return out;
  }

  // The batter's chain out of the box to base index `j`, or a full lap.
  function batterPath(j, bases) {
    const out = ['H1'];
    const last = j == null ? bases - 1 : j;
    for (let k = 0; k <= last; k++) out.push(nodeAt(k));
    if (j == null) out.push('H1');
    return out;
  }

  /* Where the defense sent the ball. Classic sim.js only tells us the shape
   * of the out, so read it back off the sub-type:
   *   SF  runner tagging from the last base — the throw goes home
   *   DP  force at the lead base, relayed on to first
   *   otherwise the batter is thrown out at first
   */
  function throwTargets(entry, bases) {
    if (entry.sub === 'SF') return { throwTo: 'H1', relayTo: null };
    if (entry.sub === 'DP' && bases >= 2) return { throwTo: 'N2', relayTo: 'N1' };
    return { throwTo: 'N1', relayTo: null };
  }

  const HIT = { '1B': 1, '2B': 1, '3B': 1, HR: 1 };

  /* Give one play its geometry. `prev` is the base state before the play,
   * as a names array the same length as `basesAfter`.
   */
  function placeEntry(entry, prev, layout, bases, rnd, slots) {
    const after = entry.basesAfter || [];
    const scored = new Set(entry.scorers || []);
    entry.plate = 'H1';
    // there is only one plate on a classic field, so the play-by-play has
    // no reason to say which one the batter used
    entry.onePlate = true;
    entry.moves = [];
    entry.runnersOut = entry.runnersOut || [];

    for (let i = 0; i < prev.length; i++) {
      const name = prev[i];
      if (!name) continue;
      const j = after.indexOf(name);
      if (j > i) {
        entry.moves.push({ name, path: ringPath(i, j, bases) });
      } else if (j < 0 && scored.has(name)) {
        entry.moves.push({ name, path: ringPath(i, null, bases), scored: true });
      } else if (j < 0) {
        // gone from the bases and never crossed the plate: retired
        entry.moves.push({ name, path: ringPath(i, Math.min(i + 1, bases - 1), bases), out: true });
        entry.runnersOut.push(name);
      }
    }

    const b = entry.batter;
    const jb = after.indexOf(b);
    if (jb >= 0) {
      entry.moves.push({ name: b, path: batterPath(jb, bases) });
    } else if (scored.has(b)) {
      entry.moves.push({ name: b, path: batterPath(null, bases), scored: true });
    } else if (entry.type !== 'K' && entry.type !== 'BB') {
      entry.moves.push({ name: b, path: ['H1', 'N1'], out: true });
    }

    if (entry.type !== 'K' && entry.type !== 'BB') {
      entry.contact = contactFor(layout, 'H1', HIT[entry.type] ? entry.type : 'OUT', rnd);
      if (entry.type === 'OUT') {
        const t = throwTargets(entry, bases);
        entry.throwTo = t.throwTo;
        entry.relayTo = t.relayTo;
      }
    }

    entry.occupancyAfter = after
      .map((name, i) => (name ? { node: nodeAt(i), name } : null))
      .filter(Boolean);

    buildAnim(layout, entry, slots);
    return entry;
  }

  /* Walk a finished classic game and give every play a place to happen.
   * Mutates `game.log` in place and returns the layout the plays sit on.
   */
  function attachGeometry(game, seed) {
    const bases = game.cfg.bases;
    const layout = layoutFor(bases, DEFAULT_SPACING);
    const slots = F.fielderSlots(layout);
    const rnd = CORE.mulberry32(seed == null ? 1234567 : seed >>> 0);

    let prev = new Array(bases).fill(null);
    let key = '';
    for (const entry of game.log) {
      const k = entry.inning + '|' + entry.half;
      if (k !== key) { prev = new Array(bases).fill(null); key = k; }
      placeEntry(entry, prev, layout, bases, rnd, slots);
      prev = entry.basesAfter.slice();
    }
    game.layout = layout;
    return layout;
  }

  const API = { layoutFor, attachGeometry, placeEntry, ringPath, batterPath, DEFAULT_SPACING };
  if (IS_NODE) module.exports = API;
  else global.MBB_NGON = API;
})(typeof window !== 'undefined' ? window : globalThis);
