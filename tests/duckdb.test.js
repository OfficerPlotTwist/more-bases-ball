/* DuckDB availability and Parquet round-trip. Run: node tests/duckdb.test.js */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();

  const reader = await conn.runAndReadAll('SELECT 42 AS answer');
  const rows = reader.getRowObjects();
  check('duckdb answers a query', Number(rows[0].answer) === 42, JSON.stringify(rows[0]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbb-'));
  const pq = path.join(dir, 'round.parquet').replace(/\\/g, '/');
  await conn.run(
    `COPY (SELECT 1 AS id, 'Ruth' AS name) TO '${pq}' (FORMAT PARQUET)`);
  const back = (await conn.runAndReadAll(
    `SELECT * FROM read_parquet('${pq}')`)).getRowObjects();
  check('parquet round-trips', back.length === 1 && back[0].name === 'Ruth',
    JSON.stringify(back));

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
