import { once } from "es-toolkit";
import { getDb } from "./db";
import { generateSessionKey, settingsSchema, type Settings } from "@termcast/shared";

const DEFAULTS = {
  rpName: "TermCast",
  username: "term",
  displayName: "TermCast",
};

function write(key: string, value: string | null) {
  if (value === null) {
    getDb().run("DELETE FROM settings WHERE key = ?", [key]);
  } else {
    getDb().run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
}

function load(): Settings {
  const rows = getDb().query("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const pick = (key: string) => (map.has(key) ? (JSON.parse(map.get(key)!) as unknown) : undefined);
  const parsed = settingsSchema.parse({
    rpId: pick("rpId") ?? "",
    rpName: pick("rpName") ?? DEFAULTS.rpName,
    username: pick("username") ?? DEFAULTS.username,
    displayName: pick("displayName") ?? DEFAULTS.displayName,
    expectedOrigins: pick("expectedOrigins"),
    sessionEncryptionKey: pick("sessionEncryptionKey") ?? "",
    cloudflaredTunnel: pick("cloudflaredTunnel"),
    webhookTermStarted: pick("webhookTermStarted"),
  });
  if (!parsed.sessionEncryptionKey) {
    parsed.sessionEncryptionKey = generateSessionKey();
    persistSettings(parsed);
  }
  return parsed;
}

function persistSettings(source: Settings = getSettings()) {
  const entries: Array<[string, unknown]> = [
    ["rpId", source.rpId],
    ["rpName", source.rpName],
    ["username", source.username],
    ["displayName", source.displayName],
    ["expectedOrigins", source.expectedOrigins],
    ["sessionEncryptionKey", source.sessionEncryptionKey],
    ["cloudflaredTunnel", source.cloudflaredTunnel],
    ["webhookTermStarted", source.webhookTermStarted],
  ];
  for (const [key, value] of entries) {
    write(key, value === undefined || value === null ? null : JSON.stringify(value));
  }
}

/**
 * Lazily-loaded settings. `load()` runs on first access and is then cached, so importing
 * this module (e.g. for the `update` subcommand or `--help`) does not create the database.
 */
export const getSettings = once(load);

/** The app needs an rpId to authenticate anything, so its absence means "not set up yet". */
export function needsSetup() {
  const settings = getSettings();
  return !settings.rpId;
}

/**
 * Resolve the WebAuthn expected origin for an incoming request origin. When
 * `expectedOrigins` is configured it is enforced as an explicit allow-list; when it is
 * empty we fall back to any origin whose host is a suffix of `rpId` (covers the same-origin
 * case and local dev on `localhost`). Returns "" to signal rejection.
 */
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

export function updateEditable(patch: Partial<Settings>) {
  const settings = getSettings();
  if (patch.rpName !== undefined) settings.rpName = patch.rpName;
  if (patch.displayName !== undefined) settings.displayName = patch.displayName;
  if (patch.username !== undefined) settings.username = patch.username;
  if (patch.expectedOrigins !== undefined) settings.expectedOrigins = patch.expectedOrigins;
  if (patch.webhookTermStarted !== undefined) {
    settings.webhookTermStarted = patch.webhookTermStarted;
  }
  persistSettings();
  return settings;
}

export interface SetupInput extends Partial<Settings> {
  rpId: string;
}

/** The one place rpId can be written: first-run / reconfigure, gated by needsSetup. */
export function configure(input: SetupInput) {
  const settings = getSettings();
  settings.rpId = input.rpId;
  if (input.sessionEncryptionKey) settings.sessionEncryptionKey = input.sessionEncryptionKey;
  updateEditable(input);
  persistSettings();
}

/** Whether the cloudflared tunnel should restart when the server boots next. */
export function setCloudflaredTunnel(on: boolean) {
  const settings = getSettings();
  settings.cloudflaredTunnel = on;
  persistSettings();
  return settings.cloudflaredTunnel;
}
