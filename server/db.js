// Verilənlər bazası: DATABASE_URL varsa PostgreSQL (onlayn), yoxsa lokal SQLite faylı.
// SQL-lər $1, $2 ... parametrləri ilə yazılır və hər iki bazada işləyir.
// db.tx(fn) — atomik tranzaksiya: ya hamısı yazılır, ya heç biri.
import fs from 'node:fs';
import path from 'node:path';

// ---------- migration-lar (məlumat silmir, yalnız əlavə edir) ----------
// Hər migration bir dəfə işləyir; nömrəsi schema_migrations cədvəlində saxlanılır.
const MIGRATIONS = [
  {
    id: 1,
    name: 'ilkin sxem (v1)',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      await q.run(`CREATE TABLE IF NOT EXISTS users (
        id ${serial},
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        display_key TEXT NOT NULL UNIQUE,
        phone TEXT,
        pass_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        status TEXT NOT NULL DEFAULT 'pending',
        balance BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL)`);
      await q.run(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at BIGINT NOT NULL)`);
      await q.run(`CREATE TABLE IF NOT EXISTS transactions (
        id ${serial},
        user_id INTEGER NOT NULL,
        delta BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        reason TEXT NOT NULL,
        by_user INTEGER,
        room TEXT,
        created_at BIGINT NOT NULL)`);
      await q.run('CREATE INDEX IF NOT EXISTS tx_user_idx ON transactions(user_id, id)');
    },
  },
  {
    id: 2,
    name: 'v2: əməliyyat növü, raundlar, qarşılıqlı nəticələr',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      await addColumn(q, kind, 'transactions', 'kind', 'TEXT');
      await addColumn(q, kind, 'transactions', 'prev_balance', 'BIGINT');
      await addColumn(q, kind, 'transactions', 'round_uid', 'TEXT');
      // hər real raund: aktiv olanda kimin nə qoyduğu saxlanılır (server yenidən başlasa qaytarmaq üçün)
      await q.run(`CREATE TABLE IF NOT EXISTS rounds (
        uid TEXT PRIMARY KEY,
        room TEXT,
        status TEXT NOT NULL,
        contrib TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        finished_at BIGINT)`);
      // kim kimə nə qədər uduzub (qəpiklə). Yalnız v2-dən sonrakı raundlar.
      await q.run(`CREATE TABLE IF NOT EXISTS round_flows (
        id ${serial},
        round_uid TEXT NOT NULL,
        from_user INTEGER NOT NULL,
        to_user INTEGER NOT NULL,
        cents BIGINT NOT NULL,
        created_at BIGINT NOT NULL)`);
      await q.run('CREATE UNIQUE INDEX IF NOT EXISTS round_flows_uniq ON round_flows(round_uid, from_user, to_user)');
      await q.run('CREATE INDEX IF NOT EXISTS round_flows_from ON round_flows(from_user)');
      await q.run('CREATE INDEX IF NOT EXISTS round_flows_to ON round_flows(to_user)');
    },
  },
  {
    id: 3,
    name: 'v2.1: yazılış paketləri (batch) — təkrar tətbiqə qarşı',
    async up(q, kind) {
      // Hər raund yazılış paketinin sabit ID-si. PRIMARY KEY eyni paketin iki dəfə tətbiqinə imkan vermir.
      await q.run(`CREATE TABLE IF NOT EXISTS round_batches (
        batch_id TEXT PRIMARY KEY,
        round_uid TEXT NOT NULL,
        created_at BIGINT NOT NULL)`);
      await addColumn(q, kind, 'transactions', 'batch_id', 'TEXT');
    },
  },
];

async function addColumn(q, kind, table, col, type) {
  if (kind === 'pg') {
    await q.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  } else {
    const cols = await q.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === col)) await q.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at BIGINT)');
  const done = new Set((await db.all('SELECT id FROM schema_migrations')).map((r) => Number(r.id)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (q) => {
      await m.up(q, db.kind);
      await q.run('INSERT INTO schema_migrations(id, name, applied_at) VALUES($1, $2, $3)', [m.id, m.name, Date.now()]);
    });
    console.log(`Migration ${m.id} tətbiq edildi: ${m.name}`);
  }
}

// Sadə async kilid (SQLite bir bağlantıdır — tranzaksiyalar növbə ilə)
function makeLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

export async function openDb({ url = process.env.DATABASE_URL, file } = {}) {
  let db;
  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT → number
    const pool = new pg.Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1|host=\//.test(url) ? false : { rejectUnauthorized: false },
      max: 5,
    });
    const wrap = (c) => ({
      async all(sql, params = []) { return (await c.query(sql, params)).rows; },
      async get(sql, params = []) { return (await c.query(sql, params)).rows[0] ?? null; },
      async run(sql, params = []) { const r = await c.query(sql, params); return { changes: r.rowCount }; },
    });
    db = {
      kind: 'pg',
      ...wrap(pool),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(wrap(client));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
    console.log('Baza: PostgreSQL');
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    if (!file) {
      const dir = process.env.DATA_DIR || path.resolve('data');
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, 'seka.db');
    }
    const sq = new DatabaseSync(file);
    sq.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    const conv = (sql) => sql.replace(/\$(\d+)/g, '?$1');
    const cache = new Map();
    const prep = (sql) => {
      let st = cache.get(sql);
      if (!st) { st = sq.prepare(conv(sql)); cache.set(sql, st); }
      return st;
    };
    const norm = (row) => (row ? { ...row } : null);
    const raw = {
      async all(sql, params = []) { return prep(sql).all(...params).map(norm); },
      async get(sql, params = []) { return norm(prep(sql).get(...params)); },
      async run(sql, params = []) { const r = prep(sql).run(...params); return { changes: Number(r.changes) }; },
    };
    const lock = makeLock();
    db = {
      kind: 'sqlite',
      all: (s, p) => lock(() => raw.all(s, p)),
      get: (s, p) => lock(() => raw.get(s, p)),
      run: (s, p) => lock(() => raw.run(s, p)),
      tx: (fn) => lock(async () => {
        sq.exec('BEGIN IMMEDIATE');
        try { const out = await fn(raw); sq.exec('COMMIT'); return out; } catch (e) { sq.exec('ROLLBACK'); throw e; }
      }),
      close: () => sq.close(),
    };
    console.log('Baza: SQLite →', file);
  }
  await migrate(db);
  return db;
}
