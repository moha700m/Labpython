import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template TEXT,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX projects_user ON projects(user_id, updated_at);
  CREATE TABLE files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path)
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT 'queued',
    config_json TEXT NOT NULL,
    run_json TEXT,
    input_artifact_id TEXT,
    snapshot_json TEXT,
    required_capability TEXT NOT NULL,
    worker_id TEXT,
    log TEXT NOT NULL DEFAULT '',
    result_json TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    heartbeat_at TEXT
  );
  CREATE INDEX jobs_queue ON jobs(status, required_capability, created_at);
  CREATE INDEX jobs_project ON jobs(project_id, created_at);
  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    format TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    ip TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    capabilities_json TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    files_json TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
  `,
];

export function openDb(dataDir: string, file = "studio.db"): DB {
  const db = new DatabaseSync(file === ":memory:" ? ":memory:" : join(dataDir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
  const row = db.prepare("SELECT v FROM schema_version").get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (v) VALUES (0)").run();
  while (v < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      v++;
      db.prepare("UPDATE schema_version SET v = ?").run(v);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export const now = () => new Date().toISOString();
