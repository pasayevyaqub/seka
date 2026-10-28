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
  {
    id: 4,
    name: 'v2.2: bonus, kredit, hədiyyə, oyunçu borcları, bildirişlər, avatar, idempotency',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      const blob = kind === 'pg' ? 'BYTEA' : 'BLOB';
      await addColumn(q, kind, 'users', 'credit_debt', 'BIGINT NOT NULL DEFAULT 0');
      await addColumn(q, kind, 'users', 'credit_limit', 'BIGINT NOT NULL DEFAULT 0');
      await addColumn(q, kind, 'users', 'avatar', blob);
      await addColumn(q, kind, 'users', 'avatar_ver', 'INTEGER NOT NULL DEFAULT 0');
      await addColumn(q, kind, 'transactions', 'counterparty_id', 'INTEGER');
      await addColumn(q, kind, 'transactions', 'op_key', 'TEXT');
      await addColumn(q, kind, 'transactions', 'note', 'TEXT');
      // hər maliyyə sorğusunun idempotency açarı: eyni açar ikinci dəfə heç nə dəyişmir
      await q.run(`CREATE TABLE IF NOT EXISTS op_keys (
        key TEXT PRIMARY KEY,
        user_id INTEGER,
        kind TEXT NOT NULL,
        result TEXT,
        created_at BIGINT NOT NULL)`);
      await q.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      await q.run(`INSERT INTO app_settings(key, value) VALUES('signup_bonus', '100') ON CONFLICT(key) DO NOTHING`);
      await q.run(`CREATE TABLE IF NOT EXISTS credit_requests (
        id ${serial},
        user_id INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_amount BIGINT,
        decided_by INTEGER,
        note TEXT,
        admin_note TEXT,
        created_at BIGINT NOT NULL,
        decided_at BIGINT)`);
      // bir oyunçunun yalnız bir gözləyən müraciəti ola bilər
      await q.run(`CREATE UNIQUE INDEX IF NOT EXISTS credit_req_one_pending ON credit_requests(user_id) WHERE status = 'pending'`);
      await q.run(`CREATE TABLE IF NOT EXISTS loans (
        id ${serial},
        lender_id INTEGER NOT NULL,
        borrower_id INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        remaining BIGINT NOT NULL,
        due_at BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offered',
        note TEXT,
        created_at BIGINT NOT NULL,
        accepted_at BIGINT,
        closed_at BIGINT)`);
      await q.run('CREATE INDEX IF NOT EXISTS loans_borrower ON loans(borrower_id, status, due_at, id)');
      await q.run('CREATE INDEX IF NOT EXISTS loans_lender ON loans(lender_id, status)');
      await q.run(`CREATE TABLE IF NOT EXISTS loan_payments (
        id ${serial},
        loan_id INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        kind TEXT NOT NULL,
        remaining_after BIGINT NOT NULL,
        executed_at BIGINT NOT NULL)`);
      await q.run(`CREATE TABLE IF NOT EXISTS notifications (
        id ${serial},
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        read_at BIGINT)`);
      await q.run('CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, id)');
      // qeydiyyat artıq admin təsdiqi tələb etmir: köhnə "pending" hesablar aktivləşir.
      // blocked və rejected hesablar toxunulmaz qalır. Mövcud hesablara bonus VERİLMİR.
      await q.run(`UPDATE users SET status = 'approved' WHERE status = 'pending'`);
    },
  },
  {
    id: 5,
    name: 'v2.3: masa hədiyyələri (animasiyalı), qiymətlər və alana keçən faiz',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      // hədiyyə növləri — qiymət və aktivlik admin panelindən dəyişir
      await q.run(`CREATE TABLE IF NOT EXISTS gift_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price BIGINT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0)`);
      await q.run(`INSERT INTO gift_types(id, name, price, active, sort) VALUES
        ('card_rain', 'Kart yağışı', 100, 1, 1),
        ('table_king', 'Masa kralı', 300, 1, 2),
        ('fire_ace', 'Odlu Tuz', 1000, 1, 3) ON CONFLICT(id) DO NOTHING`);
      await q.run(`INSERT INTO app_settings(key, value) VALUES('gift_share_pct', '30') ON CONFLICT(key) DO NOTHING`);
      // hər göndərilən hədiyyə: o anki qiymət, faiz və verilən xal ayrıca saxlanılır (sonrakı dəyişikliklər köhnə qeydlərə təsir etmir)
      await q.run(`CREATE TABLE IF NOT EXISTS table_gifts (
        id ${serial},
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        gift_id TEXT NOT NULL,
        gift_name TEXT NOT NULL,
        price BIGINT NOT NULL,
        share_pct INTEGER NOT NULL,
        credited BIGINT NOT NULL,
        burned BIGINT NOT NULL,
        debt_paid BIGINT NOT NULL DEFAULT 0,
        room_code TEXT,
        op_key TEXT,
        created_at BIGINT NOT NULL)`);
      await q.run('CREATE INDEX IF NOT EXISTS table_gifts_from ON table_gifts(from_id, id)');
      await q.run('CREATE INDEX IF NOT EXISTS table_gifts_to ON table_gifts(to_id, id)');
    },
  },
  {
    id: 6,
    name: 'v2.7: oyunçu girişi açarı (açıq), borc istəyi və borca oyun üçün indeks — məlumat silinmir',
    async up(q) {
      // giriş açarı ilkin olaraq AÇIQ (mövcud oyunçular əvvəlki kimi daxil olur)
      await q.run(`INSERT INTO app_settings(key, value) VALUES('player_login_open', '1') ON CONFLICT(key) DO NOTHING`);
      // "Borc istə" (status = 'requested') və borca oyun borcları mövcud loans cədvəlindədir — yalnız indeks əlavə olunur
      await q.run('CREATE INDEX IF NOT EXISTS loans_status ON loans(status, lender_id)');
    },
  },
  {
    id: 7,
    name: 'v2.8: "Şir" hədiyyəsi və hədiyyə üzrə ayrıca "alana keçən faiz" — məlumat silinmir',
    async up(q, kind) {
      // NULL = ümumi faiz (gift_share_pct). Mövcud hədiyyələr əvvəlki kimi ümumi faizlə işləyir.
      await addColumn(q, kind, 'gift_types', 'share_pct', 'INTEGER');
      await q.run(`INSERT INTO gift_types(id, name, price, active, sort) VALUES ('lion', 'Şir', 500, 1, 4) ON CONFLICT(id) DO NOTHING`);
    },
  },
  {
    id: 8,
    name: 'v3.0: oyunçu dərəcələri (raund nəticələri), admin əməliyyat qeydiyyatı, telefon təsdiqi sahəsi — məlumat silinmir',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      // hər tamamlanmış real raundda hər insan iştirakçının nəticəsi (dərəcə balansdan AYRI hesablanır)
      await q.run(`CREATE TABLE IF NOT EXISTS round_results (
        round_uid TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        net BIGINT NOT NULL DEFAULT 0,
        group_key TEXT NOT NULL,
        counted INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (round_uid, user_id))`);
      await q.run('CREATE INDEX IF NOT EXISTS round_results_user ON round_results(user_id, counted, outcome)');
      await q.run('CREATE INDEX IF NOT EXISTS round_results_group ON round_results(user_id, group_key, created_at)');
      await q.run(`CREATE TABLE IF NOT EXISTS admin_log (
        id ${serial},
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        amount BIGINT,
        affected INTEGER NOT NULL DEFAULT 0,
        details TEXT,
        created_at BIGINT NOT NULL)`);
      await addColumn(q, kind, 'users', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0');
      // köhnə tamamlanmış raundlar: nəticə round_flows-dan təxmini çıxarılır (qalib: xalis +, uduzan: xalis −)
      const rounds = await q.all(`SELECT uid, contrib, finished_at, created_at FROM rounds WHERE status = 'finished' ORDER BY COALESCE(finished_at, created_at), uid`);
      const counter = new Map(); // gündəlik limit üçün: user|group|gün → say
      for (const r of rounds) {
        let contrib = {};
        try { contrib = JSON.parse(r.contrib || '{}'); } catch { /* */ }
        const ids = Object.keys(contrib).map(Number).filter((x) => x > 0);
        if (ids.length < 2) continue;
        const flows = await q.all('SELECT from_user, to_user, cents FROM round_flows WHERE round_uid = $1', [r.uid]);
        const net = new Map(ids.map((id) => [id, 0]));
        for (const f of flows) { net.set(Number(f.to_user), (net.get(Number(f.to_user)) || 0) + Number(f.cents)); net.set(Number(f.from_user), (net.get(Number(f.from_user)) || 0) - Number(f.cents)); }
        const group = [...ids].sort((x, y) => x - y).join('-');
        const t = Number(r.finished_at || r.created_at);
        const day = Math.floor(t / 86_400_000);
        for (const id of ids) {
          const n = net.get(id) || 0;
          const outcome = n > 0 ? 'win' : n < 0 ? 'loss' : 'split';
          const k = `${id}|${group}|${day}`;
          const c = (counter.get(k) || 0) + 1; counter.set(k, c);
          const counted = flows.length > 0 && c <= 10 ? 1 : 0;
          await q.run(`INSERT INTO round_results(round_uid, user_id, outcome, net, group_key, counted, created_at) VALUES($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(round_uid, user_id) DO NOTHING`, [r.uid, id, outcome, Math.round(n / 100), group, counted, t]);
        }
      }
    },
  },
  {
    id: 9,
    name: 'v3.1: oyundaxili market (yalnız virtual xal) və oyunçu kolleksiyası — məlumat silinmir',
    async up(q, kind) {
      const serial = kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      const blob = kind === 'pg' ? 'BYTEA' : 'BLOB';
      await q.run(`CREATE TABLE IF NOT EXISTS shop_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price BIGINT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        image ${blob},
        image_ver INTEGER NOT NULL DEFAULT 0)`);
      await q.run(`INSERT INTO shop_items(id, name, price, active, sort) VALUES
        ('cigarette', 'Siqaret', 50, 1, 1),
        ('whisky', 'Viski', 150, 1, 2),
        ('energy', 'Enerji içkisi', 80, 1, 3),
        ('food', 'Yemək', 60, 1, 4),
        ('doner', 'Dönər', 70, 1, 5) ON CONFLICT(id) DO NOTHING`);
      // kolleksiya: oyunçunun aldığı əşyalar (hesaba bağlı — yenidən girəndə itmir)
      await q.run(`CREATE TABLE IF NOT EXISTS user_items (
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        acquired_at BIGINT NOT NULL,
        price_paid BIGINT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, item_id))`);
      await q.run(`CREATE TABLE IF NOT EXISTS shop_purchases (
        id ${serial},
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        price BIGINT NOT NULL,
        op_key TEXT,
        created_at BIGINT NOT NULL)`);
      await q.run('CREATE INDEX IF NOT EXISTS shop_purchases_user ON shop_purchases(user_id, id)');
    },
  },
  {
    id: 10,
    name: 'v3.2: masadan borc istəyinə cavab müddəti (10 san) — məlumat silinmir',
    async up(q, kind) {
      await addColumn(q, kind, 'loans', 'respond_by', 'BIGINT');
    },
  },
];

// PostgreSQL üçün vaxt limitləri: baza cavab verməsə otaq növbəsi sonsuz gözləməsin (donmanın əsas ehtimalı)
export const PG_LIMITS = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, query_timeout: 15_000, max: 5 };

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
      // bir neçə server nüsxəsi eyni anda başlasa (məs. deploy zamanı) migration-lar növbə ilə və bir dəfə icra olunur
      if (db.kind === 'pg') await q.get('SELECT pg_advisory_xact_lock(724411)');
      if (await q.get('SELECT id FROM schema_migrations WHERE id = $1', [m.id])) return;
      await m.up(q, db.kind);
      await q.run('INSERT INTO schema_migrations(id, name, applied_at) VALUES($1, $2, $3)', [m.id, m.name, Date.now()]);
    });
    if (!done.has(m.id)) console.log(`Migration ${m.id} yoxlanıldı/tətbiq edildi: ${m.name}`);
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
      ...PG_LIMITS,
      keepAlive: true,
    });
    // Boşda duran bağlantı bazada (məs. Neon yatanda) bağlananda pool 'error' yayır. Dinləyici olmasa Node prosesi
    // tamamilə dayanır (server "donur"/yenidən başlayır). Burada yalnız loga yazırıq — pool həmin bağlantını atır.
    pool.on?.('error', (e) => console.error('PG pool xətası (boşdakı bağlantı):', e?.message || e));
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
        let broken = null;
        try {
          await client.query('BEGIN');
          const out = await fn(wrap(client));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          // vaxt limiti / bağlantı xətası: ROLLBACK da gözlənilməsin; bağlantı pool-a qaytarılmır, atılır
          broken = e;
          await Promise.race([client.query('ROLLBACK').catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
          throw e;
        } finally { client.release(broken && /timeout|terminat|Connection|ECONN|EPIPE/i.test(String(broken.message)) ? broken : undefined); }
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
