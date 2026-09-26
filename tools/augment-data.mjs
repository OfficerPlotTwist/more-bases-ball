/* moreBasesBall — attach the Statcast transport block to the committed data.js.
 *
 *   node tools/augment-data.mjs [--out <path>] [--report]
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `build-data.mjs`
 *
 * `build-data.mjs` REGENERATES data.js from the network. Its eleven shipped
 * values would then come back from a fresh fetch, and 2025 is a season that
 * still takes corrections — so a rebuild can move a plate-appearance total,
 * reorder "the nine batters with the most plate appearances", swap the ninth
 * man, and move every downstream box score without a single field being
 * added. tests/rules-identity.test.js and tests/ngon.test.js index TEAMS[0]
 * and TEAMS[1] positionally; that is a red suite caused by the calendar
 * rather than by the change under test.
 *
 * So this script does not regenerate anything. It is a TEXTUAL append: it
 * reads the committed data.js, finds each `P([...])` literal, keeps the
 * existing element text byte for byte, and appends the new elements after it.
 * The eleven values are never re-serialised, never parsed back out of a float,
 * and never refetched — identity holds BY CONSTRUCTION rather than by luck,
 * which is the whole reason for the shape of this file.
 *
 * A full `build-data.mjs` rebuild remains a separate, deliberate act with its
 * own delta report, exactly as that script's header already demands.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT APPENDS, and the one number that is not measured
 *
 *   mlbam  MLBAM player id — the durable join key data.js has never carried
 *   la     average launch angle, degrees
 *   ev     average exit velocity, mph
 *   oaa    outs above average
 *   arm    max arm strength, mph
 *
 * `xwoba`, `bat_speed` and `swing_len` are deliberately NOT here. The ruling
 * and its reasoning are in docs/superpowers/plans/2026-09-23-statcast-coverage.md:
 * xwoba either duplicates or contradicts the observed rates sim.js already
 * draws from, bat_speed is a second proxy for a quantity `ev` already carries
 * and covers 0 of 270 batters in 2021 and 2022, and swing_len has no surface
 * in a simulator with no pitch location and no swing decision. They stay in
 * the spine, where coverage.json is right to report them.
 *
 * A MISSING VALUE IS WRITTEN `null`, NEVER A LEAGUE MEDIAN. `oaa` and `arm`
 * are absent for a full-time DH because he does not field and does not make
 * qualifying throws — that absence is a real signal, not a data gap, and a
 * median would fabricate a fielder out of a man who never took the field.
 * Fill within a covered season; never fill an uncovered one.
 *
 * THE JOIN IS BY NAME AND PLATE APPEARANCES, NOT BY NAME ALONE.
 * data.js carries no id today, so the name is where the join starts. It is not
 * where it ends: four real collisions exist across the five shipped seasons —
 * Will Smith the catcher and Will Smith the reliever in 2021 and 2023, two
 * Diego Castillos in 2022, two Max Muncys in 2025. Taking the higher-PA row
 * for a bare name is how a catcher inherits a reliever's launch angle, and it
 * would have happened silently.
 *
 * So the join is (name, pa). `pa` is an exact integer from the same Stats API
 * season line data.js was generated from, which makes it a real key rather
 * than a tiebreak heuristic. A name that still resolves to two men after the
 * PA match is REFUSED — that player keeps his eleven values and takes null for
 * all five new ones, and this script names him.
 *
 * Once mlbam is in the file a re-run prefers the id already there and never
 * consults the name at all. That is the point of emitting it: this script
 * should have to solve the Will Smith problem exactly once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSpine } from './lib/spine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data.js');

const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
const OUT = outFlag >= 0 ? path.resolve(argv[outFlag + 1]) : SRC;
const REPORT_ONLY = argv.includes('--report');

/* The eleven values data.js has always shipped. Everything at or past this
 * index is transport this script owns and may rewrite; everything before it is
 * untouchable text. */
const SHIPPED = 11;
const I_MLBAM = 11;

const NL = fs.readFileSync(SRC, 'utf8').includes('\r\n') ? '\r\n' : '\n';
const src = fs.readFileSync(SRC, 'utf8');

const YEAR_RE = /^ {4}(\d{4}): \[/;
const PLAYER_RE = /^(\s*P\()(\[.*\])(\),?\s*)$/;

const spine = await openSpine();

/* One name map per season present in the file, fetched once. */
const years = [...src.matchAll(/^ {4}(\d{4}): \[/gm)].map((m) => Number(m[1]));
const byYear = new Map();
for (const y of years) byYear.set(y, await spine.battersByName({ year: y }));

const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v))
  ? 'null' : String(Number(v)));

const stats = new Map();   // year -> counters
const problems = [];       // every player this script could not resolve
const collisions = [];     // every shared name PA had to pull apart

let year = null;
const lines = src.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const ym = YEAR_RE.exec(lines[i]);
  if (ym) { year = Number(ym[1]); continue; }
  const pm = PLAYER_RE.exec(lines[i]);
  if (!pm || year === null) continue;

  const [, head, arrText, tail] = pm;
  const arr = JSON.parse(arrText);
  const name = arr[0];

  const st = stats.get(year) || {
    players: 0, byId: 0, byName: 0, byPa: 0, ambiguous: 0, unmatched: 0,
    la: 0, ev: 0, oaa: 0, arm: 0,
  };
  st.players++;

  /* Prefer an id already in the file over a fresh name join. On the first run
   * there is none and every player takes the name path; on every run after,
   * the id is authoritative and the name is not consulted at all. */
  const existingId = arr.length > I_MLBAM && Number.isFinite(arr[I_MLBAM])
    ? Number(arr[I_MLBAM]) : null;

  const pa = arr[2];
  const candidates = byYear.get(year)?.get(name) || [];
  let rec = null;
  if (existingId !== null) {
    rec = candidates.find((c) => c.mlbam === existingId) || { mlbam: existingId };
    rec = { ...rec, mlbam: existingId };
    st.byId++;
  } else if (candidates.length === 1) {
    rec = candidates[0];
    st.byName++;
  } else if (candidates.length > 1) {
    /* Two men, one name. PA is the discriminator, and it is exact — against
     * either the season total or any one club split, because data.js carries
     * the per-club split and a traded batter appears in two lineups. */
    const exact = candidates.filter((c) => c.pa === pa
      || (c.paByClub || []).includes(pa));
    if (exact.length === 1) {
      rec = exact[0];
      st.byPa++;
      collisions.push({ year, name, pa, mlbam: exact[0].mlbam,
        others: candidates.filter((c) => c !== exact[0]).map((c) => `${c.mlbam}/${c.pa}pa`) });
    } else {
      st.ambiguous++;
      problems.push({ year, name, why: `${candidates.length} men share this name and `
        + `${exact.length} of them have ${pa} PA — cannot tell them apart` });
    }
  } else {
    st.unmatched++;
    problems.push({ year, name, why: 'no batting row for this name in the spine' });
  }

  for (const k of ['la', 'ev', 'oaa', 'arm']) {
    if (rec && rec[k] !== null && rec[k] !== undefined) st[k]++;
  }
  stats.set(year, st);

  /* THE IDENTITY-PRESERVING STEP. The first eleven elements are copied as the
   * ORIGINAL SUBSTRING, not re-serialised from the parsed numbers — a
   * round-trip through JSON.parse and String() would turn 26.9 back into 26.9
   * today and could not be relied on to keep doing so for every float in the
   * file. Slice the text, do not rebuild it. */
  const keep = sliceFirst(arrText, SHIPPED);
  const extra = [
    num(rec?.mlbam), num(rec?.la), num(rec?.ev), num(rec?.oaa), num(rec?.arm),
  ].join(', ');
  /* `keep` stops before the closing bracket and `tail` is the `),` (or `)`)
   * that PLAYER_RE captured, so the bracket goes back in here and the paren
   * comes from tail verbatim. Dropping either produces a data.js that parses
   * as a syntax error rather than as wrong data — loud, but only if something
   * actually loads the file, which is why check-data-identity.mjs runs it. */
  lines[i] = `${head}${keep}, ${extra}]${tail}`;
}

/* Return the text of an array literal up to and NOT including its nth
 * element's separator — i.e. `["a", 1, 2]` with n=2 gives `["a", 1`. Written
 * as a scan rather than a split because element zero is a quoted name that can
 * contain a comma ("Jr.", accents and apostrophes already appear in this
 * file). */
function sliceFirst(text, n) {
  let depth = 0, inStr = false, esc = false, count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') { depth++; continue; }
    if (c === ']') { depth--; if (depth === 0) return text.slice(0, i); continue; }
    if (c === ',' && depth === 1) {
      count++;
      if (count === n) return text.slice(0, i);
    }
  }
  throw new Error(`augment-data: could not find element ${n} in ${text}`);
}

let out = lines.join(NL);

/* P() and the header comment describe the file's shape, so they move with it.
 * Both are matched exactly and the script fails loudly rather than writing a
 * file whose decoder disagrees with its rows. */
const oldP = `  // p = [name, pos, PA, H, 2B, 3B, HR, BB, SO, sprint_ft_s, hp_to_1b_s]${NL}`
  + `  function P(a) {${NL}`
  + `    return {${NL}`
  + `      name: a[0], pos: a[1], pa: a[2], h: a[3],${NL}`
  + `      d2: a[4], d3: a[5], hr: a[6], bb: a[7], so: a[8],${NL}`
  + `      spd: a[9], hp1: a[10],${NL}`
  + `    };${NL}`
  + `  }${NL}`;
const newP = `  // p = [name, pos, PA, H, 2B, 3B, HR, BB, SO, sprint_ft_s, hp_to_1b_s,${NL}`
  + `  //      mlbam, launch_angle_deg, exit_velo_mph, oaa, arm_mph]${NL}`
  + `  // The last five may be null. A null is a real absence — a full-time DH${NL}`
  + `  // has no oaa and no qualifying arm throw — never a league median.${NL}`
  + `  function P(a) {${NL}`
  + `    return {${NL}`
  + `      name: a[0], pos: a[1], pa: a[2], h: a[3],${NL}`
  + `      d2: a[4], d3: a[5], hr: a[6], bb: a[7], so: a[8],${NL}`
  + `      spd: a[9], hp1: a[10],${NL}`
  + `      mlbam: a[11] ?? null, la: a[12] ?? null, ev: a[13] ?? null,${NL}`
  + `      oaa: a[14] ?? null, arm: a[15] ?? null,${NL}`
  + `    };${NL}`
  + `  }${NL}`;
if (out.includes(oldP)) out = out.replace(oldP, newP);
else if (!out.includes(newP)) {
  throw new Error('augment-data: P() in data.js matches neither the shipped '
    + 'eleven-key form nor the augmented sixteen-key form. Refusing to write a '
    + 'file whose decoder may not match its rows — reconcile P() by hand first.');
}

const oldDoc = ` *   hp1  home-to-first, seconds, his average competitive run${NL}`;
const newDoc = oldDoc
  + ` *   mlbam  MLBAM player id, the durable key for every future join${NL}`
  + ` *   la     average launch angle, degrees      (Statcast, 2015-)${NL}`
  + ` *   ev     average exit velocity, mph         (Statcast, 2015-)${NL}`
  + ` *   oaa    outs above average                 (Statcast, 2016-)${NL}`
  + ` *   arm    max arm strength, mph              (Statcast, 2020-)${NL}`
  + ` * The last five are attached by tools/augment-data.mjs, which appends to${NL}`
  + ` * this file rather than regenerating it. Any of the four Statcast values${NL}`
  + ` * may be null and a null is a real absence, never a filled median.${NL}`;
if (out.includes(oldDoc) && !out.includes(newDoc)) out = out.replace(oldDoc, newDoc);

await spine.close();

/* ---- the report. Printed every run, because the join quality IS the result. */
let bad = 0;
console.log('year  players   byId  byName   byPa   ambig  unmatched |    la     ev    oaa    arm');
for (const y of years) {
  const s = stats.get(y);
  bad += s.ambiguous + s.unmatched;
  console.log(`${y}  ${String(s.players).padStart(7)}`
    + `${String(s.byId).padStart(7)}${String(s.byName).padStart(8)}`
    + `${String(s.byPa).padStart(7)}`
    + `${String(s.ambiguous).padStart(8)}${String(s.unmatched).padStart(11)} |`
    + `${String(s.la).padStart(6)}${String(s.ev).padStart(7)}`
    + `${String(s.oaa).padStart(7)}${String(s.arm).padStart(7)}`);
}
for (const c of collisions) {
  console.log(`  SHARED NAME ${c.year}  ${c.name} — took mlbam ${c.mlbam} on ${c.pa} PA, `
    + `not ${c.others.join(' or ')}`);
}
for (const p of problems) console.log(`  UNRESOLVED ${p.year}  ${p.name} — ${p.why}`);

if (REPORT_ONLY) {
  console.log('\n--report: nothing written.');
} else {
  fs.writeFileSync(OUT, out);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}  ${(out.length / 1024).toFixed(0)}KB`);
  console.log('Now run: node tools/check-data-identity.mjs   (then node tools/run-tests.mjs)');
}

/* An unresolved player is not a crash — he keeps his eleven values and takes
 * nulls for the five new ones, which is exactly the "missing value reduces to
 * today's behaviour" rule. But it must not pass silently, because a growing
 * count is the name join decaying. */
if (bad) {
  console.log(`\n${bad} player(s) unresolved — each carries null for all five `
    + 'new fields. Their eleven shipped values are untouched.');
}
