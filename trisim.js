/* moreBasesBall — tri-pitch engine.
 * All three plates are live at once: each pitcher delivers inside the same
 * 1-second window at a random moment, and plate appearances resolve in
 * delivery order. Runner release rules (layout.runMode):
 *   'origin' — runners break only when their own plate's batter connects
 *   'any'    — runners break on contact from any plate
 * Any exposed (running) runner can be retired on any ball in play; the
 * defense resolves plays with real geometry (runner speed vs throw time),
 * shared with graphsim, and every play carries an animation timeline.
 */
(function (global) {
  'use strict';

  const IS_NODE = typeof module !== 'undefined' && module.exports;
  const L = IS_NODE ? require('./layout.js') : global.MBB_LAYOUT;
  const CORE = IS_NODE ? require('./sim.js') : global.MBB_SIM;
  const GS = IS_NODE ? require('./graphsim.js') : global.MBB_GSIM;
  const F = IS_NODE ? require('./fielders.js') : global.MBB_FIELDERS;
  const {
    advanceRunners, batterAdvance, walkAdvance, makeSide, sideResult,
    resolveBallOut, contactFor, buildAnim, chainToTarget,
  } = GS._internals;

  const MAX_EXTRA = 30;
  const WINDOW_MS = 1000;
  const CYCLE_CAP_S = 8;   // a window holds several plays, so it gets longer

  /* The plates are live at the same time, so the window they share has to
   * animate as one play -- otherwise two balls struck 0.3s apart are shown
   * one after the other and the format is invisible. Each plate appearance
   * is still resolved on its own (outcomes, box score and every test are
   * untouched); this only lays the finished timelines onto a single clock,
   * each offset by the moment its pitcher actually let go.
   *
   * Worth knowing: because the plays were resolved independently, a fielder
   * can appear in two of them at once. The engine's decisions are honest
   * one play at a time; the composite is honest about *when*, not about
   * how thinly the defense is stretched.
   */
  function buildCycleAnim(entries) {
    const tracks = [];
    const runnerAt = new Map();
    let dur = 0;
    for (const e of entries) {
      if (!e.anim) continue;
      const off = (e.tOffset || 0) / 1000;
      // back to real seconds before sharing a clock; the window is squeezed
      // once at the end so everyone on screen keeps the same pace
      const un = 1 / (e.anim.squeeze || 1);
      for (const tr of e.anim.tracks) {
        // each play draws every box; on one clock that is N copies of each
        // man, so keep only the batter the play belongs to
        if (tr.kind === 'batter' && !tr.atBat) continue;
        const shifted = Object.assign({}, tr, {
          ownPlate: e.plate,   // which appearance this track came from
          pts: tr.pts.map((p) => Object.assign({}, p, { t: p.t * un + off })),
        });
        if (tr.kind === 'runner') {
          // a runner who breaks on two hits in the same window would other-
          // wise be drawn twice and teleport between the copies
          const prev = runnerAt.get(tr.name);
          if (prev && prev.pts[0].t <= shifted.pts[0].t) continue;
          if (prev) tracks.splice(tracks.indexOf(prev), 1);
          runnerAt.set(tr.name, shifted);
        }
        tracks.push(shifted);
      }
      dur = Math.max(dur, (e.anim.dur - 0.2) * un + off);
    }
    // one squeeze for the whole window: several plays share it, so the cap
    // is looser than a single play's, and every runner keeps one pace
    let squeeze = 1;
    if (dur > CYCLE_CAP_S) {
      squeeze = CYCLE_CAP_S / dur;
      for (const tr of tracks) for (const p of tr.pts) p.t *= squeeze;
      dur = CYCLE_CAP_S;
    }
    return { dur: dur + 0.2, squeeze, tracks };
  }

  function playHalfTri(side, layout, paths, slots, cfg, rnd, log, ctx) {
    let outs = 0, runs = 0, cycle = 0;
    const occ = new Map();
    const geo = { layout, rnd, rules: cfg.rules || null };

    while (outs < cfg.outs && cycle < 3000) {
      const thisCycle = [];
      // the shared one-second window: each mound fires at a random moment
      const deliveries = layout.homes
        .map((h) => ({ plate: h.id, t: Math.floor(rnd() * WINDOW_MS) }))
        .sort((a, b) => a.t - b.t);
      // Who is in each box is known before the first pitch of the window, so
      // every play can draw the batters waiting at the other plates. Peeked,
      // not consumed: `side.spot` still only advances for men who actually
      // bat, so a half-inning that ends mid-cycle rotates the lineup exactly
      // as it did before.
      deliveries.forEach((dv, i) => {
        dv.batter = side.lineup[(side.spot + i) % side.lineup.length];
      });

      for (const dv of deliveries) {
        if (outs >= cfg.outs) break;
        const batter = dv.batter;
        side.spot++;
        const plate = dv.plate;
        const target = L.targetOf(layout, plate);
        const canMove = layout.runMode === 'any'
          ? () => true
          : (r) => r.origin === plate;
        const type = CORE.plateAppearance(batter, rnd, ctx.moundDelta, cfg.rules || null);
        const entry = {
          inning: ctx.inning, half: ctx.half, team: side.abbr,
          batter: batter.name, pos: batter.pos, plate,
          cycle, tOffset: dv.t, type, sub: null,
          otherBatters: deliveries
            .filter((d) => d.plate !== plate)
            .map((d) => ({ plate: d.plate, name: d.batter.name })),
          runs: 0, scorers: [], runnersOut: [], moves: [], contact: null, throwTo: null,
        };

        if (type === 'BB') {
          walkAdvance(occ, batter, plate, target, layout, paths, entry, { origin: plate });
        } else if (type === 'HR') {
          entry.contact = contactFor(layout, plate, 'HR', rnd);
          for (const [node, r] of [...occ.entries()]) {
            if (!canMove(r)) continue; // held runners stay put on a foreign homer
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
          advanceRunners(occ, steps, paths, entry, canMove, geo);
          if (batterAdvance(occ, batter, plate, target, steps, layout, paths, entry,
            { origin: plate }, geo, true) === 'out') outs++;
          side.hits++;
        } else if (type === 'K') {
          outs++;
        } else { // ball in play, defense picks the best geometric play
          entry.contact = contactFor(layout, plate, 'OUT', rnd);
          outs += resolveBallOut(occ, batter, plate, target, layout, paths, entry,
            rnd, canMove, entry.contact, slots);
        }

        runs += entry.runs;
        side.runs += entry.runs;
        entry.outsAfter = Math.min(outs, cfg.outs);
        entry.occupancyAfter = [...occ.entries()].map(([node, r]) => ({ node, name: r.name }));
        entry.score = ctx.score();
        buildAnim(layout, entry, slots);
        thisCycle.push(entry);
        log.push(entry);

        if (ctx.walkoff && ctx.walkoff()) {
          entry.walkoff = entry.runs > 0;
          thisCycle[0].cycleAnim = buildCycleAnim(thisCycle);
          return runs;
        }
      }
      if (thisCycle.length) thisCycle[0].cycleAnim = buildCycleAnim(thisCycle);
      cycle++;
    }
    return runs;
  }

  function simGameTri(awayTeam, homeTeam, layout, cfgIn, seed) {
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
      away.line.push(playHalfTri(away, layout, paths, slots, cfg, rnd, log, topCtx));

      const finalFrame = inning >= cfg.innings;
      if (finalFrame && home.runs > away.runs) {
        home.line.push('X');
      } else {
        const botCtx = {
          inning, half: 'bottom', moundDelta,
          score: () => ({ away: away.runs, home: home.runs }),
          walkoff: finalFrame ? () => home.runs > away.runs : null,
        };
        home.line.push(playHalfTri(home, layout, paths, slots, cfg, rnd, log, botCtx));
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

  function simManyTri(awayTeam, homeTeam, layout, cfg, n, seed) {
    const base = seed == null ? (Math.random() * 0x7fffffff) | 0 : seed;
    const agg = {
      games: n, awayWins: 0, homeWins: 0, ties: 0,
      awayRuns: 0, homeRuns: 0, homers: 0, extraInningGames: 0,
      maxRuns: 0, maxRunsLine: '',
    };
    for (let i = 0; i < n; i++) {
      const g = simGameTri(awayTeam, homeTeam, layout, cfg, (base + i * 7919) >>> 0);
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

  const API = { simGameTri, simManyTri, buildCycleAnim, WINDOW_MS };
  if (IS_NODE) module.exports = API;
  else global.MBB_TRI = API;
})(typeof window !== 'undefined' ? window : globalThis);
