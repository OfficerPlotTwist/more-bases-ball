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

export const getText = async (url, validate) => {
  const p = cachePath(url);
  if (process.env.MBB_CACHE_REFRESH !== '1' && fs.existsSync(p)) {
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

export const getJson = async (url) => JSON.parse(await getText(url, JSON.parse));

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
