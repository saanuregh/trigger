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

function migrate(db: Database) {
  db.exec(`
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
    );

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
    );

    CREATE INDEX IF NOT EXISTS idx_runs_ns_pipeline ON pipeline_runs(namespace, pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON pipeline_runs(status);
    CREATE INDEX IF NOT EXISTS idx_steps_run ON pipeline_steps(run_id);
  `);

  try {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0");
    logger.info("migration: added dry_run column to pipeline_runs");
  } catch (err) {
    const msg = errorMessage(err);
    if (!msg.includes("duplicate column")) {
      logger.error({ error: msg }, "migration: failed to add dry_run column");
    }
  }

  try {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN triggered_by TEXT");
    logger.info("migration: added triggered_by column to pipeline_runs");
  } catch (err) {
    const msg = errorMessage(err);
    if (!msg.includes("duplicate column")) {
      logger.error({ error: msg }, "migration: failed to add triggered_by column");
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_ns_pipeline_started ON pipeline_runs(namespace, pipeline_id, started_at DESC)`);
}
