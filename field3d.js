/* moreBasesBall — the 3D field.
 *
 * This renders the same play the 2D field renders, off the same timeline.
 * Every play in the log carries `anim`: a ball track, one track per moving
 * runner, and one per fielder who left his post, all timed in real seconds
 * off real distances. Nothing here decides anything — it draws what the
 * engine already worked out, which is why the throw that beats the runner
 * on screen is the throw that beat him in the box score.
 *
 * Two things the flat view cannot show, and the reason this exists:
 *
 *   Height. The stored ball track is flat, because the engine only cares
 *   about ground distance. The arc is reconstructed here, per leg: a pitch
 *   sags, a 60-foot chopper skips, a 440-foot homer climbs. See arcHeight.
 *
 *   The whole play at once. The ball drags a trail for the full play and
 *   runners and fielders leave ground tracks behind them, so at the end of
 *   a play you are looking at its shape — where the ball went, who broke
 *   for which bag, who got there — instead of a snapshot of dots.
 *
 * World units are feet, Y is up, and the layout's canvas coordinates map
 * straight through: wx = (x - CX) / FT2PX, wz = (y - CY) / FT2PX.
 */
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const L = window.MBB_LAYOUT;
const F = window.MBB_FIELDERS;

/* ---------------- palette ---------------- */

const C = {
  sky: 0x0c120e,
  grass: 0x2f5d33,
  grassAlt: 0x376b3c,
  dirt: 0xa97043,
  dirtDark: 0x8d5c36,
  base: 0xf4efe2,
  plate: 0xf4efe2,
  rubber: 0xe8e2d2,
  ball: 0xf4efe2,
  runner: 0xffc14d,
  runnerOut: 0xd64541,
  runnerScored: 0x6fd08c,
  fielder: 0x6ea8d8,
  fielderHot: 0x9fd0f5,
  trail: 0xf4efe2,
};

const RAD = Math.PI / 180;

/* ---------------- module state ---------------- */

let renderer, scene, camera, controls, host, sun;
let fieldGroup, actorGroup, trailGroup;
let layout = null, slots = [];
let raf = null, playing = null;
let ready = false;
let runnerPool = [], fielderPool = [], ballMesh = null;
// how far the grass has to reach vs. how much the camera should frame:
// balls carry ~460ft from a plate, but framing on that would leave the
// bases a speck in the middle of an empty outfield
let extentFt = 300, frameFt = 220;

/* ---------------- coordinate helpers ---------------- */

const wx = (x) => (x - L.CX) / L.FT2PX;
const wz = (y) => (y - L.CY) / L.FT2PX;
const vecOf = (p, h) => new THREE.Vector3(wx(p.x), h || 0, wz(p.y));

/* ---------------- ball height ---------------- */

/* The engine stores where the ball was, never how high. Rebuild that from
 * what each leg of the track is: `u` runs 0→1 across the leg.
 *
 *   pitch    leaves the hand at chest height and sags across the plate
 *   batted   a parabola whose peak scales with how far the ball carried,
 *            so infield choppers skip and gappers climb
 *   homer    the same, thrown higher, still rising as it leaves
 *   throw    a flat line drive with just enough arc to read
 */
function arcHeight(leg, u, distFt) {
  const par = u * (1 - u) * 4; // 0 at both ends, 1 at the middle
  if (leg === 'pitch') return 5.6 * (1 - u) + 2.4 * u + par * 0.6;
  if (leg === 'batted') {
    const apex = distFt < 110 ? 2 + distFt * 0.045 : Math.min(120, distFt * 0.24);
    return par * apex + 2.5 * (1 - u);
  }
  if (leg === 'homer') return par * Math.min(150, distFt * 0.27) + 3 * (1 - u);
  if (leg === 'throw') return par * (5 + distFt * 0.05) + 5 * (1 - u) + 3.5 * u;
  return 0;
}

// Where a track is at time t, with height for the ball.
function trackPos(pts, t, isBall) {
  if (t <= pts[0].t) return { x: pts[0].x, y: pts[0].y, h: isBall ? arcHeight(pts[0].leg, 0, 0) : 0 };
  const last = pts[pts.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, h: 0 };
  for (let i = 1; i < pts.length; i++) {
    if (t > pts[i].t) continue;
    const a = pts[i - 1], b = pts[i];
    const span = b.t - a.t || 1e-6;
    const u = (t - a.t) / span;
    const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
    if (!isBall) return { x, y, h: 0 };
    const legFt = Math.hypot(b.x - a.x, b.y - a.y) / L.FT2PX;
    return { x, y, h: arcHeight(b.leg, u, b.distFt != null ? b.distFt : legFt) };
  }
  return { x: last.x, y: last.y, h: 0 };
}

/* ---------------- textures ---------------- */

// Mown stripes, drawn once into a canvas and tiled across the outfield.
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2f5d33';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#376b3c';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 2600; i++) { // a little noise so the stripes are not plastic
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  // canvas pixels are already sRGB; without this three treats them as
  // linear and re-encodes on output, which washes the turf out to sage
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.anisotropy = 4;
  return t;
}

// A soft round blob used as a contact shadow under every player.
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(0,0,0,0.5)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// A name tag that always faces the camera.
function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 34px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(12,18,14,0.9)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, depthTest: false,
  }));
  s.scale.set(34, 8.5, 1);
  s.position.y = 13;
  s.renderOrder = 10;
  return s;
}

let BLOB = null;

/* ---------------- actors ---------------- */

// One player: capsule body, sphere head, contact shadow, name tag.
function makePlayer(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 3.6, 4, 10), mat);
  body.position.y = 3.4;
  body.castShadow = true;
  g.add(body);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8cfa8, roughness: 0.8 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 10), headMat);
  head.position.y = 6.6;
  head.castShadow = true;
  g.add(head);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: BLOB, transparent: true, depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.06;
  g.add(shadow);
  // a player is four materials, not one — fading only the body leaves a
  // solid head floating over a solid shadow
  g.userData = { mat, body, head, label: null, mats: [mat, headMat, shadowMat] };
  return g;
}

// Fade a whole player, name tag included.
function setPlayerOpacity(p, op) {
  const d = p.userData;
  if (!d || !d.mats) return;
  for (const m of d.mats) { m.transparent = op < 1; m.opacity = op; }
  if (d.label) d.label.material.opacity = op;
}

function setPlayerLabel(p, text, color) {
  if (p.userData.label) { p.remove(p.userData.label); p.userData.label = null; }
  if (!text) return;
  const s = labelSprite(text, color);
  p.add(s);
  p.userData.label = s;
}

function borrow(pool, color) {
  for (const p of pool) {
    if (p.visible) continue;
    // a reused body must never wear the last occupant's name
    setPlayerLabel(p, null);
    p.visible = true;
    p.userData.mat.color.setHex(color);
    setPlayerOpacity(p, 1);
    return p;
  }
  const p = makePlayer(color);
  actorGroup.add(p);
  pool.push(p);
  return p;
}

function retireAll(pool) {
  for (const p of pool) { p.visible = false; setPlayerLabel(p, null); }
}

/* ---------------- trails ---------------- */

/* A trail is a polyline that grows a point per frame and fades toward its
 * tail by darkening the vertex colours — the cheapest way to get a fading
 * line out of a plain LineBasicMaterial.
 */
const MAX_TRAIL = 420;

function makeTrail(color, width) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, linewidth: width || 1,
  }));
  line.frustumCulled = false;
  line.userData = { n: 0, color: new THREE.Color(color) };
  trailGroup.add(line);
  return line;
}

function pushTrail(line, x, y, z) {
  const d = line.userData;
  const pos = line.geometry.attributes.position;
  if (d.n >= MAX_TRAIL) { // shift the window along rather than reallocating
    pos.array.copyWithin(0, 3);
    line.geometry.attributes.color.array.copyWithin(0, 3);
    d.n = MAX_TRAIL - 1;
  }
  pos.setXYZ(d.n, x, y, z);
  d.n++;
  const col = line.geometry.attributes.color;
  for (let i = 0; i < d.n; i++) { // oldest end darkest
    const f = 0.12 + 0.88 * (i / Math.max(1, d.n - 1));
    col.setXYZ(i, d.color.r * f, d.color.g * f, d.color.b * f);
  }
  line.geometry.setDrawRange(0, d.n);
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

function clearTrails() {
  for (const t of trailGroup.children) {
    t.userData.n = 0;
    t.geometry.setDrawRange(0, 0);
  }
  trailGroup.clear();
}

/* ---------------- the field ---------------- */

function pentPlate(size) {
  // home plate: the real five-sided shape, pointing away from the field
  const s = new THREE.Shape();
  const h = size / 2;
  s.moveTo(-h, -h); s.lineTo(h, -h); s.lineTo(h, h * 0.4);
  s.lineTo(0, h * 1.2); s.lineTo(-h, h * 0.4); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

function buildField() {
  fieldGroup.clear();

  const nodes = layout.nodes, homes = layout.homes;
  slots = F.fielderSlots(layout);
  // Two radii, because they frame different shots. The bases are what the
  // low, close views want; the defense stands much further out (the
  // outfield plays where the ball lands, not where the bases are) and is
  // what the wide views have to hold.
  let baseR = 60, maxR = 60;
  for (const p of homes.concat(nodes)) {
    baseR = Math.max(baseR, Math.hypot(wx(p.x), wz(p.y)));
  }
  maxR = baseR;
  for (const p of slots) maxR = Math.max(maxR, Math.hypot(wx(p.x), wz(p.y)));
  // batted balls carry out to ~460ft from a plate, so the grass has to
  // reach past the bases by that much or homers land in the void
  extentFt = maxR + 380;
  // the close views start from the bases and a little air around them; the
  // wide ones reach out past the defense (see VIEWS.reach)
  frameFt = baseR * 1.3 + 60;

  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(extentFt * 2.4, 96),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  // The outfield deliberately does NOT receive shadow-map shadows. It runs
  // far past the shadow frustum (which is sized to the infield so the map
  // is not spread thin), and out at that boundary the lookup produces dark
  // triangular patches on the turf. Every player carries a soft contact
  // shadow of its own, which is what actually reads at this distance, so
  // there is nothing to gain by shadowing the grass and one ugly failure
  // mode to lose.
  grass.receiveShadow = false;
  fieldGroup.add(grass);

  const dirtMat = new THREE.MeshStandardMaterial({ color: C.dirt, roughness: 1 });
  const dirtDarkMat = new THREE.MeshStandardMaterial({ color: C.dirtDark, roughness: 1 });

  // basepaths: a dirt ribbon per directed edge, with a chevron at the far
  // end so one-way paths still read as one-way
  for (const e of layout.edges) {
    const a = L.findNode(layout, e.from), b = L.findNode(layout, e.to);
    if (!a || !b) continue;
    const va = vecOf(a), vb = vecOf(b);
    const len = va.distanceTo(vb);
    if (len < 1) continue;
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(len, 9), dirtMat);
    ribbon.rotation.x = -Math.PI / 2;
    ribbon.position.copy(va).lerp(vb, 0.5).setY(0.03);
    ribbon.rotation.z = -Math.atan2(vb.z - va.z, vb.x - va.x);
    ribbon.receiveShadow = true;
    fieldGroup.add(ribbon);

    const chev = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 3), dirtDarkMat);
    chev.position.copy(va).lerp(vb, 0.72).setY(0.32);
    chev.rotation.x = -Math.PI / 2;
    chev.rotation.y = 0; // cone points +Y before the tilt, so aim it in-plane
    chev.rotation.z = -Math.atan2(vb.z - va.z, vb.x - va.x) - Math.PI / 2;
    fieldGroup.add(chev);
  }

  // bases: dirt cutout plus a white pad
  for (const n of nodes) {
    const v = vecOf(n);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(13, 28), dirtMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(v).setY(0.05);
    ring.receiveShadow = true;
    fieldGroup.add(ring);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.6, 5),
      new THREE.MeshStandardMaterial({ color: C.base, roughness: 0.6 }));
    pad.position.copy(v).setY(0.35);
    pad.castShadow = true;
    fieldGroup.add(pad);
  }

  const centre = L.basesCentroid(layout);
  const mounds = L.moundPositions(layout);

  for (const h of homes) {
    const v = vecOf(h);
    const circle = new THREE.Mesh(new THREE.CircleGeometry(20, 32), dirtMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.copy(v).setY(0.04);
    circle.receiveShadow = true;
    fieldGroup.add(circle);
    const plate = new THREE.Mesh(pentPlate(5.5),
      new THREE.MeshStandardMaterial({ color: C.plate, roughness: 0.55 }));
    plate.position.copy(v).setY(0.3);
    // point the plate's nose away from the middle of the field
    plate.rotation.y = -Math.atan2(wz(centre.y) - v.z, wx(centre.x) - v.x) + Math.PI / 2;
    fieldGroup.add(plate);

    const m = mounds.find((x) => x.plate === h.id);
    if (!m) continue;
    const mv = vecOf(m);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 0.9, 28), dirtMat);
    mound.position.copy(mv).setY(0.45);
    mound.receiveShadow = true;
    mound.castShadow = true;
    fieldGroup.add(mound);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.7),
      new THREE.MeshStandardMaterial({ color: C.rubber, roughness: 0.6 }));
    rubber.position.copy(mv).setY(0.95);
    fieldGroup.add(rubber);
  }

  // Fade the far grass into the night sky so the edge of the disc never
  // reads as a horizon line. Fog is measured from the camera, which sits
  // about frameFt away, so it must not start until well past the bases or
  // it hazes the field itself.
  scene.fog.near = frameFt * 3.2;
  scene.fog.far = extentFt * 2.6;

  fitShadows(frameFt);
}

/* Point the sun at the field and shrink its shadow frustum to fit. A
 * fixed frustum has to cover the biggest possible field, which spreads the
 * shadow map so thin over a small one that the grass shadows itself.
 */
function fitShadows(radiusFt) {
  if (!sun) return;
  const r = Math.max(120, radiusFt);
  sun.position.set(r * 0.85, r * 1.3, r * 0.55);
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r;
  cam.top = r; cam.bottom = -r;
  cam.near = 1;
  cam.far = r * 4;
  cam.updateProjectionMatrix();
}

/* ---------------- camera ---------------- */

/* A preset is an elevation plus how much of the play to hold in frame.
 * `reach` blends between the bases (0) and the whole area a batted ball
 * can reach (1): the low views sit in close on the infield and let a deep
 * fly leave the top of the screen, while High and Overhead pull back far
 * enough to keep an entire ball flight — homers included — on screen.
 * The actual distance falls out of the field size and the lens, so a 90ft
 * diamond and a 250ft triangle both frame properly; `dist` only trims.
 */
const VIEWS = {
  broadcast: { el: 31, reach: 0.10, dist: 1.05 },
  high: { el: 52, reach: 0.45, dist: 1.0 },
  overhead: { el: 88, reach: 0.70, dist: 1.0 },
  plate: { el: 9, reach: 0.0, dist: 0.9 },
};
let viewName = 'broadcast';
let viewAz = 90; // degrees; kept so a preset swap does not spin the field

function applyView(name) {
  const v = VIEWS[name] || VIEWS.broadcast;
  viewName = name;
  const el = v.el * RAD, az = viewAz * RAD;
  // Distance that makes a field of radius frameFt just fill the frame
  // vertically. Looking down, that is the full radius; from low down the
  // field foreshortens, so less distance is needed — with a floor so the
  // plate view does not end up inside the infield.
  const radius = frameFt + (extentFt - frameFt) * (v.reach || 0);
  const fit = radius / Math.tan((camera.fov / 2) * RAD);
  const r = fit * Math.max(Math.sin(el), 0.45) * v.dist;
  camera.position.set(
    Math.cos(az) * Math.cos(el) * r,
    Math.sin(el) * r,
    Math.sin(az) * Math.cos(el) * r);
  controls.target.set(0, 0, 0);
  controls.update();
}

/* ---------------- lifecycle ---------------- */

function init(container) {
  if (ready) return true;
  host = container;
  if (!host) return false;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 700, 2600); // retuned per layout in buildField

  camera = new THREE.PerspectiveCamera(42, 16 / 9, 1, 6000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.04; // never duck under the grass
  controls.minDistance = 60;
  controls.maxDistance = 4000;

  scene.add(new THREE.HemisphereLight(0x86a6c8, 0x1f3a1c, 0.5));
  sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
  sun.position.set(420, 620, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // normalBias offsets the lookup along the surface normal, which is what
  // actually stops a big flat receiver like the outfield from shadowing
  // itself into dark patches
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  fitShadows(300);

  BLOB = blobTexture();

  fieldGroup = new THREE.Group();
  actorGroup = new THREE.Group();
  trailGroup = new THREE.Group();
  scene.add(fieldGroup, actorGroup, trailGroup);

  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 12),
    new THREE.MeshStandardMaterial({
      color: C.ball, roughness: 0.4, emissive: 0x55503f, emissiveIntensity: 0.5,
    }));
  ballMesh.castShadow = true;
  ballMesh.visible = false;
  actorGroup.add(ballMesh);

  ready = true;
  resize();
  window.addEventListener('resize', resize);
  loop();
  return true;
}

function resize() {
  if (!ready || !host) return;
  const w = host.clientWidth || 720;
  const h = Math.max(320, Math.round(w * 0.66));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loop() {
  requestAnimationFrame(loop);
  if (!ready) return;
  if (controls) {
    controls.update();
    // remember where the user dragged to, so switching presets keeps it
    const p = camera.position;
    viewAz = Math.atan2(p.z, p.x) / RAD;
  }
  renderer.render(scene, camera);
}

/* ---------------- what is on the field ---------------- */

function setLayout(next) {
  if (!ready || !next) return;
  layout = next;
  buildField();
  showFielders();
  applyView(viewName);
}

// The standing defence, at their posts.
function showFielders(override) {
  retireAll(fielderPool);
  for (const s of slots) {
    if (override && override.has(s.id)) continue;
    const p = borrow(fielderPool, s.role === 'P' ? C.fielderHot : C.fielder);
    p.position.set(wx(s.x), 0, wz(s.y));
  }
}

function renderRunners(occ) {
  retireAll(runnerPool);
  for (const o of occ || []) {
    const n = L.findNode(layout, o.node);
    if (!n) continue;
    const p = borrow(runnerPool, C.runner);
    p.position.set(wx(n.x), 0, wz(n.y));
    setPlayerLabel(p, o.name.split(' ').pop(), '#ffc14d');
  }
}

function clearRunners() {
  retireAll(runnerPool);
  ballMesh.visible = false;
  clearTrails();
}

function cancelAnim() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  playing = null;
}

/* ---------------- playback ---------------- */

/* Runs one play. Same signature as the 2D renderer so the two are
 * interchangeable: hold the runners who are not involved where they stand,
 * move everyone who is along their track, and hand control back when the
 * play is over.
 */
function animatePlay(entry, prevOcc, speedMult, done) {
  cancelAnim();
  clearTrails();
  const anim = entry.anim;
  if (!ready || !anim || !anim.tracks.length || speedMult <= 0) {
    renderRunners(entry.occupancyAfter);
    showFielders();
    done();
    return;
  }

  const moving = new Set(anim.tracks.filter((t) => t.kind === 'runner').map((t) => t.name));
  renderRunners((prevOcc || []).filter((o) => !moving.has(o.name)));

  const busy = new Set(anim.tracks.filter((t) => t.kind === 'fielder').map((t) => t.slot));
  showFielders(busy);

  const actors = anim.tracks.map((tr) => {
    if (tr.kind === 'ball') {
      ballMesh.visible = true;
      return { tr, mesh: ballMesh, trail: makeTrail(C.trail) };
    }
    const isRunner = tr.kind === 'runner';
    const colour = isRunner
      ? (tr.out ? C.runnerOut : tr.scored ? C.runnerScored : C.runner)
      : (tr.chasing ? C.fielderHot : C.fielder);
    const p = borrow(isRunner ? runnerPool : fielderPool, colour);
    if (isRunner) {
      setPlayerLabel(p, tr.name.split(' ').pop(),
        tr.out ? '#d64541' : tr.scored ? '#6fd08c' : '#ffc14d');
    }
    return { tr, mesh: p, trail: makeTrail(colour) };
  });

  const t0 = performance.now();
  playing = entry;

  const frame = (now) => {
    const t = ((now - t0) / 1000) * speedMult;
    for (const a of actors) {
      const isBall = a.tr.kind === 'ball';
      const p = trackPos(a.tr.pts, t, isBall);
      const x = wx(p.x), z = wz(p.y);
      a.mesh.position.set(x, isBall ? p.h + 1.5 : 0, z);

      const end = a.tr.pts[a.tr.pts.length - 1].t;
      /* Only the ball leaves during a play — it is dead a beat after its
       * last waypoint. Nobody else fades out. A runner is usually retired
       * at the climax of the play, so fading him there deleted the player
       * you were watching, right when the red body was the whole point:
       * who was out, and where. Retired and scored runners now hold their
       * final spot in red and green for the rest of the play, and the next
       * pitch clears them at the play boundary where a cut reads cleanly.
       */
      let op = 1;
      if (isBall) {
        const fadeAt = end + 0.35;
        op = Math.min(1, Math.max(0, (fadeAt + 0.25 - t) / 0.25));
      }
      a.mesh.visible = op > 0.02;
      if (isBall) {
        a.mesh.material.transparent = op < 1;
        a.mesh.material.opacity = op;
      } else {
        setPlayerOpacity(a.mesh, op);
      }

      if (t >= a.tr.pts[0].t && op > 0.05) {
        pushTrail(a.trail, x, isBall ? p.h + 1.5 : 1.2, z);
      }
      a.trail.material.opacity = 0.95 * Math.max(op, isBall ? 0.35 : 0.2);
    }

    if (t >= anim.dur + 0.25) {
      cancelAnim();
      // the trails stay up for a moment after the play so the shape of it
      // is readable before the next pitch
      renderRunners(entry.occupancyAfter);
      showFielders();
      ballMesh.visible = false;
      ballMesh.material.opacity = 1;
      ballMesh.material.transparent = false;
      done();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

const API = {
  init, setLayout, renderRunners, clearRunners, animatePlay, cancelAnim,
  resize, applyView,
  isReady: () => ready,
  get layout() { return layout; },
};

window.MBB_FIELD3D = API;
window.dispatchEvent(new CustomEvent('mbb-field3d-ready'));
export default API;
