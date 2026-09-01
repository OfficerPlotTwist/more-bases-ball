/* moreBasesBall — custom field layout model (pure, Node-testable)
 * A layout is a directed graph: 3 fixed home plates + user-placed bases,
 * connected by one-way basepaths. Runners score at their own plate
 * (scoreRule 'own') or the clockwise-next plate (scoreRule 'cw').
 */
(function (global) {
  'use strict';

  const FT2PX = 1.2;      // canvas scale
  const CX = 360, CY = 300;

  // H1 top, H2 lower-right, H3 lower-left — clockwise on screen.
  function homePositions(spacingFt) {
    const side = spacingFt * FT2PX;
    const r = side / Math.sqrt(3);
    const angles = [-90, 30, 150];
    return angles.map((deg, i) => {
      const a = (deg * Math.PI) / 180;
      return { id: 'H' + (i + 1), x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
    });
  }

  function clockwiseNext(id) {
    return { H1: 'H2', H2: 'H3', H3: 'H1' }[id];
  }

  function targetOf(layout, plateId) {
    return layout.scoreRule === 'own' ? plateId : clockwiseNext(plateId);
  }

  function findNode(layout, id) {
    return layout.homes.find((n) => n.id === id) || layout.nodes.find((n) => n.id === id);
  }

  function addNode(layout, x, y) {
    const node = { id: 'N' + layout.nextId++, x, y };
    layout.nodes.push(node);
    return node;
  }

  /* ----- 3-fold radial symmetry -----
   * Symmetric bases carry a group id (grp) and a rotation slot (rotIdx 0-2);
   * the k-slot sibling sits at the 0-slot position rotated k·120° about the
   * field center, matching how H1→H2→H3 map into each other.
   */

  function rotatePoint(x, y, k) {
    const a = (((k % 3) + 3) % 3) * (2 * Math.PI / 3);
    const dx = x - CX, dy = y - CY;
    return {
      x: CX + dx * Math.cos(a) - dy * Math.sin(a),
      y: CY + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  // The node k·120° clockwise from `id`: homes cycle H1→H2→H3, symmetric
  // bases map to their group sibling, plain bases have no counterpart.
  function rotCounterpart(layout, id, k) {
    k = ((k % 3) + 3) % 3;
    if (k === 0) return id;
    if (id[0] === 'H') return 'H' + ((((+id[1] - 1) + k) % 3) + 1);
    const node = layout.nodes.find((n) => n.id === id);
    if (!node || node.grp == null) return null;
    const sib = layout.nodes.find(
      (n) => n.grp === node.grp && n.rotIdx === (node.rotIdx + k) % 3);
    return sib ? sib.id : null;
  }

  function addNodeSym(layout, x, y) {
    const grp = 'G' + layout.nextId;
    let first = null;
    for (let k = 0; k < 3; k++) {
      const p = rotatePoint(x, y, k);
      const n = addNode(layout, Math.round(p.x), Math.round(p.y));
      n.grp = grp; n.rotIdx = k;
      if (k === 0) first = n;
    }
    return first;
  }

  function moveNodeSym(layout, id, x, y) {
    const node = layout.nodes.find((n) => n.id === id);
    if (!node) return;
    node.x = x; node.y = y;
    if (node.grp == null) return;
    for (const sib of layout.nodes) {
      if (sib.grp === node.grp && sib.id !== id) {
        const p = rotatePoint(x, y, sib.rotIdx - node.rotIdx);
        sib.x = Math.round(p.x); sib.y = Math.round(p.y);
      }
    }
  }

  function removeNodeSym(layout, id) {
    const node = layout.nodes.find((n) => n.id === id);
    if (!node) return;
    const ids = node.grp == null
      ? [id]
      : layout.nodes.filter((n) => n.grp === node.grp).map((n) => n.id);
    for (const nid of ids) removeNode(layout, nid);
  }

  function addEdgeSym(layout, from, to) {
    let added = false;
    for (let k = 0; k < 3; k++) {
      const f = rotCounterpart(layout, from, k);
      const t = rotCounterpart(layout, to, k);
      if (f && t) added = addEdge(layout, f, t) || added;
    }
    return added;
  }

  function removeEdgeSym(layout, from, to) {
    for (let k = 0; k < 3; k++) {
      const f = rotCounterpart(layout, from, k);
      const t = rotCounterpart(layout, to, k);
      if (f && t) removeEdge(layout, f, t);
    }
  }

  function removeNode(layout, id) {
    layout.nodes = layout.nodes.filter((n) => n.id !== id);
    layout.edges = layout.edges.filter((e) => e.from !== id && e.to !== id);
  }

  function addEdge(layout, from, to) {
    if (from === to) return false;
    if (layout.edges.some((e) => e.from === from && e.to === to)) return false;
    layout.edges.push({ from, to });
    return true;
  }

  function removeEdge(layout, from, to) {
    layout.edges = layout.edges.filter((e) => !(e.from === from && e.to === to));
  }

  function setSpacing(layout, spacingFt) {
    layout.spacing = spacingFt;
    const fresh = homePositions(spacingFt);
    for (let i = 0; i < 3; i++) {
      layout.homes[i].x = fresh[i].x;
      layout.homes[i].y = fresh[i].y;
    }
  }

  // Center of mass of the placed bases (field center if there are none) —
  // every pitching mound sits on the line from its plate to this point,
  // and the defensive alignment is built off it, so one base with a broken
  // coordinate would otherwise take the whole field with it.
  function basesCentroid(layout) {
    let sx = 0, sy = 0, n = 0;
    for (const nd of layout.nodes) {
      if (!nd || !Number.isFinite(nd.x) || !Number.isFinite(nd.y)) continue;
      sx += nd.x; sy += nd.y; n++;
    }
    if (!n) return { x: CX, y: CY };
    return { x: sx / n, y: sy / n };
  }

  function moundPositions(layout) {
    const c = basesCentroid(layout);
    const distFt = layout.moundDist || 60.5;
    return layout.homes.map((h) => {
      const dx = c.x - h.x, dy = c.y - h.y;
      const len = Math.hypot(dx, dy) || 1;
      // true rubber distance in canvas units, kept on-canvas for tiny fields
      const t = Math.max(0.12, Math.min(0.88, (distFt * FT2PX) / len));
      return {
        plate: h.id,
        x: h.x + dx * t, y: h.y + dy * t,
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
    });
  }

  // Starter: a clockwise ring H1 → · → · → H2 → · → · → H3 → · → · → H1.
  // Valid under both scoring rules (3 steps to the next plate, 9 for the lap).
  function makeStarter(spacingFt) {
    const layout = {
      spacing: spacingFt, scoreRule: 'cw',
      pitchMode: 'tri',    // 'tri' = all plates pitch in a shared 1s window
      runMode: 'origin',   // runners release on 'origin' plate's hit or 'any'
      moundDist: 60.5,     // rubber-to-plate ft; deltas shift batting rates
      homes: homePositions(spacingFt), nodes: [], edges: [], nextId: 1,
    };
    for (let i = 0; i < 3; i++) {
      const A = layout.homes[i], B = layout.homes[(i + 1) % 3];
      const n1 = addNode(layout, A.x + (B.x - A.x) / 3, A.y + (B.y - A.y) / 3);
      const n2 = addNode(layout, A.x + (2 * (B.x - A.x)) / 3, A.y + (2 * (B.y - A.y)) / 3);
      n1.grp = 'G-ring-a'; n1.rotIdx = i;
      n2.grp = 'G-ring-b'; n2.rotIdx = i;
      addEdge(layout, A.id, n1.id);
      addEdge(layout, n1.id, n2.id);
      addEdge(layout, n2.id, B.id);
    }
    return layout;
  }

  /* The classic N-gon as a real layout graph: one home plate and `bases`
   * bases on the vertices of a regular (bases+1)-gon of the given side
   * length, wired into a one-way ring back to the plate. Three bases gives
   * you the diamond, with home at the bottom and the runner going right to
   * first — the same picture the 2D field has always drawn, but now with
   * coordinates the physics and the 3D view can use.
   *
   * Classic games are still decided by sim.js; this only gives their plays
   * somewhere to happen (see ngon.js).
   */
  function makeNgon(bases, spacingFt) {
    const B = Math.max(1, bases | 0);
    const n = B + 1;
    // circumradius of a regular n-gon with the given side, in canvas units
    const R = ((spacingFt || 90) / (2 * Math.sin(Math.PI / n))) * FT2PX;
    const at = (k) => {
      // home sits at the bottom; each base is one vertex counter-clockwise,
      // so base 1 is off to the right exactly as first base should be
      const a = Math.PI / 2 - (k * 2 * Math.PI) / n;
      return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
    };
    const home = Object.assign({ id: 'H1' }, at(0));
    const layout = {
      spacing: spacingFt || 90, scoreRule: 'own',
      pitchMode: 'single', runMode: 'origin', moundDist: 60.5,
      classic: B,
      homes: [home], nodes: [], edges: [], nextId: 1,
    };
    for (let k = 1; k <= B; k++) {
      const p = at(k);
      layout.nodes.push({ id: 'N' + k, x: p.x, y: p.y });
    }
    layout.nextId = B + 1;
    const ids = ['H1'].concat(layout.nodes.map((nd) => nd.id));
    for (let i = 0; i < ids.length; i++) {
      layout.edges.push({ from: ids[i], to: ids[(i + 1) % ids.length] });
    }
    return layout;
  }

  function outAdj(layout) {
    const m = {};
    for (const e of layout.edges) (m[e.from] = m[e.from] || []).push(e.to);
    return m;
  }

  function inAdj(layout) {
    const m = {};
    for (const e of layout.edges) (m[e.to] = m[e.to] || []).push(e.from);
    return m;
  }

  // For each home plate as a scoring target: shortest directed distance from
  // every node to it, plus the next hop along that shortest path.
  function buildPaths(layout) {
    const all = [...layout.homes, ...layout.nodes].map((n) => n.id);
    const rin = inAdj(layout), rout = outAdj(layout);
    const paths = {};
    for (const h of layout.homes) {
      const dist = { [h.id]: 0 };
      const q = [h.id];
      while (q.length) {
        const cur = q.shift();
        for (const p of rin[cur] || []) {
          if (dist[p] == null) { dist[p] = dist[cur] + 1; q.push(p); }
        }
      }
      const next = {};
      for (const id of all) {
        if (dist[id] == null || dist[id] === 0) continue;
        for (const t of rout[id] || []) {
          if (dist[t] === dist[id] - 1) { next[id] = t; break; }
        }
      }
      paths[h.id] = { dist, next };
    }
    return paths;
  }

  // A batter leaving `plate` for `target`: which outgoing edge starts the
  // shortest route, and how many steps is the full trip? (Needed because for
  // the 'own' rule dist[plate] is trivially 0 — the lap has to go out first.)
  function batterStart(layout, paths, plate, target) {
    const P = paths[target];
    let best = null;
    for (const e of layout.edges) {
      if (e.from !== plate) continue;
      const d = P.dist[e.to];
      if (d != null && (best == null || d < best.d)) best = { node: e.to, d };
    }
    return best ? { first: best.node, startDist: best.d + 1 } : null;
  }

  // Full node chain of the shortest route plate → target (for highlighting).
  function routeOf(layout, paths, plate) {
    const target = targetOf(layout, plate);
    const bs = batterStart(layout, paths, plate, target);
    if (!bs) return null;
    const chain = [plate, bs.first];
    let cur = bs.first;
    const P = paths[target];
    let guard = 0;
    while (P.dist[cur] > 0 && guard++ < 500) {
      cur = P.next[cur];
      if (cur == null) return null;
      chain.push(cur);
    }
    return { target, chain, steps: bs.startDist };
  }

  // Can every plate's batter reach their scoring plate?
  function validate(layout) {
    const paths = buildPaths(layout);
    return layout.homes.map((h) => {
      const target = targetOf(layout, h.id);
      const bs = batterStart(layout, paths, h.id, target);
      return { home: h.id, target, steps: bs ? bs.startDist : null };
    });
  }

  function serialize(layout) { return JSON.stringify(layout); }

  function deserialize(json) {
    try {
      const l = JSON.parse(json);
      if (!l || !Array.isArray(l.homes) || l.homes.length !== 3
        || !Array.isArray(l.nodes) || !Array.isArray(l.edges)) return null;
      return l;
    } catch (e) { return null; }
  }

  const API = {
    FT2PX, CX, CY,
    homePositions, clockwiseNext, targetOf, findNode,
    addNode, removeNode, addEdge, removeEdge, setSpacing,
    rotatePoint, rotCounterpart,
    addNodeSym, moveNodeSym, removeNodeSym, addEdgeSym, removeEdgeSym,
    basesCentroid, moundPositions,
    makeStarter, makeNgon, buildPaths, batterStart, routeOf, validate,
    serialize, deserialize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MBB_LAYOUT = API;
})(typeof window !== 'undefined' ? window : globalThis);
