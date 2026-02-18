import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { errorMessage } from "../types.ts";

let db: Database;

export function getDb(): Database {
  if (db) return db;

  const dbPath = `${env.DATA_DIR}/trigger.db`;
  mkdirSync(env.DATA_DIR, { recursive: true });
  db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  migrate(db);
  logger.info({ path: dbPath }, "database initialized");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info("database closed");
  }
}

type Migration = (db: Database) => void;

const migrations: Migration[] = [
  // v1: initial schema
  (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id            TEXT PRIMARY KEY,
        namespace     TEXT NOT NULL,
        pipeline_id   TEXT NOT NULL,
        pipeline_name TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        params        TEXT,
        started_at    TEXT NOT NULL,
        finished_at   TEXT,
        error         TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS pipeline_steps (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES pipeline_runs(id),
        step_id     TEXT NOT NULL,
        step_name   TEXT NOT NULL,
        action      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        started_at  TEXT,
        finished_at TEXT,
        output      TEXT,
        error       TEXT,
        log_file    TEXT
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_runs_ns_pipeline ON pipeline_runs(namespace, pipeline_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_runs_status ON pipeline_runs(status)");
    db.run("CREATE INDEX IF NOT EXISTS idx_steps_run ON pipeline_steps(run_id)");
  },

  // v2: add dry_run and triggered_by columns
  (db) => {
    db.run("ALTER TABLE pipeline_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0");
    db.run("ALTER TABLE pipeline_runs ADD COLUMN triggered_by TEXT");
    db.run("CREATE INDEX IF NOT EXISTS idx_runs_ns_pipeline_started ON pipeline_runs(namespace, pipeline_id, started_at DESC)");
  },
];

function detectExistingVersion(db: Database): number {
  // Bootstrap: existing databases created before versioned migrations have user_version=0
  // but may already have all tables and columns. Detect the actual state.
  const tableExists = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_runs'").get();
  if (!tableExists) return 0; // fresh database

  const columns = db.query<{ name: string }, []>("PRAGMA table_info(pipeline_runs)").all();
  const colNames = new Set(columns.map((c) => c.name));
  if (colNames.has("triggered_by")) return 2; // has v2 columns
  return 1; // has tables but not v2 columns
}

function migrate(db: Database) {
  let currentVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;

  // Bootstrap existing databases that predate versioned migrations
  if (currentVersion === 0) {
    const detected = detectExistingVersion(db);
    if (detected > 0) {
      db.run(`PRAGMA user_version = ${detected}`);
      logger.info({ detectedVersion: detected }, "bootstrapped migration version for existing database");
      currentVersion = detected;
    }
  }

  for (let i = currentVersion; i < migrations.length; i++) {
    const txn = db.transaction(() => {
      migrations[i]!(db);
    });
    try {
      txn();
      db.run(`PRAGMA user_version = ${i + 1}`);
      logger.info({ from: i, to: i + 1 }, "migration applied");
    } catch (err) {
      throw new Error(`Migration v${i + 1} failed: ${errorMessage(err)}`);
    }
  }
}
