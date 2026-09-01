# moreBasesBall

Baseball simulation driven by real 2024 MLB batting lines — on a field with
however many bases you want (1–7). The diamond becomes a triangle, pentagon,
hexagon… and the run environment changes with it.

## Run it

Open `index.html` in a browser. No build step, no dependencies.

(If your browser blocks local files, `npx serve .` and open the printed URL.)

## What you can do

1. Pick two of six teams (Dodgers, Yankees, Phillies, Braves, Astros, Mets — 2024 lineups).
2. Set the house rules: bases 1–7, innings 1–12, outs per inning 1–5.
3. **Play ball** — one animated game with play-by-play, scoreboard, and runners on the morphing field. Flip the field to **3D** to watch each play run in real time (below).
4. **Sim 500 games** — win rates, run environment, extremes for the matchup.
5. **Scan bases 1–7** — how scoring changes as the field grows (spoiler: 1 base ≈ 18 runs/game, 7 bases ≈ 6).

## The 3D field

Every field panel has a **2D / 3D** toggle. The flat SVG view is still where
you design a layout — placing a base is a click on the diagram — but 3D is
where you watch the game.

- **Runners, defenders and the ball all move**, off the same timeline the
  engine used to decide the play. The throw that beats the runner on screen
  is the throw that beat him in the box score.
- **One clock.** The ball is not thrown until a fielder has actually reached
  it: it lands, sits where it came down, and leaves only when the man who
  ran it down is standing over it — using the exact fielding time the engine
  used to decide whether the runner was safe. When there is no play to make
  he still throws it back in rather than standing there holding it.
- **The ball flies.** The engine only stores ground positions, so the arc is
  reconstructed per leg at render time: a pitch sags across the plate, a
  60-foot chopper skips, a 440-foot homer climbs out of frame.
- **The whole play stays on screen.** The ball drags a trail for the length
  of the play and runners and fielders leave ground tracks, so when it ends
  you are looking at the shape of the play, not a snapshot of dots.
- **Nobody vanishes mid-play.** Only the ball goes dead. A runner who is
  retired or who scores holds his spot in red or green until the play is
  over, because that is the moment worth seeing — who was out, and where.
- **Cameras**: Broadcast, High, Overhead, Plate — drag to orbit, scroll to
  zoom. Broadcast and Plate sit in on the infield; High and Overhead pull
  back far enough to hold an entire ball flight.
- Works on classic N-gons and custom layouts alike, and remembers which view
  you picked.

three.js is vendored (`vendor/three.module.js`, r169) — still no build step
and no network needed.

## The defense

Fielders are real. One rule sets the roster:

> every plate gets a pitcher and a catcher; six more field the ball.

So a classic diamond has 8 defenders and a three-plate field has 12 — the
shared pool stays at six however far the bases spread. Adding bases adds
ground to cover but nobody to cover it.

The six are placed by angle: the bases are sorted around the field centroid
and cut into six arcs, one fielder per arc, playing alternately shallow and
deep. Bases that fall between fielders are real holes.

Depth is not purely a function of the bases. Infielders play just off the
bags, but how far a ball carries is fixed physics — it lands 40-330ft from
the plate whatever the bases are doing — so the outfield plays at whichever
is deeper, the base ring or the distance the ball actually travels. Scaling
the outfield to the base ring alone parked the deepest man 138ft from home
on a classic diamond, closer in than a routine fly ball, and nothing was
ever caught in the air. Outfielders also line up across *fair* ground —
the wedge out beyond a plate, never behind it — so a one-plate field gets
three of them at 285-300ft from home, where left, centre and right belong.
With three plates the wedges tile the whole circle, because balls really do
come from every direction, and the outfield spreads all the way round.

This decides plays, it is not decoration. A ball in play is not fielded when
it lands, it is fielded when somebody gets to it, and a runner is only
retired if the throw arrives *and* somebody is standing on the bag to take
it. An uncovered base is a free base.

Bags are matched to fielders shortest-distance-first across the whole play
(a plate's own catcher takes it first if he is free), so the nearest man to
a bag covers it rather than whoever the engine happened to ask about first —
which is what keeps the defense sensible on lopsided custom layouts. When
there are more bags in play than spare fielders the leftovers are reported
as uncovered, not silently dropped. `tests/defense-stress.test.js` runs the
whole thing against forty-base rings, two-base rings, bases stacked on one
spot, plates wired straight together, dead-end spurs, 80ft and 900ft fields,
and malformed coordinates.

One consequence worth knowing, because it falls out of the geometry rather
than being tuned in: a mid-size field is the best-covered one. At 250 ft
spacing the average ball is run down in 2.0 s, against 2.4 s at 150 ft and
3.2 s at 400 ft, and a sprawling field leaves gaps on 91% of balls versus
65% (`node tests/fielders.test.js`).

Classic N-gon games are the exception: their outcomes still come from
`sim.js`, so fielders there are shown but do not change results — see below.

## Runners

Two rules decide whether a runner moves, and they are the real ones.

**Force.** A runner only *has* to run when the base behind him is being
taken — the batter is coming to the first base on his route, so whoever is
standing there must vacate, which forces whoever is standing at *their* next
base, on down the chain until it reaches an empty one. A runner past that
gap owes the defense nothing. (The engine used to shove every runner off on
any ground ball, which is not a rule, and is why runners kept getting
doubled up off bases they never had to leave.)

**Tagging up.** A ball still in the air when a fielder reaches it is a
catch, and a catch removes every force — nobody is obliged to run. A runner
who does go cannot leave until the ball is in the glove, so his clock and
the throw's both start at the catch. That is what makes a deep fly a run and
a shallow one a dare, and you can watch him wait on the bag in the 3D view.

Beyond that a runner goes when he beats the play, with one asymmetry: a run
is worth more than a base, so a runner one step from scoring takes a chance
he would never take to move up a bag. That is the sacrifice fly, and it
lands at about 0.135 per run scored against MLB's ~0.11.

Throws are not flat-out heaves. Past a long single hop the ball goes through
a cutoff man, which costs an exchange and a slower relay throw, and every
throw carries a small aiming-and-handling cost that scales with distance. A
60 ft infield throw is barely touched; a 300 ft throw to the plate takes
3.2 s, which is the difference between gunning down every tagging runner and
the sacrifice fly being a play a team actually wants.

`tests/runners.test.js` checks all of it.

## Classic games and geometry

`sim.js` plays the classic game as a state machine: a base is an index in an
array. Those are the outcomes this project publishes (1 base ≈ 18 runs/game,
7 ≈ 6), so nothing about them has changed.

`ngon.js` reads a finished classic game and works out *where* each play
happened — building the N-gon as a real layout graph (a regular (N+1)-gon of
90 ft sides, so 3 bases is the familiar diamond) and turning each base-state
change into runner paths, a contact point and a throw. Every classic play
then carries the same animation timeline a custom layout produces, which is
what lets the diamond animate in 3D. The box score is untouched, and
`tests/ngon.test.js` asserts exactly that.

## Field designer (custom layouts)

Switch **Field mode → Custom layout (designer)** to build your own field:

- **Three home plates** (H1/H2/H3) sit in a fixed triangle; the spacing box
  sets how many feet apart they are.
- **Move / Add base / Connect → / Erase** — bases are graph nodes; Connect
  draws one-way basepaths (click origin, then destination — the arrow shows
  running direction).
- **Runners score at** their own plate (a full lap) or the **clockwise-next
  plate** — batters rotate through H1, H2, H3 as the lineup turns over.
- **Path check** — click a home plate to highlight the shortest legal route
  to its scoring plate; the status line always shows each plate's step count
  or flags plates with **no path** (games won't start until all three connect).
- **Symmetry ×3** (on by default) — every add, drag, connect, and erase is
  mirrored at 120° and 240° around the field center, so all three plates
  always get identical geometry. Plate endpoints rotate too: connecting
  H1 → base also connects H2 and H3 to that base's rotated twins. Toggle it
  off to build lopsided fields on purpose.
- **Starter ring** rebuilds the 9-node clockwise ring; layouts autosave to
  your browser.

On custom fields a single moves a runner one node along their route, a double
two, a homer clears everybody; walks push only forced runners, and a blocked
runner holds at the last open node. Sim 500 games works on custom layouts too.

### Tri-pitch mode (default for custom fields)

Every plate has its own **pitching mound**, drawn on the line from the plate
to the center point of all bases (it slides around as you move bases). All
three pitchers deliver inside the **same 1-second window** at random moments,
and plate appearances resolve in delivery order — the play-by-play shows each
pitch's `t+0.42s` offset.

- **Runners break on**: *their origin plate's hit* (runners only advance when
  the batter from their own plate connects) or *any plate's hit* (everyone
  runs on any contact — roughly doubles scoring, but exposes everyone).
- **Any runner can be played on**: on any ball in play the defense picks its
  best play — it guns down an exposed runner within 2 steps of scoring (70%
  success, batter reaches on the throw), looks for a double play on the
  trailing runner, or settles for the batter.
- Switch **Pitching** back to *one plate at a time* for the sequential engine.

### Distance physics & animated plays

Edge lengths are real feet (canvas scale 1.2 px/ft), and time decides plays:
runners move at ~27 ft/s (Statcast average sprint speed), throws travel at
~135 ft/s (+ transfer time), batted balls land at a contact point fanned out
from the batting plate.

- **Stretches** — a runner takes an extra base only when the next leg is
  short; long edges play station-to-station.
- **Contact plays** — on a ball in play, each exposed runner weighs their
  running time against the throw to their next node; clearly-safe runners
  go. Grounders (short contact) force everyone off their base.
- **Defense** — the fielders play on the most catchable goer (a runner
  reaching their scoring plate on an out ball is the generalized sac fly),
  and a successful cut-down can relay on to the batter for a double play.
- Measured: identical rules score ~19 runs/game with 120 ft plate spacing
  vs ~11 with 380 ft (`node tests/anim.test.js`).

**Animated playback**: in custom mode, Play ball animates every play — the
ball flies mound → plate → contact point → throw target, and every moving
runner glides along their actual basepath edges, timed by the same physics
(marathon plays compressed to 5 s). Broadcast pace maps to 1×/2×/5×/instant;
`prefers-reduced-motion` skips straight to results.

### Mound distance

The **Mound distance** box (45–75 ft, regulation 60.5) moves every rubber and
shifts batting outcomes. The adjustment is calibrated from real references:

- **Physics / MLB modeling** ([theScore analysis](https://www.thescore.com/mlb/news/2154016)):
  one extra foot plays like **~1.6 mph less perceived velocity** (a 93.3 mph
  fastball from 60'6" ≈ 91.6 mph from 61'6"); Statcast xBA against fastballs
  climbs steeply as velocity falls.
- **Atlantic League 2021 experiment** (mound at 61'6",
  [theScore follow-up](https://www.thescore.com/mlb/news/2193507),
  [ESPN](https://www.espn.com/mlb/story/_/id/31256639/mlb-atlantic-league-experiment-moving-back-mound-double-hook-dh)):
  at ±1 ft the real-world effect was **small** — K/9 roughly flat, walks
  *down* 7.5%, runs about −1%. The experiment was dropped after one season.
- **1893** (pitching distance 50 ft → 60.5 ft): league batting average jumped
  ~.245 → .280 — about **+3.3 points of BA per foot**, the large-delta anchor.

Per foot beyond 60.5 the sim applies: K% −0.7 pp, all hit types +2.5%
relative (HR an extra +1.5%), BB −4% relative (the observed AL direction);
mirrored when the mound moves in. Tested monotonic: 55 ft ≈ 10.2 runs/game,
60.5 ≈ 12.4, 66 ≈ 14.2 on the starter ring (`node tests/mound.test.js`).

```
node tests/trisim.test.js
```

covers mound colinearity, the 1s window (order, offsets, ≤3 pitches/cycle),
occupancy invariants, release-mode scoring, and that the defense actually
records CUT and DP plays.

## How it works

- Each plate appearance is a draw from the batter's real 2024 rates
  (BB, HR, 3B, 2B, 1B per PA; leftover is an out, split into K vs. ball-in-play
  by the batter's strikeout rate).
- Hits advance all runners by the hit's base value (with occasional stretching);
  walks advance only forced runners; sac flies and double plays occur on balls in play.
- Home runs always clear everything. With more bases, everything *else* gets
  harder — that's why octagon ball is a pitcher's paradise.
- On short fields, a hit worth more bases than the field has becomes an
  inside-the-park trot (marked in the play-by-play).

## Tests

```
node tests/sim.test.js
```

Checks line-score consistency, seed reproducibility, realistic classic-rules
scoring (~4.7 runs/team), the runs-vs-bases curve, termination on weird
configs, and the walk-off invariant.

## Tests (designer engine)

```
node tests/graphsim.test.js
```

Covers route validation under both scoring rules, occupancy invariants
(one runner per node), reproducibility, severed-path detection, and that
shorter routes score more.

## Files

- `data.js` — six teams × nine batters, real 2024 season lines
- `sim.js` — classic N-gon engine (pure, also loads in Node)
- `layout.js` — custom-field graph model: nodes, directed edges, path finding
- `fielders.js` — the defensive alignment: who is on the field and where
- `graphsim.js` — sequential game engine for custom layouts (3 plates, directed routes)
- `trisim.js` — tri-pitch engine: simultaneous plates, 1s pitch window, defense AI
- `ngon.js` — gives classic N-gon games real geometry without touching their outcomes
- `field3d.js` — the three.js field (ES module; everything else is a plain script)
- `editor.js` — the in-browser field designer tools
- `ui.js` — field rendering, playback, bulk sims
- `vendor/` — three.js r169, vendored so there is still no build step
- `index.html`, `style.css` — the ballpark at night
