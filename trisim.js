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

  function playHalfTri(side, layout, paths, slots, cfg, rnd, log, ctx) {
    let outs = 0, runs = 0, cycle = 0;
    const occ = new Map();
    const geo = { layout, rnd };

    while (outs < cfg.outs && cycle < 3000) {
      // the shared one-second window: each mound fires at a random moment
      const deliveries = layout.homes
        .map((h) => ({ plate: h.id, t: Math.floor(rnd() * WINDOW_MS) }))
        .sort((a, b) => a.t - b.t);

      for (const dv of deliveries) {
        if (outs >= cfg.outs) break;
        const batter = side.lineup[side.spot % side.lineup.length];
        side.spot++;
        const plate = dv.plate;
        const target = L.targetOf(layout, plate);
        const canMove = layout.runMode === 'any'
          ? () => true
          : (r) => r.origin === plate;
        const type = CORE.plateAppearance(batter, rnd, ctx.moundDelta);
        const entry = {
          inning: ctx.inning, half: ctx.half, team: side.abbr,
          batter: batter.name, pos: batter.pos, plate,
          cycle, tOffset: dv.t, type, sub: null,
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
              name: r.name,
              path: paths[r.target].dist[node] != null
                ? chainToTarget(paths, r.target, node) : [node, r.target],
              scored: true,
            });
          }
          entry.runs++; entry.scorers.push(batter.name);
          const bs = L.batterStart(layout, paths, plate, target);
          if (bs) {
            entry.moves.push({
              name: batter.name,
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
        log.push(entry);

        if (ctx.walkoff && ctx.walkoff()) { entry.walkoff = entry.runs > 0; return runs; }
      }
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

  const API = { simGameTri, simManyTri, WINDOW_MS };
  if (IS_NODE) module.exports = API;
  else global.MBB_TRI = API;
})(typeof window !== 'undefined' ? window : globalThis);
