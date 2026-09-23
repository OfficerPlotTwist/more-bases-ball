/* moreBasesBall — the rules catalog and era resolution.
 *
 * 112 significant MLB rules changes, 1876-2026, from 27 sources. Pure data
 * and pure functions: this file imports nothing and cannot perturb a
 * simulation by being loaded.
 *
 * Tier A  structural — expressible as game state (innings, outs, lineup)
 * Tier B  rate       — a perturbation of the per-PA event distribution
 * Tier C  declared   — real, in effect, and not simulable by this engine
 *
 * Tier C ships visible rather than omitted, for the reason coverage.json
 * never omits an unavailable KPI: an absent entry reads as "this did not
 * exist", which is a different and wrong statement.
 *
 * GENERATED — rebuild with `node tools/build-rules.mjs`, do not hand-edit.
 * Source of truth: docs/decisions/2026-09-18-era-rules/rules-catalog.json
 */
(function (global) {
  'use strict';

  const CATALOG = Object.freeze([
  {
    "id": "1876-national-league-founded-first-nl-playing",
    "year": 1876,
    "league": "NL",
    "name": "National League founded; first NL playing code",
    "what_changed": "The NL replaced the National Association as the top league and adopted a written playing code: 45-foot pitching distance, underhand delivery only, nine called balls for a walk, batter calls for a high or low pitch, bat max 2.5 in diameter / 42 in long.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "NL 1876 baseline: league BA .265, 6.2 runs per team-game, 0.06 HR per team-game (Baseball-Reference NL 1876 totals). No 'before' exists inside MLB.",
    "model_note": "Baseline era parameters, not a delta.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1876-batter-calls-for-pitch-height",
    "year": 1876,
    "league": "NL",
    "name": "Batter calls for pitch height",
    "what_changed": "The batter could demand a 'high' (waist-to-shoulder), 'low' (one foot off ground to waist) or 'fair' pitch, and only pitches in the demanded band were strikes. Abolished in 1887.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "Only representable as a global strike-zone-size parameter; the batter's per-PA choice is not representable.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1877-low-ball-floor-raised-to-the-knee",
    "year": 1877,
    "league": "NL",
    "name": "Low-ball floor raised to the knee",
    "what_changed": "The bottom of the 'low ball' band moved from one foot above the ground to the batter's knee; 'waist' became 'belt'.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "Strike-zone-size parameter only.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1879-reserve-clause",
    "year": 1879,
    "league": "NL",
    "name": "Reserve clause",
    "what_changed": "Clubs could reserve five players each, who could not sign elsewhere; expanded over following seasons to whole rosters. Bound players to one club indefinitely until 1975.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified (labor-market rule; salary effects documented only qualitatively for the 19th century)",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: affects player movement, not plate outcomes.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1879-foul-bound-out-abolished-first-attempt",
    "year": 1879,
    "league": "NL",
    "name": "Foul-bound out abolished (first attempt)",
    "what_changed": "A batter was out on a foul only if the ball was caught on the fly; the one-bounce catch no longer retired him. Reversed in 1880, re-adopted permanently by the NL in 1883 and by the AA in 1886.",
    "category": "FIELDING",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: changes the fate of foul balls, which a PA-outcome model does not enumerate. Absorb into era BA/out rates.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1880-eight-balls-for-a-walk",
    "year": 1880,
    "league": "NL",
    "name": "Eight balls for a walk",
    "what_changed": "Called balls needed for a base on balls fell from nine to eight.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "NL walks per team-game 1879 ~0.4 to 1880 ~0.5; NL BA .255 (1879) -> .245 (1880). Direction consistent, magnitude small (Baseball-Reference NL totals).",
    "model_note": "Direct BB-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1880-called-third-strike-warning-removed",
    "year": 1880,
    "league": "NL",
    "name": "Called-third-strike warning removed",
    "what_changed": "The umpire no longer had to warn the batter ('good ball') before calling a third strike, so the effective count went from a warned four-pitch strikeout to a true three-strike strikeout.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "K-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1881-pitching-distance-45-ft-50-ft",
    "year": 1881,
    "league": "NL",
    "name": "Pitching distance 45 ft -> 50 ft",
    "what_changed": "The front line of the pitcher's box moved from 45 to 50 feet from home plate.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "NL BA .245 (1880) -> .260 (1881); NL runs per team-game ~4.6 -> ~5.2 (Baseball-Reference NL totals).",
    "model_note": "Global offense-level scalar.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1881-seven-balls-for-a-walk",
    "year": 1881,
    "league": "NL",
    "name": "Seven balls for a walk",
    "what_changed": "Balls needed for a walk fell from eight to seven.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified in isolation (same season as the 50-foot distance change)",
    "model_note": "BB-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1883-foul-bound-out-abolished-permanently-nl",
    "year": 1883,
    "league": "NL",
    "name": "Foul-bound out abolished permanently (NL)",
    "what_changed": "NL Rule 51(3): the batter is out on a foul only if held before touching the ground. The AA retained the one-bounce foul out until 1886.",
    "category": "FIELDING",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA (foul-ball fate).",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1884-overhand-pitching-legalized",
    "year": 1884,
    "league": "NL",
    "name": "Overhand pitching legalized",
    "what_changed": "The requirement that the pitcher's hand pass below the shoulder was deleted, permitting fully overhand delivery. The AA followed mid-1885.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "NL BA .245 (1883) -> .247 (1884) but NL strikeouts per team-game roughly doubled across 1883-1886 as overhand deliveries spread (Baseball-Reference NL totals). Muted in BA because balls-for-a-walk fell to six the same year.",
    "model_note": "K-rate and BABIP parameters.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1884-six-balls-for-a-walk-nl-seven-in-aa-ua",
    "year": 1884,
    "league": "NL",
    "name": "Six balls for a walk (NL); seven in AA/UA",
    "what_changed": "The NL cut balls-for-a-walk to six while the American Association and Union Association kept seven. NL went back to seven in 1886 while the AA moved to six.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified in isolation",
    "model_note": "BB-rate parameter; must be league-specific for 1884-1886.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1885-flat-sided-bat-permitted",
    "year": 1885,
    "league": "NL",
    "name": "Flat-sided bat permitted",
    "what_changed": "Rule 14(2) allowed a portion of the bat surface to be flat on one side, legalizing a bunting/place-hitting bat. Repealed in 1893.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Could only appear as a small bunt/contact-rate shift.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1887-four-strikes-for-a-strikeout-one-season",
    "year": 1887,
    "league": "NL and AA",
    "name": "Four strikes for a strikeout (one season)",
    "what_changed": "Under the 1887 joint code a batter needed four strikes to be retired. Reverted to three in 1888.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "Combined 1887 package: NL BA .269 in 1887 vs .251 in 1886 and .239 in 1888 - a ~30-point round trip. The four-strike rule alone is not separable from the five-ball rule in the same code.",
    "model_note": "K-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1887-five-balls-for-a-walk",
    "year": 1887,
    "league": "NL and AA",
    "name": "Five balls for a walk",
    "what_changed": "Balls needed for a walk fell from seven (NL) / six (AA) to five under the joint code.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "See the four-strike row: NL BA .251 (1886) -> .269 (1887) -> .239 (1888).",
    "model_note": "BB-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1887-walks-counted-as-hits-scoring-only-one-s",
    "year": 1887,
    "league": "NL and AA",
    "name": "Walks counted as hits (scoring only, one season)",
    "what_changed": "For 1887 only, a base on balls was scored as a base hit and an at-bat. Rescinded for 1888; modern encyclopedias retroactively strip these, so published 1887 averages differ by source.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "As originally published, 1887 NL BA was ~.310 vs the retroactively corrected .269; Cap Anson lost 60 'hits' when the season was recomputed under modern rules. Roughly a 40-point published-BA inflation.",
    "model_note": "Pure scoring convention: the simulator's on-field behaviour is unaffected; only the stat line changes.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1887-hit-batsman-awarded-first-base",
    "year": 1887,
    "league": "NL and AA",
    "name": "Hit batsman awarded first base",
    "what_changed": "Rule 48(4): a batter hit by a pitch on person or clothing is awarded first base unless the umpire judges he let himself be hit. Before 1887 an HBP was simply a ball/no award.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified (HBP was not separately tabulated league-wide before 1887 in most sources)",
    "model_note": "Introduces the HBP outcome; before 1887 set HBP rate to zero.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1887-batter-can-no-longer-call-pitch-height-f",
    "year": 1887,
    "league": "NL and AA",
    "name": "Batter can no longer call pitch height; fixed strike zone",
    "what_changed": "The high/low call was abolished and the strike zone fixed at knee-to-shoulder over the plate, roughly doubling the effective zone.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified in isolation (same code as the five-ball and four-strike changes)",
    "model_note": "Zone-size parameter feeding BB and K rates.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1887-obvious-attempt-to-foul-strike",
    "year": 1887,
    "league": "NL and AA",
    "name": "Obvious attempt to foul = strike",
    "what_changed": "Rule 31(3) made any obvious attempt to hit the ball foul a called strike - the first foul-as-strike provision, 14 years before the general foul-strike rule.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: an umpire-judgment event on individual pitches.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1888-three-strikes-restored",
    "year": 1888,
    "league": "NL and AA",
    "name": "Three strikes restored",
    "what_changed": "The strikeout returned to three strikes after the one-year four-strike experiment.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "NL BA .269 (1887) -> .239 (1888), a 30-point collapse alongside the reversion of the walks-as-hits scoring rule.",
    "model_note": "K-rate parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1889-four-balls-for-a-walk-modern-count-estab",
    "year": 1889,
    "league": "NL and AA",
    "name": "Four balls for a walk (modern count established)",
    "what_changed": "Rule 44(2) set the base on balls at four called balls. Unchanged since.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "NL BA .239 (1888) -> .264 (1889); NL runs per team-game ~4.5 -> ~5.8; walks per team-game roughly doubled (Baseball-Reference NL totals).",
    "model_note": "BB-rate parameter; the single largest walk-rate step in the catalog.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1889-sacrifice-hit-recognized-in-scoring",
    "year": 1889,
    "league": "NL and AA",
    "name": "Sacrifice hit recognized in scoring",
    "what_changed": "Rule 68(4) credited a sacrifice hit to a batter who advanced a runner via a fly to the outfield or a ground out. At first no at-bat exemption was granted (that came in 1897).",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "Scoring convention: changes the denominator of BA, not play outcomes.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1889-minimum-home-run-fence-distance-210-ft",
    "year": 1889,
    "league": "NL and AA",
    "name": "Minimum home-run fence distance 210 ft",
    "what_changed": "Rule 40 required a fair ball over the fence to clear it at least 210 feet from home to count as a home run; shorter ones were doubles, with a marked line on the fence.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Reassigns a slice of HR to 2B in park-specific terms.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1889-foul-tip-defined",
    "year": 1889,
    "league": "NL and AA",
    "name": "Foul tip defined",
    "what_changed": "Rule 38 defined a foul tip as a foul not rising above the batter's head caught by the catcher within ten feet of home, distinguishing it from a foul fly out.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA (within-PA pitch event).",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1892-minimum-home-run-distance-raised-to-235-",
    "year": 1892,
    "league": "NL",
    "name": "Minimum home-run distance raised to 235 ft",
    "what_changed": "Balls clearing the fence closer than 235 feet became doubles rather than home runs.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Park-specific HR-to-2B reassignment.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1893-pitching-rubber-at-60-ft-6-in-pitcher-s-",
    "year": 1893,
    "league": "NL",
    "name": "Pitching rubber at 60 ft 6 in; pitcher's box abolished",
    "what_changed": "Rule 5 replaced the 50-foot pitcher's box with a 12x4-inch rubber slab 60 ft 6 in from home, and Rule 27 required the pitcher to keep one foot in contact with it. Because the pitcher previously had to stay wholly inside the box, the effective distance increase was under 10 ft 6 in.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "NL BA .245 (1892) -> .280 (1893) -> .309 (1894); NL runs per team-game ~5.1 (1892) -> ~6.6 (1893) -> ~7.4 (1894). The largest single offensive shock in MLB history, though 1894 also carries the new foul-bunt strike and a livelier competitive environment.",
    "model_note": "Global offense scalar (BA, BABIP, K-rate).",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1893-flat-sided-bats-banned",
    "year": 1893,
    "league": "NL",
    "name": "Flat-sided bats banned",
    "what_changed": "Rule 13 deleted the 1885 clause permitting one flat surface; bats must be fully round.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Small bunt/contact effect at most.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1894-foul-bunt-counts-as-a-strike",
    "year": 1894,
    "league": "NL",
    "name": "Foul bunt counts as a strike",
    "what_changed": "Rule 43 Sec 4: a foul hit other than a foul tip made while attempting a bunt is a strike. Bunt defined in Rule 40 as a fair hit to the ground within the infield.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified in isolation (1894 is dominated by the 1893 distance change)",
    "model_note": "IMPOSSIBLE TO MODEL per-PA in a clean way: a within-PA count event conditioned on bunt attempts.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1894-sacrifice-restricted-to-bunts",
    "year": 1894,
    "league": "NL",
    "name": "Sacrifice restricted to bunts",
    "what_changed": "Rule 70 Sec 4 limited the sacrifice credit to bunts, removing it from ground outs and outfield flies. This is the first removal of the sacrifice fly.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "Scoring convention affecting AB denominator.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1895-bat-diameter-to-2-75-in-fielder-glove-si",
    "year": 1895,
    "league": "NL",
    "name": "Bat diameter to 2.75 in; fielder glove size limited",
    "what_changed": "Rule 15 widened the bat's thickest part from 2.5 to 2.75 inches. Rule 16 Sec 2 capped non-catcher/non-first-base gloves at 10 oz and 14 in around the palm, while leaving catchers and first basemen unrestricted.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Only as a BABIP/defense-efficiency parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1895-infield-fly-rule",
    "year": 1895,
    "league": "NL",
    "name": "Infield fly rule",
    "what_changed": "With a runner on first (later first and second, or bases loaded) and fewer than two out, an infield fly is an automatic out and runners are not forced, ending deliberate drops for double plays. Extended from one-out-only to none-or-one-out in 1901.",
    "category": "FIELDING",
    "measured_effect": "unquantified",
    "model_note": "Representable only if the sim distinguishes fly outs and force states; suppresses a class of double plays.",
    "modelable_per_pa": "partial",
    "confidence_year": "medium",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1900-five-sided-17-inch-home-plate",
    "year": 1900,
    "league": "NL",
    "name": "Five-sided 17-inch home plate",
    "what_changed": "Rule 9 replaced the 12-inch square home base with the modern five-sided plate 17 inches wide, widening the strike zone's plate dimension.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Zone-width parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1901-foul-strike-rule-nl",
    "year": 1901,
    "league": "NL",
    "name": "Foul-strike rule (NL)",
    "what_changed": "Rule 44 Sec 3: a foul ball not caught on the fly is a strike unless two strikes are already on the batter. Before this, fouls (other than bunts, foul tips and obvious foul attempts) had no count effect.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "NL BA .279 (1900) -> .267 (1901); NL total runs fell by roughly 800 in one season; NL runs per team-game ~5.2 -> ~4.6. Combined with the AL's 1903 adoption this is the principal engine of the dead-ball era.",
    "model_note": "K-rate up, BA down - a direct plate-outcome distribution change.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1903-foul-strike-rule-al",
    "year": 1903,
    "league": "AL",
    "name": "Foul-strike rule (AL)",
    "what_changed": "The AL added the same provision two years after the NL, completing the change across MLB.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "AL BA .275 (1902) -> .255 (1903); AL runs per team-game ~4.9 -> ~3.9 (Baseball-Reference AL totals).",
    "model_note": "Same as the 1901 NL row, applied to the AL two seasons later.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1903-mound-height-capped-at-15-inches",
    "year": 1903,
    "league": "MLB",
    "name": "Mound height capped at 15 inches",
    "what_changed": "Rule 1 Sec 2 first put a maximum mound height in the book at 15 inches above the baseline. Restated as a maximum in 1949 and as an exact requirement in the 1950 rewrite.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified (a ceiling on existing practice, not a change to it)",
    "model_note": "Only as a park-level pitcher-advantage parameter. NOTE: the commonly repeated '1925 mound cap' claim is not supported by the rule books.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1903-national-agreement-first-modern-world-se",
    "year": 1903,
    "league": "MLB",
    "name": "National Agreement; first modern World Series",
    "what_changed": "The AL and NL made peace, ended roster raiding, and staged the first modern World Series (Boston over Pittsburgh).",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: structural/postseason, not a playing rule.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1904-minimum-fence-and-grandstand-distances",
    "year": 1904,
    "league": "MLB",
    "name": "Minimum fence and grandstand distances",
    "what_changed": "Rule 1 set a 235-foot minimum from home to any fence or stand in fair territory and 90 feet to the grandstand.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Park-geometry parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1908-sacrifice-fly-run-scoring-fly-created",
    "year": 1908,
    "league": "MLB",
    "name": "Sacrifice fly (run-scoring fly) created",
    "what_changed": "Rule 85 Sec 5(a) credited a sacrifice hit, with no at-bat charged, to a batter whose caught fly ball scored a run with fewer than two out. Extended in 1909 to muffed flies that would have scored a run.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "The NL's official records showed about 250 such plays in 1908 (league president Harry Pulliam believed 40 more went unrecorded).",
    "model_note": "Scoring convention: removes an at-bat, raising BA slightly. Does not change play outcomes.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1910-cork-center-baseball",
    "year": 1910,
    "league": "MLB",
    "name": "Cork-center baseball",
    "what_changed": "The rubber-center ball was replaced by a cork-center ball (used in the 1910 World Series, universal in 1911), which travelled farther off the bat.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "AL BA .243 (1910) -> .273 (1911), a 30-point jump; NL BA .256 -> .260. MLB runs per team-game ~3.6 (1910) -> ~4.5 (1911), then decayed back to ~3.7 by 1914 as pitchers adapted.",
    "model_note": "Global offense scalar; note the effect largely reversed within three seasons.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1920-spitball-and-all-doctored-pitches-banned",
    "year": 1920,
    "league": "MLB",
    "name": "Spitball and all doctored pitches banned",
    "what_changed": "Rule 30 Sec 2 barred applying any foreign substance, expectorating on ball or glove, rubbing or defacing the ball, and the shine/spit/mud/emery ball, with automatic ejection and a ten-day suspension. Seventeen incumbent spitballers were grandfathered for the rest of their careers (the last, Burleigh Grimes, pitched to 1934).",
    "category": "PLATE_OUTCOME",
    "measured_effect": "Cannot be separated from the clean-ball rule adopted the same season - see that row. Combined 1919-1921: MLB BA .263 -> .276 -> .291; slugging .340 (1919) -> .461 (1921), a ~40% rise.",
    "model_note": "Global pitcher-effectiveness parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1920-clean-ball-rule-dead-ball-live-ball-brea",
    "year": 1920,
    "league": "MLB",
    "name": "Clean-ball rule (dead-ball / live-ball break)",
    "what_changed": "Rule 14 Sec 4 required discolored or damaged balls to be removed, and after Ray Chapman was killed by a pitch in August 1920 umpires were directed to replace the ball frequently, ending the practice of playing a whole game with one scuffed, tobacco-stained ball.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "MLB home runs 448 (1919) -> 631 (1920) -> 937 (1921), +109% in two years. MLB BA .263 -> .276 -> .291. MLB slugging .340 (1919) -> .461 (1921). The single largest regime change in the run environment.",
    "model_note": "Global HR/BA/SLG scalars; the canonical era boundary for a simulator.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1920-rbi-made-an-official-statistic",
    "year": 1920,
    "league": "MLB",
    "name": "RBI made an official statistic",
    "what_changed": "Runs batted in were formally defined and required in the official scoring rules.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "Derived statistic only.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1920-all-runs-count-on-a-game-ending-home-run",
    "year": 1920,
    "league": "MLB",
    "name": "All runs count on a game-ending home run",
    "what_changed": "Rule 22 Sec 2: when a walk-off home run leaves the park, every runner plus the batter scores, instead of the game ending the instant the winning run crossed. This is why some pre-1920 walk-off homers are recorded as singles or triples.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "unquantified (a handful of plays per decade)",
    "model_note": "Walk-off scoring convention; easy to implement.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "A"
  },
  {
    "id": "1920-tag-up-allowed-at-first-touch",
    "year": 1920,
    "league": "MLB",
    "name": "Tag-up allowed at first touch",
    "what_changed": "Rule 56 Sec 10: a runner may leave his base the moment the fly ball touches the fielder's hands, ending the tactic of juggling the ball while running in to freeze the runner.",
    "category": "BASERUNNING",
    "measured_effect": "unquantified",
    "model_note": "Directly relevant to a tag-up/advancement model; matches the project's existing tGo semantics.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1925-cushioned-cork-center-ball",
    "year": 1925,
    "league": "MLB",
    "name": "Cushioned cork-center ball",
    "what_changed": "A cushioned cork center (a layer of rubber between cork and yarn) was introduced, further livening the ball.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "MLB BA .292 (1925) vs .285 (1924); NL runs per team-game ~4.9 (1924) -> ~5.1 (1925). Small and contested.",
    "model_note": "Minor offense scalar.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "low",
    "single_source": true,
    "tier": "B"
  },
  {
    "id": "1926-minimum-home-run-distance-raised-to-250-",
    "year": 1926,
    "league": "MLB",
    "name": "Minimum home-run distance raised to 250 ft",
    "what_changed": "Balls leaving the field closer than 250 feet count as two bases. Still in the book as Rule 5.05(a)(5).",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Park-geometry HR-to-2B rule; directly relevant to any sim with configurable field size.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1926-sacrifice-fly-widened-to-any-advancement",
    "year": 1926,
    "league": "MLB",
    "name": "Sacrifice fly widened to any advancement",
    "what_changed": "Rule 85 Sec 5 credited a sacrifice on a fly ball that advanced any runner, not only one that scored. Repealed after 1930.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "Scoring convention affecting AB denominator, 1926-1930 only.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1930-bounce-home-run-eliminated-ground-rule-d",
    "year": 1930,
    "league": "AL (NL 1931)",
    "name": "Bounce home run eliminated (ground-rule double)",
    "what_changed": "A fair ball that bounds into the stands or over the fence became a two-base hit rather than a home run. The AL had the rule first; the NL joined in 1931 with Rule 41 Sec 3, making it the first universal ground rule.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "Contemporary reporting claimed 12 of Hack Wilson's record 56 NL home runs in 1930 were bounce homers (The Sporting News, 18 Dec 1930), i.e. roughly 20% of one season's leader total. League-wide effect not separately published and confounded with the 1931 deadened ball.",
    "model_note": "Direct HR-to-2B reassignment - a clean per-PA outcome remap.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1931-deadened-baseball-thicker-cover-raised-s",
    "year": 1931,
    "league": "MLB",
    "name": "Deadened baseball (thicker cover, raised seams)",
    "what_changed": "After the 1930 offensive explosion the ball was given a thicker cover and more prominent stitching, reducing carry and improving pitcher grip.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "NL BA .303 (1930) -> .277 (1931); NL runs per team-game 5.68 -> 4.48, a 21% drop in one season. AL fell less (BA .288 -> .278).",
    "model_note": "Global offense scalar; one of the largest single-season deflations after 1893.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1931-sacrifice-fly-abolished",
    "year": 1931,
    "league": "MLB",
    "name": "Sacrifice fly abolished",
    "what_changed": "The whole sacrifice-on-a-fly-ball provision was deleted (Rule 70 Sec 6). A batter scoring a runner on a fly got an RBI but was charged an at-bat. Briefly restored for 1939 only, then gone again 1940-1953.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified directly, but this is why on-base percentage cannot be computed before 1954: SF is a term in the OBP denominator and was not recorded 1931-1953 (except 1939).",
    "model_note": "Scoring convention with a hard downstream consequence for derived stats - matches this project's coverage.json OBP-starts-1954 finding.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1931-fair-foul-judged-where-the-ball-crosses-",
    "year": 1931,
    "league": "MLB",
    "name": "Fair/foul judged where the ball crosses the boundary",
    "what_changed": "A batted ball leaving the park is fair or foul according to where it passes over the boundary line of the playing field, not where it disappears from the umpire's view. Tried in 1920, reverted in 1921, NL-only from 1929, universal 1931.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified",
    "model_note": "Affects a small number of fair/foul HR judgments.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1939-sacrifice-fly-restored-for-one-season",
    "year": 1939,
    "league": "MLB",
    "name": "Sacrifice fly restored for one season",
    "what_changed": "Rule 70 Sec 6 again awarded a sacrifice on a fly ball that scored a run (or would have but for an error). Removed again for 1940.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "Single-season scoring convention; 1939 is the one pre-1954 year with SF data.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1939-first-baseman-s-glove-limited",
    "year": 1939,
    "league": "MLB",
    "name": "First baseman's glove limited",
    "what_changed": "Rule 21 capped the first baseman's mitt at 12 in top-to-bottom and 8 in across the palm, ending the unrestricted first-base mitt.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: defensive equipment detail below the resolution of a PA model.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1940-minimum-fair-territory-fence-distance-ra",
    "year": 1940,
    "league": "MLB",
    "name": "Minimum fair-territory fence distance raised to 250 ft",
    "what_changed": "Rule 1 raised the minimum home-to-fence distance in fair territory from 235 to 250 feet.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Park-geometry parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1947-integration-jackie-robinson-not-a-rule-c",
    "year": 1947,
    "league": "MLB",
    "name": "Integration (Jackie Robinson) - NOT a rule change",
    "what_changed": "Jackie Robinson debuted for Brooklyn on 15 April 1947, breaking the unwritten colour line. There was never a written rule barring Black players, so there is no rule text to cite; it was a tacit agreement among owners.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified as a rule effect. Talent-pool studies attribute a sizeable share of post-1947 quality-of-play improvement to integration, but no single before/after league rate is attributable.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: a talent-pool change, not a rule. FLAGGED per request.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1950-rulebook-reorganized-strike-zone-defined",
    "year": 1950,
    "league": "MLB",
    "name": "Rulebook reorganized; strike zone defined as armpits to top of knees",
    "what_changed": "The code was cut from ~70 numbered rules to 10 and renumbered (1.00-10.00). Rule 2.63 defined the strike zone as the space over home plate between the batter's armpits and the top of his knees in his natural stance - the first modern definition. Mound height also became an exact 15 inches rather than a maximum.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "unquantified as a distinct step (the 1950 text largely codified 1949 practice); MLB BA .263 (1949) -> .266 (1950).",
    "model_note": "Zone-size parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1954-sacrifice-fly-reinstated-permanently",
    "year": 1954,
    "league": "MLB",
    "name": "Sacrifice fly reinstated (permanently)",
    "what_changed": "Rule 10.06(a) again exempted a batter from an at-bat on a fair fly caught with fewer than two out that scored a runner. 'Fair' was dropped in 1961; an infielder-in-the-outfield catch was added in 1975.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "Adopted explicitly to raise batting averages - the rules committee cited the 'alarming attrition' of .300 hitters (The Sporting News, 18 Nov 1953). MLB BA .253 (1953 NL .266/AL .262) -> 1954 NL .265/AL .257; the SF exemption is worth roughly 2-4 points of BA to a regular. This is the year OBP becomes computable.",
    "model_note": "Scoring convention; the hard boundary for OBP availability in any historical data spine.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1957-protective-cap-liners-required",
    "year": 1957,
    "league": "NL (AL 1958)",
    "name": "Protective cap liners required",
    "what_changed": "The NL required batters to wear a protective liner in the cap in 1957; the AL followed in 1958. Precursor to the 1971 helmet rule.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: safety equipment, no outcome distribution change. NOTE: corrects the common '1939 helmet' claim.",
    "modelable_per_pa": "no",
    "confidence_year": "medium",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1959-minimum-outfield-dimensions-325-400-ft",
    "year": 1959,
    "league": "MLB",
    "name": "Minimum outfield dimensions 325 / 400 ft",
    "what_changed": "A note to Rule 1.04 required any field built after 1 June 1958 to have at least 325 feet down each foul line and 400 to center, and barred remodelling existing parks below those figures. Prompted by the Los Angeles Coliseum's ~250-foot left-field screen. Many exemptions have since been granted.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified league-wide. Park-level: the 1958-61 Coliseum's short screen produced extreme HR splits for the Dodgers before they moved to Dodger Stadium.",
    "model_note": "Park-geometry constraint - directly relevant to this project's configurable field size.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1961-expansion-and-the-162-game-schedule",
    "year": 1961,
    "league": "AL (NL 1962)",
    "name": "Expansion and the 162-game schedule",
    "what_changed": "The AL went to 10 teams and a 162-game schedule in 1961; the NL followed in 1962. The 154-game schedule ended.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "AL HR per team-game 0.86 (1960) -> 1.16 (1961), +35%, widely attributed to diluted expansion pitching (Maris's 61 HR came this year). AL BA .255 -> .256.",
    "model_note": "Schedule length is trivially modelable; the talent-dilution effect is not a rule and must be applied as an era parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1963-strike-zone-enlarged-shoulders-to-knees",
    "year": 1963,
    "league": "MLB",
    "name": "Strike zone enlarged (shoulders to knees)",
    "what_changed": "Rule 2.00 changed the zone from 'armpits to top of knees' to 'top of the shoulders to the knees', adding several inches top and bottom.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "MLB runs per team-game 4.46 (1962) -> 3.95 (1963), -11% in one year. NL 4.48 -> 3.81; AL 4.44 -> 4.08. MLB BA .258 -> .246. Strikeouts rose and walks fell for six straight years, bottoming at the 1968 'Year of the Pitcher'.",
    "model_note": "Clean zone-size -> BB/K/BA parameter change.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1965-amateur-free-agent-draft",
    "year": 1965,
    "league": "MLB",
    "name": "Amateur free-agent draft",
    "what_changed": "Replaced open bidding for amateurs with a reverse-order draft.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: talent allocation.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1965-catcher-s-mitt-size-limited",
    "year": 1965,
    "league": "MLB",
    "name": "Catcher's mitt size limited",
    "what_changed": "Rule 1.12 capped the catcher's mitt at 38 inches in circumference and 15.5 inches top-to-bottom, replacing 'any size, shape or weight'. Prompted by the oversized mitts used for knuckleballers.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA (passed-ball rates only).",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1967-mound-visits-first-limited",
    "year": 1967,
    "league": "MLB",
    "name": "Mound visits first limited",
    "what_changed": "Rule 8.06 limited a manager or coach to one mound visit per inning per pitcher (a second required removing the pitcher) and forbade a second visit to the same pitcher with the same batter up.",
    "category": "PACE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: pace/management, no outcome distribution effect.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1968-25-man-active-roster-from-opening-day",
    "year": 1968,
    "league": "MLB",
    "name": "25-man active roster from Opening Day",
    "what_changed": "Teams could no longer open with a larger roster and cut down a month in; the 25-man limit applied from day one (in 1967 the limits were 28 then 25).",
    "category": "LINEUP",
    "measured_effect": "unquantified",
    "model_note": "Matters only to a sim with roster/bullpen management.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1969-mound-lowered-15-in-10-in",
    "year": 1969,
    "league": "MLB",
    "name": "Mound lowered 15 in -> 10 in",
    "what_changed": "Rule 1.04: the pitcher's plate shall be ten inches above home plate, with a uniform 1-inch-per-foot slope beginning 6 inches in front of the rubber. Adopted in direct response to 1968.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "MLB runs per team-game 3.42 (1968) -> 4.07 (1969), +19%. MLB BA .237 -> .248. MLB ERA 2.98 -> 3.61. HR per team-game ~0.61 -> ~0.80. Confounded with the same-year strike-zone shrink and a four-team expansion.",
    "model_note": "Global offense scalar; the canonical modern era boundary.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1969-strike-zone-shrunk-back-to-armpits-top-o",
    "year": 1969,
    "league": "MLB",
    "name": "Strike zone shrunk back to armpits / top of knees",
    "what_changed": "Rule 2.00 reverted the 1963 enlargement, restoring the armpits-to-top-of-knees zone.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "Not separable from the mound change - same season. Walk rate rose to 9.1% and K rate fell in 1969 relative to 1968.",
    "model_note": "Zone-size parameter; in practice bundle with the 1969 mound row.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1969-divisional-play-lcs-expansion-to-24-team",
    "year": 1969,
    "league": "MLB",
    "name": "Divisional play, LCS, expansion to 24 teams",
    "what_changed": "Each league split into two divisions with a best-of-five League Championship Series; Montreal, San Diego, Seattle and Kansas City joined.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "Talent dilution from four new clubs contributes an unknown share of the 1969 offensive rebound described above.",
    "model_note": "Postseason structure is outside a PA model; the dilution shows up only as an era parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1969-save-becomes-an-official-statistic",
    "year": 1969,
    "league": "MLB",
    "name": "Save becomes an official statistic",
    "what_changed": "Rule 10.20 created the save for a relief pitcher who enters with his team ahead and holds the lead without earning the win. Definition tightened in 1973 and again in 1975 to the modern three-condition form.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified as an on-field effect, but the statistic is widely credited with driving the ninth-inning closer role that emerged in the 1980s.",
    "model_note": "Derived statistic only.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1971-batting-helmets-mandatory",
    "year": 1971,
    "league": "MLB",
    "name": "Batting helmets mandatory",
    "what_changed": "Rule 1.16 required all players to wear some type of protective helmet while at bat. Single ear-flap helmets became mandatory for players entering MLB from 1973, with a grandfather clause for 1982 veterans; catchers' helmets were added in 1988.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: safety equipment. Some analysts argue helmets let batters crowd the plate and raised HBP rates, but no clean before/after number exists.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1973-designated-hitter",
    "year": 1973,
    "league": "AL only",
    "name": "Designated hitter",
    "what_changed": "The AL allowed a designated hitter to bat for the pitcher without the pitcher leaving the game. Experimental in 1973, written into the book as Rule 6.10 in 1976 as an 'optional' rule adoptable by majority vote.",
    "category": "LINEUP",
    "measured_effect": "AL runs per team-game 3.47 (1972) -> 4.28 (1973), +23%, the highest since 1962. AL BA .239 -> .259, +20 points. The NL, unchanged, went 3.91 -> 4.15 the same year, so roughly 0.6 R/G is attributable to the DH.",
    "model_note": "Replaces the worst hitter in the lineup - directly representable as a lineup-slot substitution.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "A"
  },
  {
    "id": "1975-free-agency-messersmith-mcnally-arbitrat",
    "year": 1975,
    "league": "MLB",
    "name": "Free agency (Messersmith / McNally arbitration)",
    "what_changed": "Arbitrator Peter Seitz ruled on 23 December 1975 that the reserve clause bound a player for only one option year, voiding perpetual reservation. The 1976 Basic Agreement created six-year free agency.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified as an on-field rate. Average MLB salary rose from about $45,000 (1975) to $143,000 (1980), roughly a 3x increase in five years.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: labor rule affecting roster construction only.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1975-cupped-bats-permitted",
    "year": 1975,
    "league": "MLB",
    "name": "Cupped bats permitted",
    "what_changed": "Rule 1.10(c)(3) allowed a cup-shaped indentation in the bat's end, letting hitters use a longer bat at the same weight.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "At most a marginal bat-speed effect.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "1984-pine-tar-penalty-removed-george-brett-ru",
    "year": 1984,
    "league": "MLB",
    "name": "Pine-tar penalty removed (George Brett rule)",
    "what_changed": "After the 24 July 1983 Brett home run was nullified and then restored on appeal, the 1984 rules dropped 'illegally batted ball' from the definitions and from Rule 6.06, so excessive pine tar means the bat is removed from the game but the batter is not out.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified (one famous play)",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: an equipment-enforcement edge case.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1988-strike-zone-redefined-midpoint-of-should",
    "year": 1988,
    "league": "MLB",
    "name": "Strike zone redefined (midpoint of shoulders and belt)",
    "what_changed": "The upper limit became a horizontal line at the midpoint between the top of the shoulders and the top of the uniform pants; the lower limit stayed at the top of the knees. This lowered the written top of the zone substantially.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "MLB runs per team-game 4.32 (1987) -> 4.14 (1988) -> 4.13 (1989); MLB BA .261 -> .254. The 1987 spike is usually blamed on a lively ball, so the 1988 decline is partly a reversion, not purely a zone effect.",
    "model_note": "Zone-size parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1993-expansion-to-28-teams-colorado-florida",
    "year": 1993,
    "league": "MLB",
    "name": "Expansion to 28 teams (Colorado, Florida)",
    "what_changed": "Two new NL clubs; Coors Field's predecessor Mile High Stadium and then Coors Field introduced an extreme altitude park.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "MLB runs per team-game 4.12 (1992) -> 4.60 (1993), +12%, generally attributed to expansion dilution plus Colorado's altitude.",
    "model_note": "Not a playing rule; era/park parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1994-three-divisions-per-league-plus-a-wild-c",
    "year": 1994,
    "league": "MLB",
    "name": "Three divisions per league plus a wild card",
    "what_changed": "Each league split into East/Central/West with an added Division Series round and one wild-card qualifier. First played in 1995 because of the strike.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: postseason structure.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1994-players-strike-1994-world-series-cancell",
    "year": 1994,
    "league": "MLB",
    "name": "Players' strike; 1994 World Series cancelled",
    "what_changed": "The strike began 12 August 1994 and ran to 2 April 1995, wiping out the last ~50 games and the postseason; 1995 was shortened to 144 games. Replacement players were used in spring 1995.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "1994 seasons are truncated at ~113-117 team games; 1995 at 144. Any per-season counting stat for 1994-95 must be rate-adjusted.",
    "model_note": "Schedule-length artifact - important for a data spine, not for plate outcomes.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1996-strike-zone-lower-limit-to-the-hollow-be",
    "year": 1996,
    "league": "MLB",
    "name": "Strike zone lower limit to the hollow beneath the kneecap",
    "what_changed": "The bottom of the zone dropped from the top of the knees to the hollow beneath the kneecap, with the 1988 upper limit retained.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "MLB runs per team-game 4.63 (1995) -> 5.04 (1996), the highest since 1936 - but 1996 also sits inside the offensive surge attributed to the ball and to PEDs, so the zone change is not separable.",
    "model_note": "Zone-size parameter.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "1997-regular-season-interleague-play",
    "year": 1997,
    "league": "MLB",
    "name": "Regular-season interleague play",
    "what_changed": "AL and NL clubs played each other in the regular season for the first time; the home team's league rules governed the DH.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "unquantified",
    "model_note": "Scheduling; only matters if the sim switches DH rules by venue.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "1998-expansion-to-30-teams-arizona-tampa-bay",
    "year": 1998,
    "league": "MLB",
    "name": "Expansion to 30 teams (Arizona, Tampa Bay)",
    "what_changed": "Two new clubs; Milwaukee moved from the AL to the NL, giving 16 NL / 14 AL until 2013.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "MLB runs per team-game 4.77 (1997) -> 4.79 (1998); the expansion effect is small relative to the ongoing offensive era.",
    "model_note": "Era parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2001-questec-strike-zone-enforcement-higher-z",
    "year": 2001,
    "league": "MLB",
    "name": "QuesTec strike-zone enforcement; 'higher' zone directive",
    "what_changed": "MLB directed umpires to call the rulebook zone - notably the upper portion that had drifted out of use - and installed the QuesTec Umpire Information System in selected parks to grade ball/strike accuracy. Replaced by Zone Evaluation (PITCHf/x) in 2009.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "MLB runs per team-game 5.14 (2000) -> 4.78 (2001), -7%; MLB walks per team-game 3.76 -> 3.31, -12%; strikeouts per team-game 6.45 -> 6.68. The walk drop is the cleanest signal of a taller enforced zone.",
    "model_note": "Effective-zone parameter driving BB/K.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2004-steroid-testing-with-penalties-begins-to",
    "year": 2004,
    "league": "MLB",
    "name": "Steroid testing with penalties begins (toughened 2005)",
    "what_changed": "Anonymous survey testing ran in 2003; testing with penalties began in 2004, and in 2005 penalties were sharply raised (50 games / 100 games / lifetime from 2006; amphetamines added 2006).",
    "category": "ADMINISTRATIVE",
    "measured_effect": "MLB home runs per team-game 1.12 (2000) -> 1.06 (2004) -> 1.03 (2005) -> 0.86 (2010-2014 average, bottoming at 0.86 in 2014). MLB runs per team-game 5.14 (2000) -> 4.07 (2014). Attribution to testing specifically is contested and confounded with the enforced strike zone and rising strikeout rates.",
    "model_note": "Only as a slow-moving era parameter on HR rate.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2008-instant-replay-for-home-run-boundary-cal",
    "year": 2008,
    "league": "MLB",
    "name": "Instant replay for home-run boundary calls",
    "what_changed": "From 28 August 2008 umpires could use video to decide whether a ball cleared the fence, was fair or foul, or was subject to spectator interference. No other plays were reviewable.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified (a few dozen reviews per season)",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: an officiating-accuracy mechanism.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2010-bat-diameter-reduced-to-2-61-in",
    "year": 2010,
    "league": "MLB",
    "name": "Bat diameter reduced to 2.61 in",
    "what_changed": "Rule 1.10(a) cut the maximum diameter of the bat's thickest part from 2.75 to 2.61 inches.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "Marginal contact-quality parameter.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "2012-second-wild-card-and-the-wild-card-game",
    "year": 2012,
    "league": "MLB",
    "name": "Second wild card and the wild-card game",
    "what_changed": "Each league added a second wild card, with the two meeting in a single elimination game.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: postseason structure.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2013-glove-size-limits-raised-to-13-in",
    "year": 2013,
    "league": "MLB",
    "name": "Glove size limits raised to 13 in",
    "what_changed": "Rules 3.05/3.06 raised the maximum first baseman's mitt and fielder's glove to 13 inches top-to-bottom.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "2014-expanded-replay-with-manager-challenges",
    "year": 2014,
    "league": "MLB",
    "name": "Expanded replay with manager challenges",
    "what_changed": "Managers got challenges (one, plus a second if the first succeeded; crew chiefs could initiate from the 7th inning) over most calls other than balls and strikes. The decision window was cut from 30 to 20 seconds in 2020 and to a 15-second 'manager hold' clock in 2023.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "Roughly 1,300-1,500 reviews per season with an overturn rate around 45-50%; average review time fell from ~1:50 (2014) to ~1:15-1:30 by 2019.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: officiating accuracy and game length only.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "low",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2014-home-plate-collision-rule-rule-7-13-pose",
    "year": 2014,
    "league": "MLB",
    "name": "Home-plate collision rule (Rule 7.13, 'Posey rule')",
    "what_changed": "A runner may not deviate from his path to initiate contact with the catcher, and the catcher may not block the plate without possession of the ball. Violations award the plate or the out. Reviewable by replay.",
    "category": "BASERUNNING",
    "measured_effect": "unquantified as a run-scoring rate; catcher injury frequency at the plate fell sharply but no published before/after rate was found.",
    "model_note": "A sim with base-to-base advancement can bias close plays at home slightly toward the runner, but the rule is fundamentally about contact geometry, which is outside the model.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2014-transfer-rule-interpretation-imposed-and",
    "year": 2014,
    "league": "MLB",
    "name": "Transfer-rule interpretation (imposed and withdrawn in-season)",
    "what_changed": "A new umpire-manual note required the fielder to secure the ball in the throwing hand for a catch to count, invalidating many glove-to-hand transfers. Widely criticized and reverted to the prior standard on 25 April 2014.",
    "category": "FIELDING",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA; also lasted under four weeks.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "2015-batter-s-box-rule-and-between-innings-cl",
    "year": 2015,
    "league": "MLB",
    "name": "Batter's-box rule and between-innings clocks; rulebook renumbered",
    "what_changed": "The batter had to keep one foot in the box between pitches with listed exceptions, and visible between-innings timers (2:25 local / 2:45 national) were installed. The rulebook was reorganized into nine rules with definitions moved to the end.",
    "category": "PACE",
    "measured_effect": "MLB average nine-inning game time 3:02 (2014) -> 2:56 (2015), then back to 3:00 (2016) and 3:05 (2017) - the gain was fully reversed within two years.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: pure pace.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2016-slide-rule-at-second-base-neighborhood-p",
    "year": 2016,
    "league": "MLB",
    "name": "Slide rule at second base; neighborhood play made reviewable",
    "what_changed": "Rule 6.01(j) required a bona fide slide (begin before the base, be able to reach it, not change path to contact the fielder) on force plays; a violation calls the batter-runner out too. The 'neighborhood play' exemption at second base became subject to replay review.",
    "category": "BASERUNNING",
    "measured_effect": "unquantified league-wide; middle-infielder injuries on takeout slides fell and a small number of double plays per season are awarded or negated under the rule.",
    "model_note": "A sim with force-play resolution can shift double-play conversion slightly; the slide geometry itself is not modelable.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2017-no-pitch-intentional-walk",
    "year": 2017,
    "league": "MLB",
    "name": "No-pitch intentional walk",
    "what_changed": "A manager signals the intentional walk from the dugout and the batter is awarded first base without four pitches being thrown.",
    "category": "PACE",
    "measured_effect": "About 970 intentional walks per season at roughly four pitches each, saving under a minute per game; MLB average game time still rose from 3:00 (2016) to 3:05 (2017). Side effect: it removes the (rare) wild-pitch and swing-at-a-pitchout outcomes during an IBB.",
    "model_note": "Trivially modelable - it makes the IBB a deterministic outcome with no chance of a passed ball or a hit.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2018-mound-visits-limited-to-six-per-team-per",
    "year": 2018,
    "league": "MLB",
    "name": "Mound visits limited to six per team per nine innings",
    "what_changed": "Rule 5.10(m)(1) capped all mound visits (manager, coach, catcher or infielder) at six per nine innings, plus one per extra inning, with a sign-crossup exception. Cut to five in 2019 and four in 2024.",
    "category": "PACE",
    "measured_effect": "MLB average nine-inning game time 3:05 (2017) -> 3:00 (2018), then back to 3:05 (2019).",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: pace only.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2019-single-31-july-trade-deadline-august-wai",
    "year": 2019,
    "league": "MLB",
    "name": "Single 31 July trade deadline; August waiver trades abolished",
    "what_changed": "The August revocable-waiver trade window was eliminated, making 31 July a hard deadline.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: roster transactions.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2020-three-batter-minimum-for-pitchers",
    "year": 2020,
    "league": "MLB",
    "name": "Three-batter minimum for pitchers",
    "what_changed": "Rule 5.10(g): a pitcher must face at least three batters or finish the half-inning, barring injury. In force in the minors from 2019.",
    "category": "LINEUP",
    "measured_effect": "In 2019 there were 649 relief appearances that the rule would have made illegal. One-batter appearances fell to roughly half their prior frequency. Left-handed relievers are used later in games less often, though per-batter effectiveness was unchanged (Smith, Retrosheet).",
    "model_note": "Representable only in a sim with bullpen management and platoon matchups; it has no direct effect on a single PA's outcome distribution.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2020-26-man-roster-13-pitcher-limit-two-way-p",
    "year": 2020,
    "league": "MLB",
    "name": "26-man roster, 13-pitcher limit, two-way player designation",
    "what_changed": "The active roster went from 25 to 26 (28 in September, down from 40), each club must declare every player a pitcher, position player or Two-Way Player, and pitcher counts were capped (13 through August, 14 after). Position players may pitch only in extra innings or lopsided games. The pitcher cap's enforcement was delayed by the pandemic; thresholds were tightened in 2023 (behind by 8+, or leading by 10+ in the 9th).",
    "category": "LINEUP",
    "measured_effect": "unquantified",
    "model_note": "Roster construction; only relevant to a sim that manages a bullpen.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2020-automatic-runner-on-second-base-in-extra",
    "year": 2020,
    "league": "MLB",
    "name": "Automatic runner on second base in extra innings",
    "what_changed": "Each half-inning from the 10th starts with a runner on second - the player who made the last out of the previous inning (or the preceding batter if that was the pitcher). Introduced for the pandemic season, retained 2021-2022, made permanent as Rule 7.01(b)(2) in 2023. Not used in the postseason.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "Share of extra-inning games ending in the 10th: 43.7% (2012-2017) -> 75% (2020). Average extra-inning game length 11.3 innings (2019) -> 10.3 innings (2021). About 208 extra-inning games in 2019 produced 113 that reached the 11th; under the rule that tail is roughly quartered.",
    "model_note": "Fully modelable in a base-state sim: initialize the extra half-inning with a runner on second and one identified batter. Distorts any per-inning run-distribution statistic, so exclude extra innings when measuring run variance.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "A"
  },
  {
    "id": "2020-seven-inning-doubleheader-games-2020-202",
    "year": 2020,
    "league": "MLB",
    "name": "Seven-inning doubleheader games (2020-2021 only)",
    "what_changed": "Both games of a doubleheader were scheduled for seven innings. Never entered the MLB rule book; discontinued after 2021 (the minors kept the option).",
    "category": "GAME_STRUCTURE",
    "measured_effect": "Distorts 2020-21 per-game counting stats: affected games have ~78% of a normal game's plate appearances.",
    "model_note": "Game-length parameter; important for any game-grain dataset covering 2020-21.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "A"
  },
  {
    "id": "2020-covid-season-60-games-universal-dh-for-o",
    "year": 2020,
    "league": "MLB",
    "name": "COVID season: 60 games, universal DH for one year, 16-team playoff",
    "what_changed": "The 2020 season was cut to 60 games starting in late July, the DH was used in both leagues for that year only (the NL reverted in 2021), and the postseason expanded to 16 teams.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "2020 team games: 58-60 vs 162. Every 2020 counting stat is ~37% of a normal season and its rate stats carry ~2.7x the usual sampling noise.",
    "model_note": "Schedule-length artifact; 2020 must be excluded or rate-adjusted in any year-over-year series.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2021-mid-season-foreign-substance-sticky-stuf",
    "year": 2021,
    "league": "MLB",
    "name": "Mid-season foreign-substance (sticky stuff) enforcement",
    "what_changed": "From 21 June 2021 umpires performed mandatory checks of pitchers for grip-enhancing substances, with automatic 10-game suspensions. The rule text (6.02(c)) was unchanged; the enforcement was new.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "League four-seam fastball spin rate fell from about 2,329 rpm in April-May 2021 to about 2,226 rpm after enforcement (-4.4%). MLB batting average rose from .236 in the first half to about .247 in the second half of 2021, and the league strikeout rate fell about one percentage point.",
    "model_note": "Mid-season K-rate / BA parameter shift - awkward because it splits a single season.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2021-deadened-baseball",
    "year": 2021,
    "league": "MLB",
    "name": "Deadened baseball",
    "what_changed": "MLB directed Rawlings to loosen the ball's winding, reducing weight slightly and cutting carry on well-struck balls.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "MLB home runs per team-game 1.39 (2019, an all-time high) -> 1.28 (2020) -> 1.22 (2021) -> 1.07 (2022). MLB runs per team-game 4.83 (2019) -> 4.53 (2021) -> 4.28 (2022).",
    "model_note": "Global HR-rate scalar. Ball specification changes are not formal rule changes and are poorly documented year to year.",
    "modelable_per_pa": "yes",
    "confidence_year": "medium",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2022-universal-designated-hitter",
    "year": 2022,
    "league": "MLB (universal)",
    "name": "Universal designated hitter",
    "what_changed": "Rule 5.11(b) required the DH in both leagues, ending pitchers batting. It also allows a starting pitcher to remain as DH after leaving the mound (the 'Ohtani rule').",
    "category": "LINEUP",
    "measured_effect": "NL pitchers hit .110/.149/.140 with a 44.1% strikeout rate in 2021, about 5% of NL plate appearances; NL DHs hit .238/.316/.402 in 2022. Despite that, NL runs per game FELL from 4.46 (2021) to 4.34 (2022) and NL OBP from .318 to .314, because the deadened ball and a league-wide offensive decline swamped the DH gain. A much smaller effect than the AL's 1973 adoption.",
    "model_note": "Lineup-slot substitution; the cleanest per-PA rule in the modern set.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "A"
  },
  {
    "id": "2022-draft-lottery-12-team-playoff-no-tiebrea",
    "year": 2022,
    "league": "MLB",
    "name": "Draft lottery, 12-team playoff, no tiebreaker games",
    "what_changed": "The 2022 CBA created a six-team draft lottery, expanded the postseason to 12 teams, and eliminated one-game tiebreakers - ties are now broken by head-to-head record and a cascade of criteria.",
    "category": "ADMINISTRATIVE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA. Note for data work: from 2022 no team can play a 163rd regular-season game.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2023-pitch-timer",
    "year": 2023,
    "league": "MLB",
    "name": "Pitch timer",
    "what_changed": "15 seconds with the bases empty and 20 seconds with runners on (18 from 2024); 30 seconds between batters; the batter must be alert in the box with 8 seconds left. Pitcher violation = automatic ball, batter violation = automatic strike. Inning-break and pitching-change limits were also fixed.",
    "category": "PACE",
    "measured_effect": "MLB average nine-inning game time 3:04 (2022) -> 2:40 (2023), a 24-minute (13%) drop and the largest single-season change on record; 2:36 in 2024 (lowest since 1984's 2:35) and 2:38 in 2025. Offensive effect was small: MLB BA .243 (2022) -> .248 (2023), most of which is attributed to the shift ban.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA for its main effect (elapsed time). The automatic ball/strike penalties are real plate outcomes but occur in well under 1% of plate appearances.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2023-defensive-shift-restrictions",
    "year": 2023,
    "league": "MLB",
    "name": "Defensive shift restrictions",
    "what_changed": "Rule 5.02(c) requires two infielders on each side of second base, all four with both feet on the infield dirt at the time of the pitch. A violation gives the batter a ball (or the batting team may take the play instead). From 2025, if a violating infielder is first to touch the ball the batter is awarded first base and all runners advance one base.",
    "category": "FIELDING",
    "measured_effect": "MLB BA .243 (2022) -> .248 (2023), +5 points; MLB BABIP .290 -> .297, +7 points. Left-handed hitters gained about 10 points of both BA and BABIP (overall LHB BABIP .283 -> .295), with BABIP on pulled ground balls +35 points and on pulled line drives +27 points. A difference-in-differences study (arXiv 2411.15075) isolates roughly +9 points of BABIP and OBP for left-handed batters. Context: shifts were used in 38% of all PA in 2022, 62% against LHB.",
    "model_note": "Directly representable as a handedness-dependent BABIP adjustment.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2023-larger-bases-15-in-18-in",
    "year": 2023,
    "league": "MLB",
    "name": "Larger bases (15 in -> 18 in)",
    "what_changed": "Rule 2.03 / Appendix 2 enlarged first, second and third base from 15 to 18 inches square, cutting the first-to-second distance by 4.5 inches and home-to-first by 3 inches.",
    "category": "EQUIPMENT_FIELD",
    "measured_effect": "Combined with the disengagement limit: MLB stolen-base attempts per game 1.4 (2022) -> 1.8 (2023), +29%; success rate 75.4% -> 80.2%, an all-time record. Injuries on base-path plays also fell. The base size alone is not separable from the pickoff limit.",
    "model_note": "Directly representable as SB attempt-rate and success-rate parameters, and as a marginally shorter path in a geometric sim.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2023-pickoff-disengagement-limit",
    "year": 2023,
    "league": "MLB",
    "name": "Pickoff / disengagement limit",
    "what_changed": "A pitcher may step off or throw over twice per plate appearance (the count resets if a runner advances); a third unsuccessful disengagement is a balk and the runner advances.",
    "category": "BASERUNNING",
    "measured_effect": "See the larger-bases row - jointly responsible for SB attempts 1.4 -> 1.8 per game and a 75.4% -> 80.2% success rate in 2022 -> 2023.",
    "model_note": "SB attempt/success parameters; a sim with explicit lead/pickoff states can model it literally.",
    "modelable_per_pa": "yes",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "B"
  },
  {
    "id": "2023-balanced-schedule-every-team-plays-every",
    "year": 2023,
    "league": "MLB",
    "name": "Balanced schedule - every team plays every team",
    "what_changed": "Intradivision games were cut (from 76 to 52) so that all 30 clubs meet every season, with natural-rivalry home-and-home interleague series.",
    "category": "GAME_STRUCTURE",
    "measured_effect": "unquantified",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: scheduling and strength of schedule.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2024-pitch-timer-cut-to-18-seconds-with-runne",
    "year": 2024,
    "league": "MLB",
    "name": "Pitch timer cut to 18 seconds with runners on; mound visits cut to four",
    "what_changed": "The runners-on timer went from 20 to 18 seconds, the clock restarts as soon as the pitcher has the ball whether or not he is on the mound, mound visits fell from five to four per game, and a pinch hitter no longer excuses a returning pitcher from the three-batter minimum. The runner's lane was also widened to include the dirt outside the foul line.",
    "category": "PACE",
    "measured_effect": "MLB average nine-inning game time 2:40 (2023) -> 2:36 (2024), a further 4 minutes and the lowest since 1984 (2:35). Rebounded to 2:38 in 2025.",
    "model_note": "IMPOSSIBLE TO MODEL per-PA: pace. The runner's-lane widening marginally reduces interference calls on close plays at first.",
    "modelable_per_pa": "no",
    "confidence_year": "high",
    "confidence_effect": "high",
    "single_source": false,
    "tier": "C"
  },
  {
    "id": "2025-shift-restriction-penalty-strengthened",
    "year": 2025,
    "league": "MLB",
    "name": "Shift-restriction penalty strengthened",
    "what_changed": "Rule 5.02(c) added that if a violating infielder is the first to touch the ball after the pitch, the batter is awarded first base and every runner advances one base regardless of force state; a comment clarifies that play continues so the manager may elect the play instead.",
    "category": "FIELDING",
    "measured_effect": "unquantified (a very small number of plays per season)",
    "model_note": "Rare penalty outcome; safe to ignore in a rate model.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "n/a",
    "single_source": true,
    "tier": "C"
  },
  {
    "id": "2026-automated-ball-strike-abs-challenge-syst",
    "year": 2026,
    "league": "MLB",
    "name": "Automated Ball-Strike (ABS) challenge system",
    "what_changed": "Announced 23 September 2025 by the Joint Competition Committee and in force for the 2026 regular season. The batter, pitcher or catcher may challenge a ball/strike call by tapping his helmet or cap immediately, unassisted; each team gets two challenges and keeps every successful one. Hawk-Eye adjudicates against a zone whose top is 53% and bottom 27% of the batter's height, measured at a point 8.5 inches behind the front of the plate. Humans still call every pitch; this is not full robot umpiring.",
    "category": "PLATE_OUTCOME",
    "measured_effect": "2026 in-season: through 3 May, 2,160 challenges with 1,145 overturned, a 53% success rate (~1.3 challenges used per team-game). Miscalled strikes on pitches outside the zone fell from 6.69% of such pitches in 2025 to 5.09% in 2026 through 29 April, a 24% reduction in that error class. 2026 spring training: 23 challenges across the first five games (4.6/game), 13 overturned (56.5%).",
    "model_note": "The mechanism (a per-pitch challenge inside a PA) is not representable in a per-PA model. Its net aggregate effect - a small correction of the called zone toward the rulebook zone, worth on the order of a fraction of a walk or strikeout per team-game - can be applied as a tiny BB/K adjustment. Do NOT model it as full ABS: only ~1-2% of pitches are challenged.",
    "modelable_per_pa": "partial",
    "confidence_year": "high",
    "confidence_effect": "medium",
    "single_source": false,
    "tier": "C"
  }
].map(Object.freeze));

  const BY_ID = new Map(CATALOG.map((r) => [r.id, r]));

  const TIERS = Object.freeze({
    A: Object.freeze(CATALOG.filter((r) => r.tier === 'A').map((r) => r.id)),
    B: Object.freeze(CATALOG.filter((r) => r.tier === 'B').map((r) => r.id)),
    C: Object.freeze(CATALOG.filter((r) => r.tier === 'C').map((r) => r.id)),
  });

  function byId(id) { return BY_ID.get(id); }

  // Every rule in force in a given season: adopted that year or earlier.
  // Repeals are their own catalog entries (1931 abolishes the sacrifice
  // fly, 1954 reinstates it), so this is a cumulative list, not a diff.
  function forYear(year) {
    if (!Number.isInteger(year)) throw new TypeError('year must be an integer');
    const active = CATALOG.filter((r) => r.year <= year)
      .sort((a, b) => (a.year - b.year) || (a.id < b.id ? -1 : 1));
    return { year, active };
  }

  const RATE_KEYS = ['bb', 'k', 's1', 'd2', 'd3', 'hr'];

  function identityMods() {
    const m = {};
    for (const k of RATE_KEYS) m[k] = 1;
    return m;
  }

  // Why a rule cannot be simulated, for the UI to show beside it.
  function declinedReason(r) {
    if (r.modelable_per_pa === 'no') {
      return r.model_note || 'not representable in a per-plate-appearance model';
    }
    return 'no quantified effect in the sources; shipped without a rate effect '
      + 'rather than with an invented one';
  }

  // A rate coefficient must be a finite number greater than 0. NaN would
  // multiply a rate to NaN, and every NaN comparison in plateAppearance's
  // event roll is false -- so every plate appearance silently becomes an
  // OUT, with no error anywhere. A negative coefficient is worse: it looks
  // like a normal game while quietly deleting an event type and running the
  // probability accumulator backwards. Zero is excluded for the same
  // reason: a multiplier of 0 deletes the event type outright. Any of the
  // three throws, naming the rule and the rate key, rather than shipping a
  // plausible-looking but corrupted simulation.
  function assertValidCoefficient(rule, key, value) {
    if (!Number.isFinite(value)) {
      throw new RangeError('rule ' + rule.id + ': rate "' + key + '" coefficient must be a '
        + 'finite number (got ' + value + '); NaN/Infinity would silently corrupt every '
        + 'plate appearance');
    }
    if (value <= 0) {
      throw new RangeError('rule ' + rule.id + ': rate "' + key + '" coefficient must be '
        + 'greater than 0 (got ' + value + '); zero would delete the "' + key + '" event '
        + 'type entirely, and a negative value would run the probability accumulator '
        + 'backwards');
    }
  }

  // The pure composition step. Multipliers compose by multiplication, which
  // is associative and commutative -- that is what makes a hand-picked
  // selection independent of the order the rules were selected in. This
  // function must never sort its input: rules-resolve.test.js calls it
  // directly with forward, reversed and shuffled orderings of the same
  // selection and asserts all three land on the same, independently
  // computed product. Sorting here (the way resolve() sorts for display)
  // would make that check pass even if composition were not actually
  // order-independent, which is exactly the gap that let an additive
  // coefficient go untested before this function existed.
  function composeModifiers(ruleList) {
    const modifiers = identityMods();
    const declared = [];
    const structural = {};

    for (const r of ruleList) {
      if (r.tier === 'C') {
        declared.push({ id: r.id, name: r.name, year: r.year, reason: declinedReason(r) });
        continue;
      }
      if (r.tier === 'B' && r.rates) {
        for (const k of RATE_KEYS) {
          if (typeof r.rates[k] !== 'number') continue;
          assertValidCoefficient(r, k, r.rates[k]);
          modifiers[k] *= r.rates[k];
        }
      }
      // Tier A structural settings land here in phase 2.
    }

    return { modifiers, declared, structural };
  }

  function resolve(selection) {
    const sel = selection || {};
    let active;
    if (Array.isArray(sel.ids)) {
      const uniqueIds = Array.from(new Set(sel.ids));
      active = uniqueIds.map((id) => {
        const r = BY_ID.get(id);
        if (!r) throw new Error('unknown rule id: ' + id);
        return r;
      }).sort((a, b) => (a.year - b.year) || (a.id < b.id ? -1 : 1));
    } else {
      active = forYear(sel.year).active;
    }

    const { modifiers, declared, structural } = composeModifiers(active);

    // Phase 1 does not fill either seam: no catalog rule carries a
    // structural setting yet, and no advancement threshold is
    // rule-addressed yet. Both keys are present and empty so sim.js's
    // per-key tunables lookup (which falls back to the historical default
    // for any absent key) and a later phase's structural consumer both see
    // a stable, always-present shape.
    return { ids: active.map((r) => r.id), structural, tunables: {}, modifiers, declared };
  }

  const API = { CATALOG, TIERS, byId, forYear, resolve, composeModifiers, RATE_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MBB_RULES = API;
})(typeof window !== 'undefined' ? window : globalThis);
