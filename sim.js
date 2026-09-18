/* moreBasesBall — simulation engine
 * Per-plate-appearance Monte Carlo driven by each batter's real season line.
 * Generalized to N bases: cfg.bases is how many bases a runner must touch
 * before scoring (classic baseball = 3, i.e. 1B/2B/3B then home).
 */
(function (global) {
  'use strict';

  // Deterministic RNG so tests are reproducible.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEFAULT_CFG = { bases: 3, innings: 9, outs: 3, rules: null };

  /* Mound-distance adjustment, per foot the rubber sits behind regulation
   * 60.5 ft (negative = closer, pitcher-friendly). Calibrated from:
   * - MLB/theScore physics model: +1 ft of distance plays like ~-1.6 mph of
   *   perceived fastball velocity (93.3 from 60'6" ≈ 91.6 from 61'6").
   * - 1893 (50 ft box → 60.5 ft): league BA jumped ~.245 → .280, i.e. about
   *   +3.3 points of average per foot — the large-delta anchor.
   * - Atlantic League 2021 (61'6" experiment): effects at ±1 ft are small —
   *   K/9 ~flat, walks DOWN 7.5%, runs ~-1% — so per-foot coefficients are
   *   kept modest rather than the steep fastball-only xBA curves.
   * Per foot farther: K% -0.7 pp, all hits +2.5% relative (≈ +3 BA points),
   * HR an extra +1.5% (contact quality scales faster, per xSLG spreads),
   * BB -4% relative (the counterintuitive but observed AL result).
   */
  const MOUND_REG_FT = 60.5;

  /* The four advancement constants below were bare literals. A rule may
   * address them by name; absent a rule they keep their original values,
   * and -- critically -- the number of rnd() draws never changes either
   * way. Only the comparison thresholds move. */
  const TUNABLE_DEFAULTS = Object.freeze({
    stretch1B: 0.32, stretch2B: 0.22, sacFly: 0.26, doublePlay: 0.13,
  });

  function tunables(rules) {
    const t = rules && rules.tunables;
    if (!t) return TUNABLE_DEFAULTS;
    const out = {};
    for (const k of Object.keys(TUNABLE_DEFAULTS)) {
      out[k] = typeof t[k] === 'number' ? t[k] : TUNABLE_DEFAULTS[k];
    }
    return out;
  }

  function adjustedRates(p, deltaFt) {
    const singles = p.h - p.d2 - p.d3 - p.hr;
    const f = Math.max(-15, Math.min(15, deltaFt));
    const hitMult = Math.max(0.25, 1 + 0.025 * f);
    let bb = (p.bb / p.pa) * Math.max(0.4, 1 - 0.04 * f);
    let hr = (p.hr / p.pa) * hitMult * Math.max(0.4, 1 + 0.015 * f);
    let d3 = (p.d3 / p.pa) * hitMult;
    let d2 = (p.d2 / p.pa) * hitMult;
    let s1 = (singles / p.pa) * hitMult;
    let k = Math.max(0.02, p.so / p.pa - 0.007 * f);
    // keep some balls in play no matter how extreme the field
    const nonOut = bb + hr + d3 + d2 + s1;
    if (nonOut > 0.92) {
      const scale = 0.92 / nonOut;
      bb *= scale; hr *= scale; d3 *= scale; d2 *= scale; s1 *= scale;
    }
    k = Math.min(k, 1 - (bb + hr + d3 + d2 + s1) - 0.02);
    return { bb, hr, d3, d2, s1, k: Math.max(0.02, k) };
  }

  // Chance a plate appearance ends in BB / HR / 3B / 2B / 1B, straight
  // from the player's real season rates; `moundDeltaFt` (optional) shifts
  // them for a non-regulation mound. Anything left over is an out.
  function plateAppearance(p, rnd, moundDeltaFt, rules) {
    if (moundDeltaFt) {
      const a = adjustedRates(p, moundDeltaFt);
      const events = [
        ['BB', a.bb], ['HR', a.hr], ['3B', a.d3], ['2B', a.d2], ['1B', a.s1],
      ];
      let r = rnd();
      for (let i = 0; i < events.length; i++) {
        if (r < events[i][1]) return events[i][0];
        r -= events[i][1];
      }
      const outShare = 1 - (a.bb + a.hr + a.d3 + a.d2 + a.s1);
      return rnd() < a.k / outShare ? 'K' : 'OUT';
    }
    const singles = p.h - p.d2 - p.d3 - p.hr;
    const events = [
      ['BB', p.bb / p.pa],
      ['HR', p.hr / p.pa],
      ['3B', p.d3 / p.pa],
      ['2B', p.d2 / p.pa],
      ['1B', singles / p.pa],
    ];
    let r = rnd();
    for (let i = 0; i < events.length; i++) {
      if (r < events[i][1]) return events[i][0];
      r -= events[i][1];
    }
    const outShare = 1 - (p.bb + p.h) / p.pa;
    return rnd() < (p.so / p.pa) / outShare ? 'K' : 'OUT';
  }

  // Move everyone up on a hit. All runners take the same number of bases as
  // the batter, sometimes stretching one extra on singles/doubles.
  function hitAdvance(bases, batter, hitValue, rnd, rules) {
    const B = bases.length;
    const t = tunables(rules);
    const stretch =
      (hitValue === 1 && rnd() < t.stretch1B) || (hitValue === 2 && rnd() < t.stretch2B) ? 1 : 0;
    const next = new Array(B).fill(null);
    let runs = 0;
    const scorers = [];
    for (let i = B - 1; i >= 0; i--) {
      if (!bases[i]) continue;
      const dest = i + hitValue + stretch;
      if (dest >= B) { runs++; scorers.push(bases[i].name); }
      else next[dest] = bases[i];
    }
    const bDest = hitValue - 1;
    if (bDest >= B) { runs++; scorers.push(batter.name); }
    else next[bDest] = batter;
    return { bases: next, runs, scorers };
  }

  // Walk: batter to first, runners advance only if forced.
  function walkAdvance(bases, batter, rules) {
    const next = bases.slice();
    let carry = batter, i = 0, runs = 0;
    const scorers = [];
    while (carry) {
      if (i >= next.length) { runs++; scorers.push(carry.name); break; }
      const occupant = next[i];
      next[i] = carry;
      carry = occupant;
      i++;
    }
    return { bases: next, runs, scorers };
  }

  function playHalfInning(side, cfg, rnd, log, ctx) {
    const t = tunables(cfg.rules);
    let outs = 0;
    let runs = 0;
    let bases = new Array(cfg.bases).fill(null);
    const lastBase = cfg.bases - 1;

    while (outs < cfg.outs) {
      const batter = side.lineup[side.spot % side.lineup.length];
      side.spot++;
      const type = plateAppearance(batter, rnd);
      const entry = {
        inning: ctx.inning, half: ctx.half, team: side.abbr,
        batter: batter.name, pos: batter.pos, type, sub: null,
        runs: 0, scorers: [],
      };

      if (type === 'BB') {
        const res = walkAdvance(bases, batter, cfg.rules);
        bases = res.bases; entry.runs = res.runs; entry.scorers = res.scorers;
      } else if (type === '1B' || type === '2B' || type === '3B' || type === 'HR') {
        const value = type === 'HR' ? cfg.bases + 1 : Number(type[0]);
        const res = hitAdvance(bases, batter, value, rnd, cfg.rules);
        bases = res.bases; entry.runs = res.runs; entry.scorers = res.scorers;
        // With few bases a long hit clears home on its own legs.
        if (type !== 'HR' && value > cfg.bases) entry.sub = 'ITP';
        side.hits++;
        if (type === 'HR') side.homers++;
      } else if (type === 'K') {
        outs++;
      } else { // OUT: ball in play
        outs++;
        if (bases[lastBase] && outs < cfg.outs && rnd() < t.sacFly) {
          entry.sub = 'SF';
          entry.runs = 1;
          entry.scorers = [bases[lastBase].name];
          bases = bases.slice(); bases[lastBase] = null;
        } else if (bases[0] && outs < cfg.outs && rnd() < t.doublePlay) {
          entry.sub = 'DP';
          outs++;
          bases = bases.slice(); bases[0] = null;
        }
      }

      runs += entry.runs;
      side.runs += entry.runs;
      entry.outsAfter = outs;
      entry.basesAfter = bases.map((b) => (b ? b.name : null));
      entry.score = ctx.score();
      log.push(entry);

      if (ctx.walkoff && ctx.walkoff()) { entry.walkoff = entry.runs > 0; break; }
    }
    return runs;
  }

  function makeSide(team) {
    return {
      abbr: team.abbr, name: team.name, color: team.color,
      lineup: team.lineup, spot: 0, runs: 0, hits: 0, homers: 0, line: [],
    };
  }

  const MAX_EXTRA = 30;

  function simGame(awayTeam, homeTeam, cfgIn, seed) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn);
    const rnd = mulberry32(seed == null ? (Math.random() * 0x7fffffff) | 0 : seed);
    const away = makeSide(awayTeam);
    const home = makeSide(homeTeam);
    const log = [];
    let inning = 1;

    while (true) {
      const topCtx = {
        inning, half: 'top',
        score: () => ({ away: away.runs, home: home.runs }),
        walkoff: null,
      };
      away.line.push(playHalfInning(away, cfg, rnd, log, topCtx));

      const finalFrame = inning >= cfg.innings;
      if (finalFrame && home.runs > away.runs) {
        home.line.push('X'); // home never needs to bat
      } else {
        const botCtx = {
          inning, half: 'bottom',
          score: () => ({ away: away.runs, home: home.runs }),
          walkoff: finalFrame ? () => home.runs > away.runs : null,
        };
        home.line.push(playHalfInning(home, cfg, rnd, log, botCtx));
      }

      if (inning >= cfg.innings && away.runs !== home.runs) break;
      if (inning >= cfg.innings + MAX_EXTRA) break; // safety valve
      inning++;
    }

    return {
      cfg, log, innings: inning,
      away: sideResult(away), home: sideResult(home),
      winner: home.runs > away.runs ? 'home' : home.runs < away.runs ? 'away' : 'tie',
    };
  }

  function sideResult(s) {
    return {
      abbr: s.abbr, name: s.name, color: s.color,
      runs: s.runs, hits: s.hits, homers: s.homers, line: s.line,
    };
  }

  function simMany(awayTeam, homeTeam, cfg, n, seed) {
    const base = seed == null ? (Math.random() * 0x7fffffff) | 0 : seed;
    const agg = {
      games: n, awayWins: 0, homeWins: 0, ties: 0,
      awayRuns: 0, homeRuns: 0, homers: 0, extraInningGames: 0,
      maxRuns: 0, maxRunsLine: '',
    };
    for (let i = 0; i < n; i++) {
      const g = simGame(awayTeam, homeTeam, cfg, (base + i * 7919) >>> 0);
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

  // How does scoring change with the number of bases? Runs the same matchup
  // at every base count from lo..hi.
  function scanBases(awayTeam, homeTeam, cfg, lo, hi, gamesPer, seed) {
    const rows = [];
    for (let b = lo; b <= hi; b++) {
      const agg = simMany(awayTeam, homeTeam, Object.assign({}, cfg, { bases: b }), gamesPer, seed);
      rows.push({
        bases: b,
        avgTotalRuns: (agg.awayRuns + agg.homeRuns) / gamesPer,
        avgHomers: agg.homers / gamesPer,
        extraPct: (100 * agg.extraInningGames) / gamesPer,
      });
    }
    return rows;
  }

  const API = {
    simGame, simMany, scanBases, plateAppearance, adjustedRates,
    mulberry32, DEFAULT_CFG, MOUND_REG_FT, tunables,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MBB_SIM = API;
})(typeof window !== 'undefined' ? window : globalThis);
