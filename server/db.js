// Verilənlər bazası: DATABASE_URL varsa PostgreSQL (onlayn), yoxsa lokal SQLite faylı.
// SQL-lər $1, $2 ... parametrləri ilə yazılır və hər iki bazada işləyir.
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  display_key TEXT NOT NULL UNIQUE,
  phone TEXT,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'pending',
  balance BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  delta BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reason TEXT NOT NULL,
  by_user INTEGER,
  room TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_user_idx ON transactions(user_id, id);
`;

const SCHEMA_SQLITE = SCHEMA_PG.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT');

export async function openDb() {
  if (process.env.DATABASE_URL) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT → number
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 5,
    });
    await pool.query(SCHEMA_PG);
    console.log('Baza: PostgreSQL');
    return {
      kind: 'pg',
      async all(sql, params = []) { return (await pool.query(sql, params)).rows; },
      async get(sql, params = []) { return (await pool.query(sql, params)).rows[0] ?? null; },
      async run(sql, params = []) { await pool.query(sql, params); },
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  const dir = process.env.DATA_DIR || path.resolve('data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'seka.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_SQLITE);
  console.log('Baza: SQLite →', file);
  const conv = (sql) => sql.replace(/\$(\d+)/g, '?$1');
  const cache = new Map();
  const prep = (sql) => {
    let st = cache.get(sql);
    if (!st) { st = db.prepare(conv(sql)); cache.set(sql, st); }
    return st;
  };
  const norm = (row) => (row ? { ...row } : null);
  return {
    kind: 'sqlite',
    async all(sql, params = []) { return prep(sql).all(...params).map(norm); },
    async get(sql, params = []) { return norm(prep(sql).get(...params)); },
    async run(sql, params = []) { prep(sql).run(...params); },
  };
}
