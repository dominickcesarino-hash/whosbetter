// Who's Better database (Cloudflare D1, free). Tables are created automatically on first use.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, email TEXT, name TEXT, created_at INTEGER NOT NULL, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS comparisons (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, uid TEXT, query TEXT,
     sport TEXT, kind TEXT, a_name TEXT, b_name TEXT, winner TEXT, cached INTEGER DEFAULT 0, saved INTEGER DEFAULT 0, result TEXT)`,
  `CREATE INDEX IF NOT EXISTS cmp_ts ON comparisons (ts)`,
  `CREATE INDEX IF NOT EXISTS cmp_uid ON comparisons (uid, saved, ts)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT, uid TEXT)`,
  `CREATE INDEX IF NOT EXISTS ev_type_ts ON events (type, ts)`
];

let ready = null;
export function db(env) {
  if (!env.DB) return null;
  if (!ready) ready = env.DB.batch(SCHEMA.map(q => env.DB.prepare(q))).catch(e => { ready = null; throw e; });
  return ready.then(() => env.DB);
}

const clip = (v, n) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);

// Remember a signed-in user (first sign-in creates the account row).
export async function touchUser(env, user) {
  const d = await db(env); if (!d || !user) return;
  const now = Date.now();
  await d.prepare(`INSERT INTO users (uid, email, name, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(uid) DO UPDATE SET last_seen = ?4, email = ?2, name = COALESCE(NULLIF(?3, ''), users.name)`)
    .bind(user.uid, clip(user.email, 200), clip(user.name, 80), now).run();
}

// Log every comparison (for the admin page) and save it to the user's account when signed in.
export async function logComparison(env, user, r) {
  const d = await db(env); if (!d) return null;
  const res = await d.prepare(`INSERT INTO comparisons (ts, uid, query, sport, kind, a_name, b_name, winner, cached, saved, result)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
    .bind(Date.now(), user ? user.uid : null, clip(r.query, 120), clip(r.sport, 40), clip(r.kind, 10),
      clip(r.a && r.a.name, 60), clip(r.b && r.b.name, 60), clip(r.winner, 5), r.cached ? 1 : 0,
      user ? 1 : 0, user ? JSON.stringify(r).slice(0, 60000) : null).run();
  return res.meta && res.meta.last_row_id;
}

export async function logEvent(env, type, detail, user) {
  const d = await db(env); if (!d) return;
  await d.prepare(`INSERT INTO events (ts, type, detail, uid) VALUES (?1, ?2, ?3, ?4)`)
    .bind(Date.now(), clip(type, 30), clip(detail, 120), user ? user.uid : null).run();
}

// Replace a saved comparison with its ESPN-updated version (only the owner's own row)
export async function updateSaved(env, user, id, r) {
  const d = await db(env); if (!d || !id) return;
  await d.prepare(`UPDATE comparisons SET result = ?1, winner = ?2 WHERE id = ?3 AND uid = ?4 AND saved = 1`)
    .bind(JSON.stringify(r).slice(0, 60000), clip(r.winner, 5), id, user.uid).run();
}

export async function history(env, user) {
  const d = await db(env); if (!d) return [];
  const { results } = await d.prepare(`SELECT id, ts, query, sport, a_name, b_name, winner FROM comparisons
    WHERE uid = ?1 AND saved = 1 ORDER BY ts DESC LIMIT 100`).bind(user.uid).all();
  return results;
}

export async function getSaved(env, user, id) {
  const d = await db(env); if (!d) return null;
  const row = await d.prepare(`SELECT result FROM comparisons WHERE id = ?1 AND uid = ?2 AND saved = 1`).bind(id, user.uid).first();
  return row && row.result ? JSON.parse(row.result) : null;
}

// "Delete" keeps the anonymous count for the admin stats but removes the saved copy from the account.
export async function unsave(env, user, id) {
  const d = await db(env); if (!d) return;
  const q = id === "all"
    ? d.prepare(`UPDATE comparisons SET saved = 0, result = NULL WHERE uid = ?1`).bind(user.uid)
    : d.prepare(`UPDATE comparisons SET saved = 0, result = NULL WHERE id = ?1 AND uid = ?2`).bind(id, user.uid);
  await q.run();
}

export async function adminStats(env) {
  const d = await db(env); if (!d) return null;
  const now = Date.now(), day = 86400000;
  const one = (q, ...b) => d.prepare(q).bind(...b).first();
  const all = (q, ...b) => d.prepare(q).bind(...b).all().then(r => r.results);
  const names = `SELECT name, COUNT(*) AS n FROM (SELECT a_name AS name, kind FROM comparisons UNION ALL SELECT b_name, kind FROM comparisons)
    WHERE kind = ?1 AND name != '' GROUP BY lower(name) ORDER BY n DESC LIMIT 15`;
  const [totals, users, sports, athletes, teams, daily, leagues, recent, signups] = await Promise.all([
    one(`SELECT COUNT(*) AS all_time, SUM(ts > ?1) AS today, SUM(ts > ?2) AS week, SUM(cached) AS cached, COUNT(DISTINCT uid) AS users_who_compared
         FROM comparisons`, now - day, now - 7 * day),
    one(`SELECT COUNT(*) AS total, SUM(created_at > ?1) AS today, SUM(created_at > ?2) AS week, SUM(last_seen > ?2) AS active_week FROM users`,
      now - day, now - 7 * day),
    all(`SELECT sport AS name, COUNT(*) AS n FROM comparisons WHERE sport != '' GROUP BY lower(sport) ORDER BY n DESC LIMIT 12`),
    all(names, "athletes"),
    all(names, "teams"),
    all(`SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM comparisons WHERE ts > ?1 GROUP BY day ORDER BY day`, now - 30 * day),
    all(`SELECT detail AS name, COUNT(*) AS n FROM events WHERE type = 'league' GROUP BY detail ORDER BY n DESC LIMIT 12`),
    all(`SELECT ts, query, sport, winner, a_name, b_name, uid IS NOT NULL AS signed_in FROM comparisons ORDER BY ts DESC LIMIT 25`),
    all(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at > ?1 GROUP BY day ORDER BY day`, now - 30 * day)
  ]);
  const views = await all(`SELECT type, COUNT(*) AS n, SUM(ts > ?1) AS week FROM events WHERE type LIKE 'view:%' GROUP BY type`, now - 7 * day);
  return { totals, users, sports, athletes, teams, daily, signups, leagues, recent, views };
}
