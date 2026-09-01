/* moreBasesBall — UI: morphing N-gon field, scoreboard, broadcast playback */
(function () {
  'use strict';

  const TEAMS = window.MBB_DATA.TEAMS;
  const SIM = window.MBB_SIM;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  const SHAPES = {
    1: 'the gauntlet', 2: 'triangle ball', 3: 'classic diamond',
    4: 'pentagon park', 5: 'hexagon grounds', 6: 'heptagon field', 7: 'octagon yard',
  };

  const CX = 360, CY = 300, R = 232;
  const MAX_BASES = 7;

  /* ---------------- geometry ---------------- */

  // Corner 0 is home plate (bottom); runners travel counterclockwise,
  // first base to the right — same as the real thing.
  function corners(B) {
    const n = B + 1, pts = [];
    for (let k = 0; k < n; k++) {
      const th = ((90 - (k * 360) / n) * Math.PI) / 180;
      pts.push([CX + R * Math.cos(th), CY + R * Math.sin(th)]);
    }
    return pts;
  }

  /* ---------------- field construction ---------------- */

  const field = $('field');
  let classicRoot, gGround, gChalk, baseGroups = [], runnerGroups = [], homeGroup;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildField() {
    classicRoot = el('g', { id: 'classic-root' }, field);
    gGround = el('g', {}, classicRoot);
    gChalk = el('g', {}, classicRoot);

    homeGroup = el('g', { class: 'base-g' }, classicRoot);
    el('path', {
      d: 'M -12 -7 L 12 -7 L 12 4 L 0 13 L -12 4 Z',
      fill: '#f4efe2', stroke: '#0c120e', 'stroke-width': 2,
    }, homeGroup);

    for (let i = 0; i < MAX_BASES; i++) {
      const g = el('g', { class: 'base-g' }, classicRoot);
      el('rect', {
        x: -11, y: -11, width: 22, height: 22, rx: 2,
        transform: 'rotate(45)', fill: '#f4efe2', stroke: '#0c120e', 'stroke-width': 2,
      }, g);
      el('text', {
        x: 0, y: -22, 'text-anchor': 'middle', fill: '#b8b2a2',
        'font-family': "'IBM Plex Mono', monospace", 'font-size': 12,
      }, g).textContent = String(i + 1);
      baseGroups.push(g);
    }

    for (let i = 0; i < MAX_BASES; i++) {
      const g = el('g', { class: 'runner-g' }, classicRoot);
      el('circle', { r: 16, fill: 'rgba(255,193,77,0.28)' }, g);
      el('circle', { r: 9, fill: '#ffc14d', stroke: '#3d2c07', 'stroke-width': 2 }, g);
      const label = el('text', {
        x: 0, y: 30, 'text-anchor': 'middle', fill: '#ffc14d',
        'font-family': "'IBM Plex Mono', monospace", 'font-size': 11,
      }, g);
      label.classList.add('runner-name');
      runnerGroups.push(g);
    }
  }

  function place(g, x, y, visible) {
    g.style.transform = `translate(${x}px, ${y}px)`;
    g.style.opacity = visible ? 1 : 0;
  }

  function renderField(B) {
    const pts = corners(B);
    gGround.innerHTML = '';
    gChalk.innerHTML = '';

    // outfield turf with mow rings
    el('circle', { cx: CX, cy: CY, r: R + 58, fill: '#1d4029' }, gGround);
    for (let r = R + 30; r > 60; r -= 42) {
      el('circle', {
        cx: CX, cy: CY, r,
        fill: 'none', stroke: 'rgba(255,255,255,0.035)', 'stroke-width': 21,
      }, gGround);
    }

    // basepath dirt band + infield grass
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    if (B >= 2) el('path', { d, fill: '#2a5c3a' }, gGround);
    el('path', {
      d, fill: 'none', stroke: '#9c5c36', 'stroke-width': 38,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, gGround);

    // home-plate dirt and pitching circle
    el('circle', { cx: pts[0][0], cy: pts[0][1], r: 36, fill: '#9c5c36' }, gGround);
    if (B >= 2) {
      el('circle', { cx: CX, cy: CY, r: 24, fill: '#9c5c36' }, gGround);
      el('rect', { x: CX - 9, y: CY - 2, width: 18, height: 4, fill: '#f4efe2' }, gGround);
    }

    // foul lines out from home past the first and last base
    if (B >= 2) {
      for (const idx of [1, B]) {
        const [hx, hy] = pts[0], [bx, by] = pts[idx];
        const dx = bx - hx, dy = by - hy;
        const len = Math.hypot(dx, dy);
        const fx = hx + (dx / len) * (R + 95);
        const fy = hy + (dy / len) * (R + 95);
        el('line', {
          x1: hx, y1: hy, x2: fx, y2: fy,
          stroke: '#f4efe2', 'stroke-width': 3, opacity: 0.75,
        }, gChalk);
      }
    }

    place(homeGroup, pts[0][0], pts[0][1], true);
    for (let i = 0; i < MAX_BASES; i++) {
      if (i < B) place(baseGroups[i], pts[i + 1][0], pts[i + 1][1], true);
      else baseGroups[i].style.opacity = 0;
    }
    setRunners(new Array(B).fill(null));
    $('field-title').textContent = `The field — ${SHAPES[B]}`;
  }

  function setRunners(names) {
    const pts = corners(names.length);
    for (let i = 0; i < MAX_BASES; i++) {
      const name = names[i];
      if (i < names.length && name) {
        runnerGroups[i].querySelector('.runner-name').textContent = name.split(' ').pop();
        place(runnerGroups[i], pts[i + 1][0], pts[i + 1][1], true);
      } else {
        runnerGroups[i].style.opacity = 0;
      }
    }
  }

  /* ---------------- scoreboard ---------------- */

  function renderBoard(away, home, minCols) {
    const cols = Math.max(minCols, away.line.length, home.line.length);
    const cell = (v) =>
      v == null ? '<td class="dim">·</td>'
      : v === 'X' ? '<td class="dim">X</td>'
      : `<td>${v}</td>`;
    const row = (s) =>
      `<tr><td class="teamname" style="border-left:4px solid ${s.color}">${s.abbr}</td>` +
      Array.from({ length: cols }, (_, i) => cell(s.line[i])).join('') +
      `<td class="tot">${s.r ?? '·'}</td><td class="tot">${s.h ?? '·'}</td><td class="tot">${s.hr ?? '·'}</td></tr>`;
    $('linescore').innerHTML =
      '<tr><th class="teamcol"></th>' +
      Array.from({ length: cols }, (_, i) => `<th>${i + 1}</th>`).join('') +
      '<th>R</th><th>H</th><th>HR</th></tr>' + row(away) + row(home);
  }

  function renderLamps(outs, totalOuts) {
    $('out-lamps').innerHTML =
      Array.from({ length: totalOuts }, (_, i) =>
        `<span class="lamp${i < outs ? ' on' : ''}"></span>`).join('') +
      ' <span style="margin-left:4px">OUT</span>';
  }

  /* ---------------- play descriptions ---------------- */

  const CALLS = {
    BB: ['works a walk', 'draws ball four', 'takes his base on five pitches'],
    '1B': ['lines a single', 'slaps a single the other way', 'bloops one in front of the outfield'],
    '2B': ['rips a double into the gap', 'doubles off the wall', 'smokes one down the line — in for two'],
    '3B': ['legs out a triple', 'triples into the corner'],
    HR: ['DEEP… and GONE', 'launches one into the night', 'crushes it WAY out of here'],
    K: ['strikes out swinging', 'goes down looking', 'is blown away for the strikeout'],
    OUT: ['grounds out', 'flies out', 'pops it up', 'lines out'],
  };

  function callFor(e, i) {
    const pick = (arr) => arr[i % arr.length];
    let text;
    if (e.sub === 'SF') text = 'lifts a sacrifice fly';
    else if (e.sub === 'CUT') {
      text = `puts it in play — the defense ignores him and guns down ${e.runnersOut[0]}!`;
    } else if (e.sub === 'DP') {
      text = 'grounds into a double play' +
        (e.runnersOut && e.runnersOut.length ? ` — ${e.runnersOut.join(' and ')} wiped out` : '');
    }
    else if (e.sub === 'FC') text = 'hits into a fielder\'s choice — no room on the paths';
    else if (e.sub === 'CROWD') text = 'walks, but every base ahead is jammed';
    else text = pick(CALLS[e.type] || ['does something unusual']);
    if (e.sub === 'ITP') text += ' — and just keeps running, all the way home!';
    if (e.runs > 0 && e.type !== 'HR') {
      text += ` · ${e.scorers.join(', ')} score${e.scorers.length === 1 ? 's' : ''}`;
    } else if (e.type === 'HR') {
      text += e.runs > 1 ? ` · ${e.runs}-run homer` : ' · solo shot';
    }
    if (e.walkoff) text += ' — WALK-OFF!';
    return text;
  }

  function addPbp(html, cls) {
    const empty = $('pbp-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    $('pbp').prepend(li);
  }

  function clearPbp() {
    $('pbp').innerHTML = '';
  }

  /* ---------------- controls ---------------- */

  function fillTeamSelect(sel, defaultIdx) {
    sel.innerHTML = TEAMS.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
    sel.value = defaultIdx;
  }

  function readCfg() {
    return {
      bases: +$('bases-range').value,
      innings: +$('innings-range').value,
      outs: +$('outs-range').value,
    };
  }

  function teamOf(which) {
    return TEAMS[+$(`${which}-select`).value];
  }

  function emptySide(t, cfg) {
    return { abbr: t.abbr, color: t.color, line: new Array(cfg.innings).fill(null), r: null, h: null, hr: null };
  }

  function resetBoard() {
    const cfg = readCfg();
    renderBoard(emptySide(teamOf('away'), cfg), emptySide(teamOf('home'), cfg), cfg.innings);
    renderLamps(0, cfg.outs);
    $('frame-label').textContent = '—';
    $('score-label').textContent = '';
    $('at-bat').textContent = '';
  }

  /* ---------------- which field are we looking at? ---------------- */

  /* The 3D view and the 2D SVG view play the same timeline, so the whole
   * difference is which object gets animatePlay. `view3d()` returns the
   * 3D renderer when it is on screen and loaded, and null when the flat
   * field is in charge. The designer only works in 2D — placing a base is
   * a click on the SVG — so picking a tool drops back to it.
   */
  let use3d = false;
  const VIEW_KEY = 'mbb.fieldview';

  function rememberView() {
    try { localStorage.setItem(VIEW_KEY, use3d ? '3d' : '2d'); } catch (e) { /* private mode */ }
  }

  function savedView() {
    try { return localStorage.getItem(VIEW_KEY); } catch (e) { return null; }
  }

  function view3d() {
    const V = window.MBB_FIELD3D;
    return (use3d && V && V.isReady()) ? V : null;
  }

  // The layout whose geometry is currently on screen: the one being
  // designed, or the N-gon standing in for the classic diamond.
  function liveLayout() {
    if (window.MBB_EDITOR.isCustom()) return window.MBB_EDITOR.getLayout();
    return window.MBB_NGON.layoutFor(readCfg().bases);
  }

  function setView(mode) {
    use3d = mode === '3d';
    rememberView();
    $('view-2d').classList.toggle('active', !use3d);
    $('view-3d').classList.toggle('active', use3d);
    $('view-2d').setAttribute('aria-pressed', String(!use3d));
    $('view-3d').setAttribute('aria-pressed', String(use3d));
    $('fieldbox-2d').hidden = use3d;
    $('field3d').hidden = !use3d;
    $('camrow').hidden = !use3d;
    if (!use3d) {
      if (window.MBB_FIELD3D) window.MBB_FIELD3D.cancelAnim();
      return;
    }
    const V = window.MBB_FIELD3D;
    if (!V) return;
    V.init($('field3d'));
    V.setLayout(liveLayout());
    V.resize();
  }

  // Rebuild the 3D field after anything that moves a base.
  function refresh3d() {
    const V = view3d();
    if (V) V.setLayout(liveLayout());
  }

  /* ---------------- playback ---------------- */

  let timer = null;

  function setBusy(busy) {
    for (const id of ['play-btn', 'sim-btn', 'scan-btn']) $(id).disabled = busy;
  }

  function stopPlayback() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (window.MBB_EDITOR && window.MBB_EDITOR.cancelAnim) window.MBB_EDITOR.cancelAnim();
    if (window.MBB_FIELD3D && window.MBB_FIELD3D.cancelAnim) window.MBB_FIELD3D.cancelAnim();
    setBusy(false);
  }

  function customLayoutReady() {
    const layout = window.MBB_EDITOR.getLayout();
    const broken = window.MBB_LAYOUT.validate(layout).filter((v) => v.steps == null);
    if (broken.length) {
      addPbp(
        `Layout not playable: ${broken.map((b) => `${b.home} has no directed path to ${b.target}`).join('; ')}. ` +
        'Use Connect to finish the routes — Path check shows what each plate can reach.',
        'gameend');
      return null;
    }
    return layout;
  }

  function playGame() {
    stopPlayback();
    const cfg = readCfg();
    const away = teamOf('away'), home = teamOf('home');
    const custom = window.MBB_EDITOR.isCustom();
    let g;
    if (custom) {
      const layout = customLayoutReady();
      if (!layout) return;
      g = layout.pitchMode === 'tri'
        ? window.MBB_TRI.simGameTri(away, home, layout, cfg)
        : window.MBB_GSIM.simGameGraph(away, home, layout, cfg);
      window.MBB_EDITOR.clearRunners();
      if (view3d()) view3d().setLayout(layout);
    } else {
      // classic outcomes still come from sim.js; ngon.js only works out
      // where on a real diamond each of those plays happened
      const seed = (Math.random() * 0x7fffffff) | 0;
      g = SIM.simGame(away, home, cfg, seed);
      window.MBB_NGON.attachGeometry(g, seed);
      renderField(cfg.bases);
      if (view3d()) view3d().setLayout(g.layout);
    }
    clearPbp();
    setBusy(true);

    const live = {
      away: { abbr: away.abbr, color: away.color, line: [], r: 0, h: 0, hr: 0 },
      home: { abbr: home.abbr, color: home.color, line: [], r: 0, h: 0, hr: 0 },
    };
    const speed = +$('speed-select').value;
    let i = 0;

    function applyEntry(e, idx, showRunners) {
      const side = e.half === 'top' ? live.away : live.home;
      side.line[e.inning - 1] = (side.line[e.inning - 1] || 0) + e.runs;
      // the fielding side's line needs a 0 placeholder once its half starts
      side.r += e.runs;
      if (e.type === '1B' || e.type === '2B' || e.type === '3B' || e.type === 'HR') side.h++;
      if (e.type === 'HR') side.hr++;

      renderBoard(live.away, live.home, cfg.innings);
      renderLamps(e.outsAfter, cfg.outs);
      $('frame-label').textContent = `${e.half === 'top' ? '▲ TOP' : '▼ BOT'} ${e.inning}`;
      $('score-label').textContent = `${away.abbr} ${e.score.away} — ${home.abbr} ${e.score.home}`;
      $('at-bat').innerHTML = `At bat: <b>${e.batter}</b> ${e.pos}, ${e.team}` +
        (e.plate && !e.onePlate ? ` — batting from <b>${e.plate}</b>` : '');
      if (showRunners) {
        const V = view3d();
        if (V) V.renderRunners(e.occupancyAfter);
        else if (window.MBB_EDITOR.isCustom()) window.MBB_EDITOR.renderRunners(e.occupancyAfter);
        else setRunners(e.basesAfter);
      }

      const cls = e.runs > 0 ? 'scoring' : (e.type === 'K' || e.type === 'OUT') ? 'out-play' : '';
      addPbp(
        `<span class="meta">${e.half === 'top' ? 'top' : 'bot'} ${e.inning} · ${e.team}` +
        `${e.plate && !e.onePlate ? ' · from ' + e.plate : ''}` +
        `${e.tOffset != null ? ' · t+' + (e.tOffset / 1000).toFixed(2) + 's' : ''}` +
        ` · ${e.outsAfter} out</span>` +
        `<span class="call"><b>${e.batter}</b> ${callFor(e, idx)}</span>`, cls);
    }

    function finish() {
      const A = g.away, H = g.home;
      renderBoard(
        { abbr: A.abbr, color: away.color, line: A.line, r: A.runs, h: A.hits, hr: A.homers },
        { abbr: H.abbr, color: home.color, line: H.line, r: H.runs, h: H.hits, hr: H.homers },
        cfg.innings);
      const extras = g.innings > cfg.innings ? ` (${g.innings} inn)` : '';
      addPbp(`FINAL${extras}: ${A.abbr} ${A.runs} — ${H.abbr} ${H.runs}`, 'gameend');
      $('frame-label').textContent = 'FINAL';
      if (view3d()) view3d().clearRunners();
      if (custom) window.MBB_EDITOR.clearRunners();
      else setRunners(new Array(cfg.bases).fill(null));
      timer = null;
      setBusy(false);
    }

    const reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Anything with real geometry animates: custom layouts on either
    // field, and classic games whenever the 3D view is up.
    const stage = view3d() || (custom ? window.MBB_EDITOR : null);
    if (stage) {
      // animated playback: ball flight + runners and fielders on their tracks
      const mult = speed === 650 ? 1 : speed === 300 ? 2 : speed === 90 ? 5 : 0;
      if (mult === 0 || reduced) {
        for (; i < g.log.length; i++) applyEntry(g.log[i], i, true);
        finish();
        return;
      }
      let prevOcc = [], prevKey = '';
      const step = () => {
        if (i >= g.log.length) { finish(); return; }
        const e = g.log[i];
        const key = e.inning + '|' + e.half;
        if (key !== prevKey) { prevOcc = []; prevKey = key; }
        applyEntry(e, i, false);
        const before = prevOcc;
        prevOcc = e.occupancyAfter;
        i++;
        stage.animatePlay(e, before, mult, () => {
          timer = setTimeout(step, 130);
        });
      };
      step();
      return;
    }

    if (speed === 0) {
      for (; i < g.log.length; i++) applyEntry(g.log[i], i, true);
      finish();
      return;
    }
    (function step() {
      if (i >= g.log.length) { finish(); return; }
      applyEntry(g.log[i], i, true);
      i++;
      timer = setTimeout(step, speed);
    })();
  }

  /* ---------------- bulk sims ---------------- */

  function pct(x, n) { return ((100 * x) / n).toFixed(1) + '%'; }

  function runSim500() {
    stopPlayback();
    const cfg = readCfg();
    const away = teamOf('away'), home = teamOf('home');
    const N = 500;
    const custom = window.MBB_EDITOR.isCustom();
    let a, ruleLabel;
    if (custom) {
      const layout = customLayoutReady();
      if (!layout) return;
      const tri = layout.pitchMode === 'tri';
      a = tri
        ? window.MBB_TRI.simManyTri(away, home, layout, cfg, N)
        : window.MBB_GSIM.simManyGraph(away, home, layout, cfg, N);
      ruleLabel = `custom layout (${layout.nodes.length} bases, score at ` +
        `${layout.scoreRule === 'own' ? 'own plate' : 'clockwise next plate'}` +
        (tri ? `, tri-pitch, runners break on ${layout.runMode === 'any' ? 'any hit' : 'origin hit'}` : '') +
        ')';
    } else {
      a = SIM.simMany(away, home, cfg, N);
      ruleLabel = `${cfg.bases} base${cfg.bases > 1 ? 's' : ''} (${SHAPES[cfg.bases]})`;
    }
    $('results').innerHTML = `
      <section class="panel">
        <h2>${N}-game series · ${away.abbr} @ ${home.abbr} · ${ruleLabel}, ${cfg.innings} innings, ${cfg.outs} outs</h2>
        <div class="results-body">
          <table class="stat">
            <tr><th>Team</th><th>W</th><th>L</th><th>Win %</th><th>Runs / game</th></tr>
            <tr><td>${away.name} (road)</td><td>${a.awayWins}</td><td>${a.homeWins}</td>
                <td class="hl">${pct(a.awayWins, N)}</td><td>${(a.awayRuns / N).toFixed(2)}</td></tr>
            <tr><td>${home.name} (home)</td><td>${a.homeWins}</td><td>${a.awayWins}</td>
                <td class="hl">${pct(a.homeWins, N)}</td><td>${(a.homeRuns / N).toFixed(2)}</td></tr>
          </table>
          <p class="results-note">
            ${(a.homers / N).toFixed(2)} home runs per game ·
            ${pct(a.extraInningGames, N)} of games went to extras ·
            wildest game: ${a.maxRunsLine} (${a.maxRuns} total runs).
          </p>
        </div>
      </section>`;
  }

  function runScan() {
    stopPlayback();
    if (window.MBB_EDITOR.isCustom()) {
      $('results').innerHTML = `
        <section class="panel">
          <h2>Base-count scan</h2>
          <div class="results-body"><p class="results-note">
            The 1–7 base scan applies to the classic N-gon field. Switch
            Field mode to Classic to run it, or use Sim 500 games to measure
            your custom layout.
          </p></div>
        </section>`;
      return;
    }
    const cfg = readCfg();
    const away = teamOf('away'), home = teamOf('home');
    const PER = 300;
    const rows = SIM.scanBases(away, home, cfg, 1, 7, PER);
    $('results').innerHTML = `
      <section class="panel">
        <h2>Base-count scan · ${away.abbr} @ ${home.abbr} · ${PER} games per configuration</h2>
        <div class="results-body">
          <table class="stat">
            <tr><th>Bases</th><th>Field</th><th>Runs / game (both teams)</th><th>HR / game</th><th>Extra innings</th></tr>
            ${rows.map((r) => `
              <tr>
                <td>${r.bases}${r.bases === 3 ? ' ★' : ''}</td>
                <td>${SHAPES[r.bases]}</td>
                <td class="hl">${r.avgTotalRuns.toFixed(1)}</td>
                <td>${r.avgHomers.toFixed(2)}</td>
                <td>${r.extraPct.toFixed(1)}%</td>
              </tr>`).join('')}
          </table>
          <p class="results-note">
            ★ = regulation baseball. Fewer bases turn every double into a lap around
            the field; more bases strand runners and put the offense in the hands of
            whoever can clear the fence.
          </p>
        </div>
      </section>`;
  }

  /* ---------------- wiring ---------------- */

  function onConfigChange() {
    stopPlayback();
    const cfg = readCfg();
    $('bases-val').textContent = cfg.bases;
    $('innings-val').textContent = cfg.innings;
    $('outs-val').textContent = cfg.outs;
    $('shape-name').textContent = SHAPES[cfg.bases];
    if (!window.MBB_EDITOR.isCustom()) renderField(cfg.bases);
    refresh3d();   // a different base count is a different polygon
    resetBoard();
  }

  fillTeamSelect($('away-select'), 1); // Yankees visit
  fillTeamSelect($('home-select'), 0); // Dodgers host
  buildField();
  renderField(3);
  window.MBB_EDITOR.init();
  resetBoard();

  window.addEventListener('mbb-mode', (e) => {
    stopPlayback();
    resetBoard();
    const custom = e.detail.mode === 'custom';
    $('bases-range').disabled = custom;
    if (!custom) {
      renderField(readCfg().bases);
      $('shape-name').textContent = SHAPES[readCfg().bases];
    }
    refresh3d();
  });

  window.addEventListener('mbb-layout-edited', () => { stopPlayback(); refresh3d(); });

  /* ---------------- 2D / 3D controls ---------------- */

  $('view-2d').addEventListener('click', () => { stopPlayback(); setView('2d'); });
  $('view-3d').addEventListener('click', () => { stopPlayback(); setView('3d'); });

  for (const b of document.querySelectorAll('.cambtn')) {
    b.addEventListener('click', () => {
      for (const o of document.querySelectorAll('.cambtn')) o.classList.remove('active');
      b.classList.add('active');
      if (window.MBB_FIELD3D) window.MBB_FIELD3D.applyView(b.dataset.view);
    });
  }

  // Designing a layout means clicking on bases, which only the flat field
  // can offer — so reaching for a tool takes you back to it.
  for (const b of document.querySelectorAll('.toolbtn[data-tool]')) {
    b.addEventListener('click', () => { if (use3d) setView('2d'); });
  }

  // field3d.js is a module, so it lands after this script — pick the view
  // back up whenever it arrives.
  window.addEventListener('mbb-field3d-ready', () => {
    if (use3d || savedView() === '3d') setView('3d');
  });
  if (window.MBB_FIELD3D && savedView() === '3d') setView('3d');

  for (const id of ['bases-range', 'innings-range', 'outs-range']) {
    $(id).addEventListener('input', onConfigChange);
  }
  for (const id of ['away-select', 'home-select']) {
    $(id).addEventListener('change', () => { stopPlayback(); resetBoard(); });
  }
  $('play-btn').addEventListener('click', playGame);
  $('sim-btn').addEventListener('click', runSim500);
  $('scan-btn').addEventListener('click', runScan);
})();
