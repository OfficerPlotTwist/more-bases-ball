/* Thin DuckDB wrapper. Every builder and the query layer goes through this so
 * there is one place that knows the driver's shape. */
import { DuckDBInstance } from '@duckdb/node-api';

export async function openDb(file = ':memory:') {
  const instance = await DuckDBInstance.create(file);
  const conn = await instance.connect();
  return {
    conn,
    async all(sql) {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjects();
    },
    async run(sql) { await conn.run(sql); },
    async close() { conn.closeSync?.(); },
  };
}

/* DuckDB takes forward slashes in SQL string literals on every platform. */
export const sqlPath = (p) => p.replace(/\\/g, '/');
