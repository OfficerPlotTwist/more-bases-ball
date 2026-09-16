/* Shared HTTP helpers for the data builders: retrying fetch, a disk cache so a
 * rebuild does not re-download hundreds of MB, a bounded-concurrency pool, and
 * the CSV parser the Savant leaderboards need. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let CACHE = path.join(ROOT, 'data', '.cache');
let FETCH = globalThis.fetch;

export const setCacheDir = (d) => { CACHE = d; };
export const setFetch = (f) => { FETCH = f; };

export const cachePath = (url) =>
  path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));

const retry = async (url, as, tries = 3) => {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await FETCH(url);
      if (r.ok) return as === 'text' ? r.text() : r.json();
    } catch (e) { /* fall through to the backoff */ }
    await new Promise((res) => setTimeout(res, 400 * (k + 1)));
  }
  throw new Error('failed ' + url);
};

let hits = 0;
let misses = 0;

export const cacheStats = () => ({ hits, misses });
export const resetCacheStats = () => { hits = 0; misses = 0; };

/* A season is volatile until it is fully in the past. The current year is
 * obviously still moving; the prior year still receives late statistical
 * corrections. Everything older is immutable and cached forever — that is
 * what keeps a warm rebuild fast. */
export const isVolatileSeason = (year, now = new Date()) =>
  year >= now.getFullYear() - 1;

/* The disk cache has no age component ON PURPOSE: baseball history is
 * immutable, so a TTL would only throw away facts that can never change.
 * The one thing that is not immutable is a season still being played, and
 * that is what `opts.fresh` is for — the caller, which knows the year,
 * asks for a refetch and the fresh body OVERWRITES the stale entry (rather
 * than skipping the cache) so a later offline rebuild still has something
 * to fall back on. A forced refetch counts as a miss: a "cache N hits 0
 * fetched" line must never describe a run that went to the network. */
export const getText = async (url, validate, opts = {}) => {
  const p = cachePath(url);
  const fresh = opts.fresh === true || process.env.MBB_CACHE_REFRESH === '1';
  if (!fresh && fs.existsSync(p)) {
    hits++;
    return fs.readFileSync(p, 'utf8');
  }
  misses++;
  const body = await retry(url, 'text');
  if (validate) validate(body);   // throws BEFORE anything reaches the cache
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return body;
};

export const getJson = async (url, opts = {}) => JSON.parse(await getText(url, JSON.parse, opts));

/* The CSV counterpart to getJson's JSON.parse validator. retry() only checks
 * r.ok, so a 200 carrying a rate-limit/error page, or a truncated body, would
 * otherwise be written to the disk cache and served forever — build-players.mjs
 * silently drops such a shard behind its TRY_CAST filter, permanently losing
 * 1/16th of the crosswalk across every future rebuild. Pass this to getText at
 * every CSV call site so a bad body throws BEFORE it reaches the cache. */
export const csvBody = (text) => {
  const t = String(text).replace(/^﻿/, '');
  if (t.trimStart().startsWith('<')) {
    throw new Error('csvBody: response body starts with "<" — looks like HTML, not CSV');
  }
  const firstLine = t.split(/\r?\n/, 1)[0];
  if (!firstLine.includes(',')) {
    throw new Error('csvBody: no comma in the first line — not a CSV header');
  }
  return text;
};

export const pool = async (items, n, fn) => {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
};

export const parseCsv = (txt) => {
  const rows = txt.replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};
