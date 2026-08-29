import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../core/config";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "termcast.db"), { create: true });

db.run("PRAGMA journal_mode = WAL;");

db.run(`
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
`);
