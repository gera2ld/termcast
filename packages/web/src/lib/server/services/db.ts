import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../core/config";

let dbInstance: Database | null = null;

function initDb(): Database {
  mkdirSync(DATA_DIR, { recursive: true });
  const database = new Database(join(DATA_DIR, "termcast.db"), { create: true });
  database.run("PRAGMA journal_mode = WAL;");
  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      args TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      credential_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      credential TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expire_at INTEGER NOT NULL
    );
  `);
  return database;
}

export function getDb(): Database {
  if (!dbInstance) dbInstance = initDb();
  return dbInstance;
}
