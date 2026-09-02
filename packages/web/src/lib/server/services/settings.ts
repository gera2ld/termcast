import { getDb, ensureSessionKey } from "@termcast/shared/server";
import { settingsSchema, type Settings } from "@termcast/shared";
import { stripUndefined } from "../core/util";

let cached: Settings | null = null;

function load(): Settings {
  const db = getDb();
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      raw[row.key] = row.value;
    }
  }
  const parsed = settingsSchema.parse(raw);
  if (!parsed.sessionEncryptionKey) {
    parsed.sessionEncryptionKey = ensureSessionKey();
  }
  return parsed;
}

export function getSettings(): Settings {
  if (!cached) cached = load();
  return cached;
}

export function configure(input: {
  rpId: string;
  rpName: string;
  username: string;
  displayName: string;
  expectedOrigins?: string[];
}): void {
  const db = getDb();
  const entries: [string, unknown][] = [
    ["rpId", input.rpId],
    ["rpName", input.rpName],
    ["username", input.username],
    ["displayName", input.displayName],
  ];
  if (input.expectedOrigins) {
    entries.push(["expectedOrigins", input.expectedOrigins]);
  }
  for (const [key, value] of entries) {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      key,
      JSON.stringify(value),
    ]);
  }
  cached = null;
}

export function updateEditable(patch: {
  rpName?: string;
  displayName?: string;
  username?: string;
  expectedOrigins?: string[];
  cloudflaredTunnel?: boolean;
  webhookTermStarted?: string;
}): void {
  const db = getDb();
  const cleaned = stripUndefined(patch);
  for (const [key, value] of Object.entries(cleaned)) {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      key,
      JSON.stringify(value),
    ]);
  }
  cached = null;
}

export function setCloudflaredTunnel(on: boolean): void {
  const db = getDb();
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
    "cloudflaredTunnel",
    JSON.stringify(on),
  ]);
  cached = null;
}

export function needsSetup(): boolean {
  return !getSettings().rpId;
}

export function getExpectedOrigin(origin: string): string {
  const settings = getSettings();
  if (settings.expectedOrigins?.length) {
    return settings.expectedOrigins.includes(origin) ? origin : "";
  }
  const normalizedOrigin = origin.replace(/:\d+$/, "").split("://")[1];
  if (`.${normalizedOrigin}`.endsWith(`.${settings.rpId}`)) {
    return origin;
  }
  return "";
}
