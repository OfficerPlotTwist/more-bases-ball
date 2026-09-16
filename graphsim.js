/* moreBasesBall — graph engine: games on custom layouts.
 * Batters rotate through the three home plates; each runner races along
 * directed basepaths to their scoring plate (own plate or clockwise next).
 *
 * Distance-aware: edge lengths are real feet (canvas px ÷ 1.2). Runner and
 * throw travel times decide stretches, contact-play advances, and defensive
 * cut-downs, and every play emits an animation timeline (ball + runners).
 */
(function (global) {
  'use strict';

  const IS_NODE = typeof module !== 'undefined' && module.exports;
  const L = IS_NODE ? require('./layout.js') : global.MBB_LAYOUT;
  const CORE = IS_NODE ? require('./sim.js') : global.MBB_SIM;
  const F = IS_NODE ? require('./fielders.js') : global.MBB_FIELDERS;

  const MAX_EXTRA = 30;
  // movement physics, ft/s: sprint speed (Statcast average ~27), throw
  // velocity (~92 mph), pitch flight, batted-ball travel
  const RUN_FTS = 27, THROW_FTS = 135, PITCH_FTS = 132, HIT_FTS = 110;

  /* ---------------- RUN MODEL ----------------
   * Nobody runs at a flat speed from a standing start, and the two numbers
   * that say so are measured, not invented. Every batter in data.js carries
   *   spd  his Statcast sprint speed (ft/s, peak one-second window)
   *   hp1  his average home-to-first time (s, over 90 ft)
   * A flat 27 ft/s covers 90 ft in 3.33s; the league actually takes ~4.44s
   * out of the box, because the swing, the turn and the acceleration from
   * rest are all in there. The gap between the two IS the start-up cost:
   *
   *   startCost = hp1 - 90 / spd          (~1.15s at the league median)
   *
   * so a leg is  distance / spd + startCost,  and every player's own
   * home-to-first time is reproduced exactly by construction.
   *
   * Leaving a base is not the same as leaving the box: no swing to finish,
   * and a runner takes a primary lead and is already leaning. Statcast does
   * not publish base-to-base times, so unlike spd and hp1 these two are
   * MODEL, not measurement, and are the honest place to tune:
   */
  const LEAD_FT = 12;        // primary + secondary lead, already covered
  const BASE_START = 0.45;   // fraction of the start-up cost still paid

  function topSpeed(r) {
    return (r && r.spd > 0) ? r.spd : RUN_FTS;
  }

  function startCost(r) {
    const v = topSpeed(r);
    if (!r || !(r.hp1 > 0)) return 0;
    return Math.max(0, r.hp1 - 90 / v);
  }

  // Seconds for one runner to cover `ft`. `fromPlate` is the leg out of the
  // batter's box; every other leg starts off a bag with a lead.
  function runSec(r, ft, fromPlate) {
    const v = topSpeed(r);
    if (fromPlate) return ft / v + startCost(r);
    return Math.max(0, ft - LEAD_FT) / v + startCost(r) * BASE_START;
  }
  // securing the ball once you have run it down, and the transfer out of
  // the glove before the throw
  const GLOVE_S = 0.15, TRANSFER_S = 0.3;
  // Beyond this the ball goes through a cutoff man rather than on the fly.
  const RELAY_AT = 200, RELAY_S = 0.55, RELAY_SPEED = 0.85;

  /* How long a throw of `ft` actually takes. Nobody throws 300 feet on a
   * line: past a long single hop the ball goes through a cutoff man, which
   * costs a catch and a release, and the relay throw is weaker than the
   * outfielder's. Treating every throw as one flat-out heave is what makes
   * a deep sacrifice fly impossible — the fielder guns down a tagging
   * runner from the warning track every time, which is not baseball.
   */
  function throwSec(ft) {
    const flight = ft <= RELAY_AT
      ? ft / THROW_FTS
      : RELAY_AT / THROW_FTS + RELAY_S + (ft - RELAY_AT) / (THROW_FTS * RELAY_SPEED);
    // Lining it up and taking it cleanly. A 60-foot infield throw is
    // barely touched by this; a 300-foot throw to the plate gains a third
    // of a second, which is the difference between gunning down every
    // tagging runner and the deep sacrifice fly being a real play — the
    // reason a defense concedes the run and hits the cutoff man instead.
    return flight + ft / 900;
  }

  function posOf(layout, id) {
    const n = L.findNode(layout, id);
    return { x: n.x, y: n.y };
  }

  function ftBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) / L.FT2PX;
  }

  // Node chain from `from` all the way to `target` along shortest hops.
  function chainToTarget(paths, target, from) {
    const P = paths[target];
    const out = [from];
    let cur = from, guard = 0;
    while (P.dist[cur] > 0 && guard++ < 500) {
      cur = P.next[cur];
      if (cur == null) return out;
      out.push(cur);
    }
    return out;
  }

  // Where a batted ball comes down: fanned out from the batting plate toward
  // the middle of the field, distance scaled to the hit type.
  function contactFor(layout, plateId, type, rnd) {
    const h = posOf(layout, plateId);
    const c = L.basesCentroid(layout);
    const ang = Math.atan2(c.y - h.y, c.x - h.x) + (rnd() - 0.5) * (Math.PI / 2);
    const R = {
      '1B': [90, 200], '2B': [180, 280], '3B': [240, 330],
      OUT: [40, 300], HR: [400, 460],
    }[type] || [60, 200];
    const distFt = R[0] + rnd() * (R[1] - R[0]);
    return {
      x: h.x + Math.cos(ang) * distFt * L.FT2PX,
      y: h.y + Math.sin(ang) * distFt * L.FT2PX,
      distFt,
    };
  }

  // Short next leg → tempting extra base; long leg → station-to-station.
  function stretchChance(edgeFt) {
    return Math.max(0.04, Math.min(0.5, 0.55 - edgeFt / 240));
  }

  // Everyone already on the paths advances `steps` nodes toward their own
  // scoring plate. Front-runners move first so trailing runners can fill in
  // behind; a blocked runner holds at the last open node. `canMove` filters
  // who runs on this ball; `geo` enables distance-based stretching and
  // records movement for the animation timeline.
  function advanceRunners(occ, steps, paths, entry, canMove, geo) {
    const movers = [...occ.entries()]
      .filter(([, r]) => (canMove ? canMove(r) : true))
      .map(([node, r]) => ({ node, r, d: paths[r.target].dist[node] }))
      .sort((a, b) => (a.d == null ? 1e9 : a.d) - (b.d == null ? 1e9 : b.d));
    for (const m of movers) {
      if (m.d == null) continue; // no route from here; runner is stranded
      const P = paths[m.r.target];
      if (m.d <= steps) {
        occ.delete(m.node);
        entry.runs++; entry.scorers.push(m.r.name);
        entry.moves.push({ name: m.r.name, spd: m.r.spd, hp1: m.r.hp1, path: chainToTarget(paths, m.r.target, m.node), scored: true });
        continue;
      }
      const chain = [m.node];
      let cur = m.node;
      for (let i = 0; i < steps; i++) {
        const nx = P.next[cur];
        if (nx == null) break;
        chain.push(nx); cur = nx;
      }
      occ.delete(m.node);
      let idx = chain.length - 1;
      while (idx > 0 && occ.has(chain[idx])) idx--;
      let land = chain[idx];
      if (geo && idx === chain.length - 1 && idx > 0) {
        const dLand = P.dist[land];
        const nx = dLand <= 1 ? m.r.target : P.next[land];
        if (nx != null) {
          const eft = ftBetween(posOf(geo.layout, land), posOf(geo.layout, nx));
          if (geo.rnd() < stretchChance(eft)) {
            if (dLand <= 1) {
              entry.runs++; entry.scorers.push(m.r.name);
              entry.moves.push({ name: m.r.name, spd: m.r.spd, hp1: m.r.hp1, path: chain.concat([m.r.target]), scored: true });
              continue;
            }
            if (!occ.has(nx)) { chain.push(nx); land = nx; idx++; }
          }
        }
      }
      occ.set(land, m.r);
      entry.moves.push({ name: m.r.name, spd: m.r.spd, hp1: m.r.hp1, path: chain.slice(0, idx + 1) });
    }
  }

  function batterAdvance(occ, batter, plate, target, steps, layout, paths, entry, meta, geo, tryStretch) {
    const bs = L.batterStart(layout, paths, plate, target);
    if (!bs) { entry.sub = 'NOPATH'; return 'out'; }
    if (steps >= bs.startDist) {
      entry.runs++; entry.scorers.push(batter.name);
      entry.moves.push({
        name: batter.name, spd: batter.spd, hp1: batter.hp1,
        path: [plate].concat(chainToTarget(paths, target, bs.first)), scored: true,
      });
      return 'scored';
    }
    const P = paths[target];
    const chain = [bs.first];
    let cur = bs.first;
    for (let i = 1; i < steps; i++) {
      const nx = P.next[cur];
      if (nx == null) break;
      chain.push(nx); cur = nx;
    }
    let idx = chain.length - 1;
    while (idx >= 0 && occ.has(chain[idx])) idx--;
    if (idx < 0) { // nowhere to stand
      entry.sub = 'FC';
      entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: [plate, bs.first], out: true });
      return 'out';
    }
    let land = chain[idx];
    const pathNodes = [plate].concat(chain.slice(0, idx + 1));
    if (geo && tryStretch && idx === chain.length - 1) {
      const dLand = P.dist[land];
      const nx = dLand <= 1 ? target : P.next[land];
      if (nx != null) {
        const eft = ftBetween(posOf(layout, land), posOf(layout, nx));
        if (geo.rnd() < stretchChance(eft)) {
          if (dLand <= 1) {
            entry.runs++; entry.scorers.push(batter.name);
            entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: pathNodes.concat([target]), scored: true });
            return 'scored';
          }
          if (!occ.has(nx)) { land = nx; pathNodes.push(nx); }
        }
      }
    }
    occ.set(land, Object.assign({ name: batter.name, spd: batter.spd, hp1: batter.hp1, target }, meta || {}));
    entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: pathNodes });
    return 'safe';
  }

  // Walk: batter takes the first node of his route; occupants are pushed one
  // node along their own routes only if forced, scoring if shoved past home.
  function pushInto(occ, node, paths, entry, visited) {
    if (!occ.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    const r = occ.get(node);
    const P = paths[r.target];
    const d = P.dist[node];
    if (d != null && d <= 1) {
      occ.delete(node);
      entry.runs++; entry.scorers.push(r.name);
      entry.moves.push({ name: r.name, spd: r.spd, hp1: r.hp1, path: [node, r.target], scored: true });
      return true;
    }
    const nx = P.next[node];
    if (nx == null) return false;
    if (!pushInto(occ, nx, paths, entry, visited)) return false;
    occ.delete(node);
    occ.set(nx, r);
    entry.moves.push({ name: r.name, spd: r.spd, hp1: r.hp1, path: [node, nx] });
    return true;
  }

  function walkAdvance(occ, batter, plate, target, layout, paths, entry, meta) {
    const bs = L.batterStart(layout, paths, plate, target);
    if (!bs) { entry.sub = 'NOPATH'; return; }
    if (bs.startDist <= 1) { // direct plate-to-plate edge: a walk is a run
      entry.runs++; entry.scorers.push(batter.name);
      entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: [plate, target], scored: true });
      return;
    }
    if (pushInto(occ, bs.first, paths, entry, new Set())) {
      occ.set(bs.first, Object.assign({ name: batter.name, spd: batter.spd, hp1: batter.hp1, target }, meta || {}));
      entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: [plate, bs.first] });
    } else {
      entry.sub = 'CROWD'; // every path node ahead is jammed
    }
  }

  /* Ball in play that the defense controls. Real fielders decide everything:
   * somebody has to run the ball down before it can be thrown, and somebody
   * else has to be standing on the bag to take the throw. Each exposed
   * runner weighs their time to the next node against that; clearly-safe
   * runners go, the defense plays on the most catchable goer, and a
   * successful cut-down can relay on to the batter for a double play. A
   * goer reaching their scoring plate on an out ball is the sac-fly
   * generalized. Returns outs recorded.
   *
   * `slots` is the standing alignment (fielders.js); it is computed once per
   * game and passed down, but callers may omit it.
   */
  function resolveBallOut(occ, batter, plate, target, layout, paths, entry, rnd, canMove, contact, slots) {
    const D = slots || F.fielderSlots(layout);
    const grounder = contact.distFt < 150; // infield ball: runners are forced off
    const bs = L.batterStart(layout, paths, plate, target);

    // who is exposed, and which bag each of them is running at
    const exposed = [];
    for (const [node, r] of occ.entries()) {
      if (!canMove(r)) continue;
      const P = paths[r.target];
      const d = P.dist[node];
      if (d == null) continue;
      const nx = d <= 1 ? r.target : P.next[node];
      if (nx == null) continue;
      exposed.push({ node, r, nx, d });
    }

    // every bag this ball could be decided at gets a defender sent to it
    const bags = [...new Set(exposed.map((e) => e.nx).concat(bs ? [bs.first] : []))];
    const assign = F.assignPlay(layout, D, contact, bags);

    // the ball is not fielded when it lands — it is fielded when somebody
    // gets to it, so a shot into the gap between two fielders hangs there
    const tCatch = Math.max(contact.distFt / HIT_FTS, assign.tReach) + GLOVE_S;

    // tSecure is the moment the defense actually has the ball, measured
    // from contact. The animation reads it back so the ball cannot leave
    // before the fielder who threw it got there.
    entry.defense = {
      fielder: assign.fielder ? assign.fielder.id : null,
      catchAt: { x: contact.x, y: contact.y },
      tReach: assign.tReach,
      tSecure: tCatch,
      uncovered: assign.uncovered,
      coverers: assign.coverers.map((c) => ({
        node: c.node, slot: c.slot.id, tArrive: c.tArrive,
      })),
    };

    // Nobody could be sent after it (a layout with no usable fielders):
    // every runner is safe and the batter reaches. Degrade, do not throw.
    if (!assign.fielder) {
      for (const e of exposed) {
        occ.delete(e.node);
        if (e.d <= 1) { entry.runs++; entry.scorers.push(e.r.name); entry.sub = 'SF';
          entry.moves.push({ name: e.r.name, spd: e.r.spd, hp1: e.r.hp1, path: [e.node, e.r.target], scored: true }); }
        else if (!occ.has(e.nx)) { occ.set(e.nx, e.r);
          entry.moves.push({ name: e.r.name, spd: e.r.spd, hp1: e.r.hp1, path: [e.node, e.nx] }); }
        else occ.set(e.node, e.r);
      }
      batterAdvance(occ, batter, plate, target, 1, layout, paths, entry, { origin: plate });
      return 0;
    }

    // retiring a runner at `nodeId` needs the throw to arrive AND somebody
    // to be on the bag when it does; an uncovered bag is a free base
    const playTime = (nodeId) => {
      const p = posOf(layout, nodeId);
      const thrown = tCatch + throwSec(ftBetween(contact, p)) + TRANSFER_S;
      const cov = F.covererFor(assign, nodeId);
      return cov ? Math.max(thrown, cov.tArrive) : Infinity;
    };

    /* Did somebody get under it? A ball still in the air when a fielder
     * reaches it is a catch, and a catch changes the runners' rights
     * completely — which is the difference between a fly ball and a ground
     * ball as far as the runners are concerned.
     */
    const caught = !grounder && assign.tReach <= contact.distFt / HIT_FTS;

    /* Who is forced. The batter is running at `bs.first`, so whoever is
     * standing there has to vacate, which forces whoever is standing at
     * *their* next base, on down the line — exactly the chain a walk
     * pushes along. A runner off the end of that chain has an open base
     * behind him and is under no obligation to go anywhere.
     *
     * A catch removes every force: nobody is obliged to run on a fly ball.
     */
    const forced = new Set();
    if (bs && !caught) {
      let node = bs.first;
      while (node != null && occ.has(node) && !forced.has(node)) {
        forced.add(node);
        const r = occ.get(node);
        const P = paths[r.target];
        const d = P.dist[node];
        node = (d != null && d <= 1) ? r.target : (P.next[node] || null);
      }
    }

    const goers = [];
    for (const e of exposed) {
      // On a catch a runner has to tag up: he cannot leave his base until
      // the ball is in the glove, so his clock starts at the catch rather
      // than at contact. The throw starts from there too, which is what
      // makes a deep fly a run and a shallow one a dare.
      const tLeave = caught ? tCatch : 0;
      const legFt = ftBetween(posOf(layout, e.node), posOf(layout, e.nx));
      // tagging up he is already leaning, timing the catch, so he is gone
      // quicker off the bag than a runner reacting to a ball on the ground
      const advT = tLeave + (caught ? 0.1 : 0.2) + runSec(e.r, legFt, false);
      const margin = playTime(e.nx) - advT; // positive: runner beats the play
      const mustGo = forced.has(e.node);
      // A run is worth more than a base. A runner one step from scoring
      // takes a gamble he would never take to move up a bag — which is
      // what makes the sacrifice fly a play a team actually wants, rather
      // than a runner standing on the bag watching an out.
      const worthIt = e.d <= 1 ? -0.35 : 0.25;
      if (mustGo || margin + (rnd() - 0.5) * 0.8 > worthIt) {
        goers.push({ node: e.node, r: e.r, nx: e.nx, d: e.d, margin, tGo: tLeave });
      }
    }

    let outs = 1;
    let batterSafe = false;
    if (goers.length) {
      goers.sort((a, b) => a.margin - b.margin);
      const g0 = goers[0];
      if (g0.margin + (rnd() - 0.5) * 0.8 < (grounder ? 0.15 : 0)) {
        // defense ignores the batter and guns down the riskiest runner
        occ.delete(g0.node);
        entry.sub = 'CUT';
        entry.runnersOut.push(g0.r.name);
        entry.moves.push({ name: g0.r.name, spd: g0.r.spd, hp1: g0.r.hp1, path: [g0.node, g0.nx], out: true, tGo: g0.tGo });
        entry.throwTo = g0.nx;
        batterSafe = true;
        goers.shift();
        if (bs) { // relay throw for the double play?
          const bT = runSec(batter, ftBetween(posOf(layout, plate), posOf(layout, bs.first)), true);
          // the relay starts when the first out is actually recorded, and
          // still needs a body on the batter's bag at the other end
          const relayT = playTime(g0.nx) + 0.5 +
            throwSec(ftBetween(posOf(layout, g0.nx), posOf(layout, bs.first)));
          const covB = F.covererFor(assign, bs.first);
          const defT = covB ? Math.max(relayT, covB.tArrive) : Infinity;
          if (defT + (rnd() - 0.5) * 1.0 < bT) {
            entry.relayTo = bs.first;
            outs++;
            entry.sub = 'DP';
            entry.runnersOut.push(batter.name);
            entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: [plate, bs.first], out: true });
            batterSafe = false;
          }
        }
      }
      for (const g of goers) { // everyone else who broke advances
        occ.delete(g.node);
        if (g.d <= 1) {
          entry.runs++; entry.scorers.push(g.r.name);
          if (!entry.sub) entry.sub = 'SF';
          entry.moves.push({ name: g.r.name, spd: g.r.spd, hp1: g.r.hp1, path: [g.node, g.r.target], scored: true, tGo: g.tGo });
        } else if (!occ.has(g.nx)) {
          occ.set(g.nx, g.r);
          entry.moves.push({ name: g.r.name, spd: g.r.spd, hp1: g.r.hp1, path: [g.node, g.nx], tGo: g.tGo });
        } else {
          occ.set(g.node, g.r); // blocked — scrambles back
        }
      }
    }
    if (batterSafe) {
      if (batterAdvance(occ, batter, plate, target, 1, layout, paths, entry,
        { origin: plate }) === 'out') { outs++; entry.sub = 'DP'; }
    } else if (entry.sub !== 'DP') {
      if (bs) {
        entry.moves.push({ name: batter.name, spd: batter.spd, hp1: batter.hp1, path: [plate, bs.first], out: true });
        if (!entry.throwTo) entry.throwTo = bs.first;
      }
    }
    return outs;
  }

  /* Animation timeline for one play. Three kinds of track:
   *   ball     mound → plate → contact → throw → relay
   *   runner   one per moving runner, along their node chain
   *   fielder  the man who runs the ball down, plus everyone breaking for
   *            a bag; each carries the slot id so the renderer knows which
   *            standing fielder left his post
   * Everything is timed by real distances off a single clock, so the throw
   * beating the runner on screen is the same throw that beat him in the
   * box score. Marathon plays are compressed to 5s of playback.
   */
  function buildAnim(layout, entry, slots) {
    const tracks = [];
    const plateP = posOf(layout, entry.plate);
    const mound = L.moundPositions(layout).find((m) => m.plate === entry.plate);
    const tPitch = (layout.moundDist || 60.5) / PITCH_FTS;
    // bat meets ball just after the pitch arrives; the defense reads it here
    const tHit = tPitch + 0.1;

    /* Work out the defense first, because the ball cannot be thrown until
     * somebody is holding it. On a ball the defense played, resolveBallOut
     * already recorded who and when; on a hit or a homer nobody was retired
     * but somebody still gives chase, so work that out here.
     */
    let def = null, chaser = null;
    const D = slots || F.fielderSlots(layout);
    const byId = {};
    for (const s of D) byId[s.id] = s;
    if (entry.contact) {
      if (entry.defense) {
        def = entry.defense;
      } else {
        const a = F.assignPlay(layout, D, entry.contact, []);
        def = a.fielder
          ? {
            fielder: a.fielder.id,
            tReach: a.tReach,
            tSecure: Math.max(entry.contact.distFt / HIT_FTS, a.tReach) + GLOVE_S,
            coverers: [],
          }
          : null;
      }
      if (def) chaser = byId[def.fielder] || null;
    }

    const ballPts = [
      { x: mound.x, y: mound.y, t: 0, leg: 'pitch' },
      { x: plateP.x, y: plateP.y, t: tPitch, leg: 'pitch' },
    ];

    // a homer is gone: nobody picks it up, so no securing and no throw
    const gone = entry.type === 'HR';
    let tSecure = null;

    if (entry.contact) {
      const tLand = tHit + entry.contact.distFt / HIT_FTS;
      ballPts.push({
        x: entry.contact.x, y: entry.contact.y, t: tLand,
        leg: gone ? 'homer' : 'batted', distFt: entry.contact.distFt,
      });

      if (!gone && def && Number.isFinite(def.tSecure)) {
        // The ball sits where it came down until the fielder gets to it.
        // This is the same number resolveBallOut used to decide the play,
        // so a throw that beat the runner in the box score also beats him
        // on screen — and a fielder is always on the ball when it leaves.
        tSecure = tHit + def.tSecure;
        ballPts.push({ x: entry.contact.x, y: entry.contact.y, t: tSecure, leg: 'field' });

        let tAt = tSecure, from = entry.contact;
        if (entry.throwTo) {
          const tp = posOf(layout, entry.throwTo);
          tAt = tSecure + TRANSFER_S + throwSec(ftBetween(from, tp));
          ballPts.push({ x: tp.x, y: tp.y, t: tAt, leg: 'throw' });
          from = tp;
        } else {
          // No play to make, but a fielder does not stand there holding it:
          // he throws it back in. Cosmetic only — nothing reads this.
          const infield = [...layout.nodes, ...layout.homes]
            .filter((n) => F.finite(n) && n.id !== entry.throwTo);
          let back = null, bestD = Infinity;
          for (const n of infield) {
            const d = ftBetween(entry.contact, n);
            if (d < bestD) { bestD = d; back = n; }
          }
          if (back) {
            tAt = tSecure + TRANSFER_S + throwSec(bestD);
            ballPts.push({ x: back.x, y: back.y, t: tAt, leg: 'throw' });
            from = back;
            entry.returnTo = back.id;
          }
        }
        if (entry.relayTo) {
          const rp = posOf(layout, entry.relayTo);
          ballPts.push({
            x: rp.x, y: rp.y, leg: 'throw',
            t: tAt + 0.5 + throwSec(ftBetween(from, rp)),
          });
        }
      }
    } else {
      /* Nothing was put in play, but a pitch was still thrown: it finishes
       * in the catcher's glove. A strikeout used to animate as a ball
       * crossing an empty plate and stopping in mid-air.
       */
      const c = byId['C-' + entry.plate];
      if (c && F.finite(c)) {
        ballPts.push({ x: c.x, y: c.y, t: tPitch + 0.18, leg: 'pitch' });
      }
    }
    tracks.push({ kind: 'ball', pts: ballPts });

    /* When each runner leaves. Most break at contact, but a runner tagging
     * up on a fly ball is held at his base until the catch — resolveBallOut
     * records that as `tGo`, seconds after contact — so on screen he waits,
     * then goes, the way he does on a real sacrifice fly.
     */
    const tBreak = tPitch + (entry.type === 'BB' ? 0.2 : 0.15);
    for (const mv of entry.moves || []) {
      if (!mv.path || mv.path.length < 2) continue;
      const pts = [];
      let t = Math.max(tBreak, tHit + (mv.tGo || 0));
      for (let i = 0; i < mv.path.length; i++) {
        const p = posOf(layout, mv.path[i]);
        // the same clock the engine used to decide the play: his own sprint
        // speed, and his own start-up cost on the leg that begins at rest
        if (i > 0) {
          t += runSec(mv, ftBetween(posOf(layout, mv.path[i - 1]), p),
            i === 1 && mv.path[0] === entry.plate);
        }
        pts.push({ x: p.x, y: p.y, t });
      }
      tracks.push({
        kind: 'runner', name: mv.name, spd: mv.spd, hp1: mv.hp1,
        fromPlate: mv.path[0] === entry.plate,
        out: !!mv.out, scored: !!mv.scored, pts,
      });
    }

    if (def) {
      if (chaser && Number.isFinite(def.tReach)) {
        const pts = [
          { x: chaser.x, y: chaser.y, t: tHit },
          { x: entry.contact.x, y: entry.contact.y, t: tHit + def.tReach },
        ];
        // stand over the ball until it is released, so the throw visibly
        // comes off the man who ran it down
        if (tSecure != null) {
          pts.push({ x: entry.contact.x, y: entry.contact.y, t: tSecure });
        }
        tracks.push({
          kind: 'fielder', slot: chaser.id, role: chaser.role, chasing: true, pts,
        });
      }
      for (const cv of def.coverers || []) {
        const s = byId[cv.slot];
        const p = L.findNode(layout, cv.node);
        if (!s || !F.finite(p) || !Number.isFinite(cv.tArrive)) continue;
        tracks.push({
          kind: 'fielder', slot: s.id, role: s.role, covers: cv.node,
          pts: [
            { x: s.x, y: s.y, t: tHit },
            { x: p.x, y: p.y, t: tHit + cv.tArrive },
          ],
        });
      }
    }

    /* Everybody standing in a batter's box gets drawn, whatever the pitch
     * did. A batter who never leaves — struck out, or held on a walk that
     * did not force him — was previously not on screen at all. And when
     * every plate is live, the men waiting at the other plates are the
     * whole point of the format, so they are drawn too (`otherBatters`).
     */
    let tEnd = 0;
    for (const tr of tracks) tEnd = Math.max(tEnd, tr.pts[tr.pts.length - 1].t);
    const boxes = [{ plate: entry.plate, name: entry.batter }]
      .concat(entry.otherBatters || []);
    const drawn = new Set();
    for (const b of boxes) {
      if (!b || !b.name || drawn.has(b.name)) continue;
      const bp = posOf(layout, b.plate);
      if (!F.finite(bp)) continue;
      drawn.add(b.name);
      // a man who reaches base holds the box until he breaks, then his
      // runner track takes over; a man who never leaves holds it all play
      const run = tracks.find((t) => t.kind === 'runner' && t.name === b.name);
      const until = run ? run.pts[0].t : Math.max(tEnd, tPitch + 0.3);
      if (until <= 0.02) continue;   // he was gone before the pitch landed
      tracks.push({
        kind: 'batter', name: b.name, spd: b.spd, hp1: b.hp1, plate: b.plate,
        atBat: b.plate === entry.plate, handsOff: !!run,
        pts: [{ x: bp.x, y: bp.y, t: 0 }, { x: bp.x, y: bp.y, t: until }],
      });
    }

    let dur = 0;
    for (const tr of tracks) dur = Math.max(dur, tr.pts[tr.pts.length - 1].t);
    /* A marathon play is squeezed into 5s so the broadcast keeps moving.
     * The factor is recorded because it is per-play: two appearances from
     * the same delivery window can be squeezed by different amounts, and
     * laying them on a shared clock as-is puts runners on screen at three
     * times each other's pace when the engine says they all run 27 ft/s.
     * Anything merging timelines must undo this first (buildCycleAnim).
     */
    let squeeze = 1;
    if (dur > 5) {
      squeeze = 5 / dur;
      for (const tr of tracks) for (const p of tr.pts) p.t *= squeeze;
      dur = 5;
    }
    entry.anim = { dur: dur + 0.2, squeeze, tracks };
  }

  function playHalf(side, layout, paths, slots, cfg, rnd, log, ctx) {
    let outs = 0, runs = 0;
    const occ = new Map();
    const geo = { layout, rnd };

    while (outs < cfg.outs) {
      const batter = side.lineup[side.spot % side.lineup.length];
      side.spot++;
      const plate = layout.homes[side.plateIdx % 3].id;
      side.plateIdx++;
      const target = L.targetOf(layout, plate);
      const type = CORE.plateAppearance(batter, rnd, ctx.moundDelta);
      const entry = {
        inning: ctx.inning, half: ctx.half, team: side.abbr,
        batter: batter.name, pos: batter.pos, plate, type, sub: null,
        runs: 0, scorers: [], runnersOut: [], moves: [], contact: null, throwTo: null,
      };

      if (type === 'BB') {
        walkAdvance(occ, batter, plate, target, layout, paths, entry, { origin: plate });
      } else if (type === 'HR') {
        entry.contact = contactFor(layout, plate, 'HR', rnd);
        for (const [node, r] of [...occ.entries()]) {
          occ.delete(node);
          entry.runs++; entry.scorers.push(r.name);
          entry.moves.push({
            name: r.name, spd: r.spd, hp1: r.hp1,
            path: paths[r.target].dist[node] != null
              ? chainToTarget(paths, r.target, node) : [node, r.target],
            scored: true,
          });
        }
        entry.runs++; entry.scorers.push(batter.name);
        const bs = L.batterStart(layout, paths, plate, target);
        if (bs) {
          entry.moves.push({
            name: batter.name, spd: batter.spd, hp1: batter.hp1,
            path: [plate].concat(chainToTarget(paths, target, bs.first)), scored: true,
          });
        }
        side.hits++; side.homers++;
      } else if (type === '1B' || type === '2B' || type === '3B') {
        const steps = Number(type[0]);
        entry.contact = contactFor(layout, plate, type, rnd);
        advanceRunners(occ, steps, paths, entry, null, geo);
        if (batterAdvance(occ, batter, plate, target, steps, layout, paths, entry,
          { origin: plate }, geo, true) === 'out') outs++;
        side.hits++;
      } else if (type === 'K') {
        outs++;
      } else { // ball in play, defense picks the best play
        entry.contact = contactFor(layout, plate, 'OUT', rnd);
        outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
          rnd, () => true, entry.contact, slots);
      }

      runs += entry.runs;
      side.runs += entry.runs;
      entry.outsAfter = Math.min(outs, cfg.outs);
      entry.occupancyAfter = [...occ.entries()].map(([node, r]) => ({ node, name: r.name }));
      entry.score = ctx.score();
      buildAnim(layout, entry, slots);
      log.push(entry);

      if (ctx.walkoff && ctx.walkoff()) { entry.walkoff = entry.runs > 0; break; }
    }
    return runs;
  }

  function makeSide(team) {
    return {
      abbr: team.abbr, name: team.name, spd: team.spd, hp1: team.hp1, color: team.color,
      lineup: team.lineup, spot: 0, plateIdx: 0,
      runs: 0, hits: 0, homers: 0, line: [],
    };
  }

  function sideResult(s) {
    return {
      abbr: s.abbr, name: s.name, spd: s.spd, hp1: s.hp1, color: s.color,
      runs: s.runs, hits: s.hits, homers: s.homers, line: s.line,
    };
  }

  function simGameGraph(awayTeam, homeTeam, layout, cfgIn, seed) {
    const cfg = Object.assign({ innings: 9, outs: 3 }, cfgIn);
    const paths = L.buildPaths(layout);
    const slots = F.fielderSlots(layout);
    const moundDelta = (layout.moundDist || 60.5) - 60.5;
    const rnd = CORE.mulberry32(seed == null ? (Math.random() * 0x7fffffff) | 0 : seed);
    const away = makeSide(awayTeam);
    const home = makeSide(homeTeam);
    const log = [];
    let inning = 1;

    while (true) {
      const topCtx = {
        inning, half: 'top', moundDelta,
        score: () => ({ away: away.runs, home: home.runs }),
        walkoff: null,
      };
      away.line.push(playHalf(away, layout, paths, slots, cfg, rnd, log, topCtx));

      const finalFrame = inning >= cfg.innings;
      if (finalFrame && home.runs > away.runs) {
        home.line.push('X');
      } else {
        const botCtx = {
          inning, half: 'bottom', moundDelta,
          score: () => ({ away: away.runs, home: home.runs }),
          walkoff: finalFrame ? () => home.runs > away.runs : null,
        };
        home.line.push(playHalf(home, layout, paths, slots, cfg, rnd, log, botCtx));
      }

      if (inning >= cfg.innings && away.runs !== home.runs) break;
      if (inning >= cfg.innings + MAX_EXTRA) break;
      inning++;
    }

    return {
      cfg, log, innings: inning,
      away: sideResult(away), home: sideResult(home),
      winner: home.runs > away.runs ? 'home' : home.runs < away.runs ? 'away' : 'tie',
    };
  }

  function simManyGraph(awayTeam, homeTeam, layout, cfg, n, seed) {
    const base = seed == null ? (Math.random() * 0x7fffffff) | 0 : seed;
    const agg = {
      games: n, awayWins: 0, homeWins: 0, ties: 0,
      awayRuns: 0, homeRuns: 0, homers: 0, extraInningGames: 0,
      maxRuns: 0, maxRunsLine: '',
    };
    for (let i = 0; i < n; i++) {
      const g = simGameGraph(awayTeam, homeTeam, layout, cfg, (base + i * 7919) >>> 0);
      if (g.winner === 'away') agg.awayWins++;
      else if (g.winner === 'home') agg.homeWins++;
      else agg.ties++;
      agg.awayRuns += g.away.runs;
      agg.homeRuns += g.home.runs;
      agg.homers += g.away.homers + g.home.homers;
      if (g.innings > g.cfg.innings) agg.extraInningGames++;
      const total = g.away.runs + g.home.runs;
      if (total >= agg.maxRuns) {
        agg.maxRuns = total;
        agg.maxRunsLine = `${g.away.abbr} ${g.away.runs} @ ${g.home.abbr} ${g.home.runs}`;
      }
    }
    return agg;
  }

  const API = {
    simGameGraph, simManyGraph,
    // shared machinery for the tri-pitch engine
    _internals: {
      advanceRunners, batterAdvance, walkAdvance, pushInto, makeSide, sideResult,
      resolveBallOut, contactFor, buildAnim, chainToTarget, posOf, ftBetween,
      RUN_FTS, THROW_FTS, PITCH_FTS, HIT_FTS, throwSec,
      runSec, startCost, topSpeed, LEAD_FT, BASE_START,
    },
  };
  if (IS_NODE) module.exports = API;
  else global.MBB_GSIM = API;
})(typeof window !== 'undefined' ? window : globalThis);
