/* moreBasesBall — field designer: node tools on the field SVG.
 * Move / Add base / Connect (directed) / Erase / Path check.
 */
(function () {
  'use strict';

  const L = window.MBB_LAYOUT;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const STORE_KEY = 'mbb-layout-v1';

  let field, root;         // svg + our layer root
  let layout;
  let mode = 'classic';
  let tool = 'move';
  let sym = true;            // 3-fold radial symmetry for edits
  let pendingConnect = null; // node id waiting for a connect target
  let pathInfo = null;       // {chain, target, steps, home} from path tool
  let dragging = null;       // {id, dx, dy}
  let lastOccupancy = [];

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, L.serialize(layout)); } catch (e) { /* private mode */ }
  }

  function load() {
    try { return L.deserialize(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }

  function svgPoint(evt) {
    const pt = field.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(field.getScreenCTM().inverse());
  }

  function edited() {
    pathInfo = null;
    save();
    render(lastOccupancy);
    window.dispatchEvent(new CustomEvent('mbb-layout-edited'));
  }

  /* ---------------- rendering ---------------- */

  function render(occupancy) {
    lastOccupancy = occupancy || [];
    root.innerHTML = '';

    // backdrop turf
    el('circle', { cx: L.CX, cy: L.CY, r: 292, fill: '#1d4029' }, root);
    for (let r = 260; r > 60; r -= 46) {
      el('circle', {
        cx: L.CX, cy: L.CY, r,
        fill: 'none', stroke: 'rgba(255,255,255,0.035)', 'stroke-width': 23,
      }, root);
    }

    const pos = {};
    for (const n of [...layout.homes, ...layout.nodes]) pos[n.id] = n;

    const hl = new Set();
    if (pathInfo) {
      for (let i = 0; i < pathInfo.chain.length - 1; i++) {
        hl.add(pathInfo.chain[i] + '>' + pathInfo.chain[i + 1]);
      }
    }

    // edges: dirt band, arrow at midpoint, wide invisible hit line
    for (const e of layout.edges) {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const lit = hl.has(e.from + '>' + e.to);
      el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: lit ? '#ffc14d' : '#9c5c36',
        'stroke-width': lit ? 26 : 22, 'stroke-linecap': 'round',
        opacity: lit ? 0.95 : 0.9,
      }, root);
      // direction arrow
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      el('path', {
        d: 'M -7 -6 L 9 0 L -7 6 Z',
        transform: `translate(${mx} ${my}) rotate(${ang})`,
        fill: lit ? '#0c120e' : '#f4efe2', opacity: 0.9,
      }, root);
      el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: 'transparent', 'stroke-width': 18,
        'data-edge': `${e.from}>${e.to}`, cursor: 'pointer',
      }, root);
    }

    // pitching mounds: one per plate, aimed at the centroid of the bases
    for (const m of L.moundPositions(layout)) {
      el('circle', {
        cx: m.x, cy: m.y, r: 13,
        fill: '#9c5c36', stroke: '#7c4023', 'stroke-width': 1.5,
        'pointer-events': 'none',
      }, root);
      el('rect', {
        x: -5, y: -1.5, width: 10, height: 3, fill: '#f4efe2',
        transform: `translate(${m.x} ${m.y}) rotate(${m.angle + 90})`,
        'pointer-events': 'none',
      }, root);
    }

    // base nodes
    for (const n of layout.nodes) {
      const g = el('g', {
        'data-node': n.id, cursor: 'pointer',
        transform: `translate(${n.x} ${n.y})`,
      }, root);
      el('circle', { r: 17, fill: 'transparent' }, g); // fat hit area
      el('rect', {
        x: -10, y: -10, width: 20, height: 20, rx: 2, transform: 'rotate(45)',
        fill: '#f4efe2', stroke: pendingConnect === n.id ? '#ffc14d' : '#0c120e',
        'stroke-width': pendingConnect === n.id ? 4 : 2,
      }, g);
    }

    // home plates
    for (const h of layout.homes) {
      const g = el('g', {
        'data-node': h.id, cursor: 'pointer',
        transform: `translate(${h.x} ${h.y})`,
      }, root);
      el('circle', { r: 30, fill: '#9c5c36' }, g);
      el('path', {
        d: 'M -13 -8 L 13 -8 L 13 4 L 0 14 L -13 4 Z',
        fill: pathInfo && pathInfo.home === h.id ? '#ffc14d' : '#f4efe2',
        stroke: pendingConnect === h.id ? '#ffc14d' : '#0c120e',
        'stroke-width': pendingConnect === h.id ? 4 : 2,
      }, g);
      el('text', {
        x: 0, y: -38, 'text-anchor': 'middle', fill: '#f4efe2',
        'font-family': "'Graduate', serif", 'font-size': 17,
      }, g).textContent = h.id;
    }

    // runners
    for (const o of lastOccupancy) {
      const n = pos[o.node];
      if (!n) continue;
      const g = el('g', { transform: `translate(${n.x} ${n.y})`, 'pointer-events': 'none' }, root);
      el('circle', { r: 15, fill: 'rgba(255,193,77,0.28)' }, g);
      el('circle', { r: 8, fill: '#ffc14d', stroke: '#3d2c07', 'stroke-width': 2 }, g);
      el('text', {
        x: 0, y: 27, 'text-anchor': 'middle', fill: '#ffc14d',
        'font-family': "'IBM Plex Mono', monospace", 'font-size': 11,
      }, g).textContent = o.name.split(' ').pop();
    }

    renderStatus();
  }

  function renderStatus() {
    const v = L.validate(layout);
    const bits = v.map((r) =>
      r.steps != null
        ? `${r.home}→${r.target} <b>${r.steps} steps</b>`
        : `${r.home}→${r.target} <b class="bad">no path</b>`);
    let extra = '';
    if (pathInfo) {
      extra = ` · <span class="hlnote">showing ${pathInfo.home} route: ` +
        `${pathInfo.chain.join(' → ')} (${pathInfo.steps} steps)</span>`;
    } else if (pendingConnect) {
      extra = ` · <span class="hlnote">connecting from ${pendingConnect} — click the destination</span>`;
    }
    const pitchDesc = layout.pitchMode === 'tri'
      ? `all plates pitch in a shared 1s window, runners break on <b>${layout.runMode === 'any' ? "any plate's hit" : "their origin plate's hit"}</b>, any runner can be played on`
      : 'one plate pitches at a time';
    const delta = (layout.moundDist || 60.5) - 60.5;
    const moundDesc = delta === 0
      ? ''
      : ` · mound <b>${layout.moundDist} ft</b> (hitters see ~${(-1.6 * delta).toFixed(1)} mph, ` +
        `${delta > 0 ? 'hitter' : 'pitcher'}-friendly)`;
    $('layout-status').innerHTML =
      `Scoring rule: runners from each plate score at <b>${layout.scoreRule === 'own' ? 'their own plate (full lap)' : 'the clockwise-next plate'}</b> · ` +
      `${pitchDesc}${moundDesc} · symmetry <b>${sym ? '×3 on' : 'off'}</b> · ` +
      bits.join(' · ') + extra;
  }

  /* ---------------- pointer interactions ---------------- */

  function nodeAt(evt) {
    const g = evt.target.closest('[data-node]');
    return g ? g.getAttribute('data-node') : null;
  }

  function edgeAt(evt) {
    const l = evt.target.closest('[data-edge]');
    return l ? l.getAttribute('data-edge').split('>') : null;
  }

  function onPointerDown(evt) {
    if (mode !== 'custom') return;
    const id = nodeAt(evt);
    const p = svgPoint(evt);

    if (tool === 'move') {
      if (id && id[0] === 'N') {
        const n = L.findNode(layout, id);
        dragging = { id, dx: n.x - p.x, dy: n.y - p.y };
        field.setPointerCapture(evt.pointerId);
        window.dispatchEvent(new CustomEvent('mbb-layout-edited'));
      }
      return;
    }

    if (tool === 'add') {
      if (!id) {
        if (sym) L.addNodeSym(layout, Math.round(p.x), Math.round(p.y));
        else L.addNode(layout, Math.round(p.x), Math.round(p.y));
        edited();
      }
      return;
    }

    if (tool === 'connect') {
      if (!id) { pendingConnect = null; render(lastOccupancy); return; }
      if (!pendingConnect) {
        pendingConnect = id;
        render(lastOccupancy);
      } else if (pendingConnect === id) {
        pendingConnect = null;
        render(lastOccupancy);
      } else {
        if (sym) L.addEdgeSym(layout, pendingConnect, id);
        else L.addEdge(layout, pendingConnect, id);
        pendingConnect = null;
        edited();
      }
      return;
    }

    if (tool === 'erase') {
      if (id && id[0] === 'N') {
        if (sym) L.removeNodeSym(layout, id);
        else L.removeNode(layout, id);
        edited();
        return;
      }
      const ed = edgeAt(evt);
      if (ed) {
        if (sym) L.removeEdgeSym(layout, ed[0], ed[1]);
        else L.removeEdge(layout, ed[0], ed[1]);
        edited();
      }
      return;
    }

    if (tool === 'path') {
      if (id && id[0] === 'H') {
        const paths = L.buildPaths(layout);
        const route = L.routeOf(layout, paths, id);
        pathInfo = route ? { home: id, ...route } : { home: id, chain: [id], steps: 0, target: L.targetOf(layout, id) };
        if (!route) pathInfo = null;
        render(lastOccupancy);
        if (!route) {
          $('layout-status').innerHTML +=
            ` · <b class="bad">${id} has no directed route to ${L.targetOf(layout, id)} — add/redirect connections.</b>`;
        }
      }
    }
  }

  function onPointerMove(evt) {
    if (!dragging) return;
    const p = svgPoint(evt);
    const x = Math.round(p.x + dragging.dx);
    const y = Math.round(p.y + dragging.dy);
    if (sym) {
      L.moveNodeSym(layout, dragging.id, x, y);
    } else {
      const n = L.findNode(layout, dragging.id);
      n.x = x; n.y = y;
    }
    render(lastOccupancy);
  }

  function onPointerUp() {
    if (dragging) { dragging = null; save(); }
  }

  /* ---------------- play animation ---------------- */

  let animReq = null, animLayer = null;

  function trackPos(pts, t) {
    if (t <= pts[0].t) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1], b = pts[i];
        const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return pts[pts.length - 1];
  }

  function cancelAnim() {
    if (animReq) { cancelAnimationFrame(animReq); animReq = null; }
    animLayer = null;
  }

  // Plays one entry's timeline: the ball flies mound → plate → contact →
  // throw target while every moving runner glides along their edge path.
  function animatePlay(entry, prevOcc, speedMult, done) {
    cancelAnim();
    const anim = entry.anim;
    if (!anim || !anim.tracks.length || speedMult <= 0) {
      render(entry.occupancyAfter);
      done();
      return;
    }
    const moving = new Set(anim.tracks.filter((t) => t.kind === 'runner').map((t) => t.name));
    render((prevOcc || []).filter((o) => !moving.has(o.name)));
    animLayer = el('g', {}, root);
    const dots = anim.tracks.map((tr) => {
      const g = el('g', { 'pointer-events': 'none' }, animLayer);
      if (tr.kind === 'ball') {
        el('circle', { r: 8, fill: 'rgba(244,239,226,0.25)' }, g);
        el('circle', { r: 4.5, fill: '#f4efe2', stroke: '#0c120e', 'stroke-width': 1.5 }, g);
      } else {
        el('circle', { r: 13, fill: 'rgba(255,193,77,0.28)' }, g);
        el('circle', {
          r: 8, fill: tr.out ? '#d64541' : '#ffc14d',
          stroke: '#3d2c07', 'stroke-width': 2,
        }, g);
        el('text', {
          x: 0, y: 24, 'text-anchor': 'middle',
          fill: tr.out ? '#d64541' : '#ffc14d',
          'font-family': "'IBM Plex Mono', monospace", 'font-size': 10,
        }, g).textContent = tr.name.split(' ').pop();
      }
      return g;
    });
    const t0 = performance.now();
    const frame = (now) => {
      const t = ((now - t0) / 1000) * speedMult;
      anim.tracks.forEach((tr, k) => {
        const p = trackPos(tr.pts, t);
        dots[k].setAttribute('transform', `translate(${p.x} ${p.y})`);
        const end = tr.pts[tr.pts.length - 1].t;
        // the ball is fielded/dead shortly after its last waypoint;
        // retired and scored runners leave the field too
        const fades = tr.kind === 'ball' || tr.scored || tr.out;
        let op = 1;
        if (fades) {
          const fadeAt = end + (tr.kind === 'ball' ? 0.35 : 0.15);
          op = Math.min(1, Math.max(0, (fadeAt + 0.25 - t) / 0.25));
        }
        dots[k].setAttribute('opacity', op);
      });
      if (t >= anim.dur + 0.25) {
        cancelAnim();
        render(entry.occupancyAfter);
        done();
        return;
      }
      animReq = requestAnimationFrame(frame);
    };
    animReq = requestAnimationFrame(frame);
  }

  /* ---------------- controls ---------------- */

  function setTool(t) {
    tool = t;
    pendingConnect = null;
    if (t !== 'path') pathInfo = null;
    document.querySelectorAll('.toolbtn[data-tool]').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-tool') === t));
    render(lastOccupancy);
  }

  function setMode(m) {
    mode = m;
    $('designer').hidden = m !== 'custom';
    $('classic-root').style.display = m === 'custom' ? 'none' : '';
    root.style.display = m === 'custom' ? '' : 'none';
    if (m === 'custom') {
      render([]);
      $('field-title').textContent = 'The field — custom layout (designer)';
    }
    window.dispatchEvent(new CustomEvent('mbb-mode', { detail: { mode: m } }));
  }

  function wire() {
    document.querySelectorAll('.toolbtn[data-tool]').forEach((b) =>
      b.addEventListener('click', () => setTool(b.getAttribute('data-tool'))));

    $('mode-select').addEventListener('change', (e) => setMode(e.target.value));

    $('sym-btn').addEventListener('click', () => {
      sym = !sym;
      $('sym-btn').classList.toggle('active', sym);
      $('sym-btn').setAttribute('aria-pressed', String(sym));
      renderStatus();
    });

    $('spacing-input').addEventListener('change', (e) => {
      const v = Math.max(60, Math.min(400, +e.target.value || 250));
      e.target.value = v;
      L.setSpacing(layout, v);
      edited();
    });

    $('rule-select').addEventListener('change', (e) => {
      layout.scoreRule = e.target.value;
      edited();
    });

    $('mound-input').addEventListener('change', (e) => {
      const v = Math.max(45, Math.min(75, +e.target.value || 60.5));
      e.target.value = v;
      layout.moundDist = v;
      edited();
    });

    $('pitch-select').addEventListener('change', (e) => {
      layout.pitchMode = e.target.value;
      edited();
    });

    $('runmode-select').addEventListener('change', (e) => {
      layout.runMode = e.target.value;
      edited();
    });

    $('starter-btn').addEventListener('click', () => {
      const keep = {
        scoreRule: layout.scoreRule,
        pitchMode: layout.pitchMode,
        runMode: layout.runMode,
      };
      layout = L.makeStarter(+$('spacing-input').value || 250);
      Object.assign(layout, keep);
      edited();
    });

    $('clear-btn').addEventListener('click', () => {
      layout.nodes = [];
      layout.edges = [];
      edited();
    });

    field.addEventListener('pointerdown', onPointerDown);
    field.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  /* ---------------- public API ---------------- */

  window.MBB_EDITOR = {
    init() {
      field = $('field');
      root = el('g', { id: 'custom-root' }, field);
      root.style.display = 'none';
      layout = load() || L.makeStarter(250);
      if (!layout.pitchMode) layout.pitchMode = 'tri';   // older saved layouts
      if (!layout.runMode) layout.runMode = 'origin';
      if (!layout.moundDist) layout.moundDist = 60.5;
      $('spacing-input').value = layout.spacing;
      $('rule-select').value = layout.scoreRule;
      $('pitch-select').value = layout.pitchMode;
      $('runmode-select').value = layout.runMode;
      $('mound-input').value = layout.moundDist;
      wire();
    },
    isCustom: () => mode === 'custom',
    getLayout: () => layout,
    renderRunners: (occ) => render(occ),
    clearRunners: () => render([]),
    animatePlay,
    cancelAnim,
  };
})();
