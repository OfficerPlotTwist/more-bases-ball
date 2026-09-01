# moreBasesBall — agent guidance (mined from Aug 2026 sessions)

- When you produce or update the site/page, open it in the browser AND print the clickable URL in the same message — don't wait to be asked.
- Pages here load ES modules: serve them (`npx serve <dir>`) instead of opening `file://`, which breaks module loading.

## The 3D field (field3d.js)

- `field3d.js` is the only ES module here; everything else is an IIFE that
  hangs itself off `window`. It is loaded with `<script type="module">` and
  an importmap pointing `three` at `vendor/three.module.js`.
- It renders `entry.anim` and decides nothing. If a play looks wrong on
  screen, check the engine that built the timeline before touching the
  renderer.
- One clock, and it matters: `buildAnim` must time the throw off
  `entry.defense.tSecure` — the same number `resolveBallOut` used to decide
  the play — never off raw flight time. Timing them separately is what made
  the ball leave before the fielder arrived on 58% of throws, so he ran to
  an empty patch of grass and the throw came from nobody. `tests/anim.test.js`
  guards this.
- Ball height is NOT in the data — the engine stores ground positions only.
  Arcs are rebuilt per leg in `arcHeight()` off the `leg` tag each ball
  waypoint carries (`pitch` / `batted` / `homer` / `throw`).
- Canvas textures need `colorSpace = THREE.SRGBColorSpace`, or three treats
  them as linear and the turf washes out to sage.
- Camera framing is computed from field size and lens, never hard-coded —
  a 90ft diamond and a 250ft triangle both have to fill the frame.
- The shadow frustum is fitted to the field in `fitShadows()`. A fixed one
  spreads the shadow map thin enough that the outfield shadows itself.

## Classic games

Classic N-gon outcomes come from `sim.js` and must stay that way — the run
environment in the README (1 base ≈ 18 runs/game, 7 ≈ 6) is a published
result. `ngon.js` only adds geometry on top; `tests/ngon.test.js` asserts the
box score is byte-identical before and after.

## Tests

`for t in tests/*.test.js; do node $t; done` — all ten must pass.
`tests/defense-stress.test.js` is the one to run after touching anything in
`fielders.js` or `resolveBallOut`: it covers the awkward custom layouts.

- The outfield plane must keep `receiveShadow = false`. It extends far past
  the shadow frustum and the boundary shows up as dark triangles on the
  turf; the per-player contact blobs are what actually read at this scale.

## Runner rules

`resolveBallOut` owes the runners two real rules, and both have bitten:

- **Force** is a chain from the batter's first base through every occupied
  base in front of it, stopping at the first gap. It is NOT "everyone runs
  on a ground ball" — that shoved runners off bases they never had to leave
  and doubled them up for it.
- **A catch removes every force**, and a tagging runner cannot leave until
  the ball is in the glove (`tGo` on the move, seconds after contact; the
  animation waits on it).

Fielder depth is not purely a function of the base ring. Batted-ball carry
is fixed physics, so the outfield floor is `OF_DEPTH_FT`; without it a small
field's outfielders stand closer than a routine fly ball, nothing is ever
caught, and the tag-up rules can never fire.

Prefer testing runner rules as a **differential on one play** (same ball,
two runners; or same runners, ground ball vs catch). "He did not move" alone
proves nothing — an unforced runner still advances whenever the bag is
poorly covered, which is by design.

## Players must not vanish mid-play

Only the ball fades during a play. Runners and fielders hold full opacity
until the play ends and `renderRunners` cuts at the boundary. Fading retired
and scored runners deleted the player you were watching at the exact moment
the red or green body was the point — who was out, and where. 100% of them
were vanishing early, 0.54s on average.

A player is four materials (body, head, contact shadow, name sprite). Fade
them together via `setPlayerOpacity` — fading `userData.mat` alone leaves a
solid head floating over a solid shadow.
