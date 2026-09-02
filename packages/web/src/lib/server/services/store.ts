import { getDb } from "./db";
import type { Command, Device } from "@termcast/shared";
import { parseArgs, formatArgs } from "@termcast/shared";
import { nanoid } from "nanoid";

export function getCommands(): Command[] {
  const db = getDb();
  const rows = db.query("SELECT id, label, args FROM commands").all() as {
    id: string;
    label: string;
    args: string;
  }[];
  if (rows.length === 0) {
    const id = nanoid(8);
    db.run("INSERT INTO commands (id, label, args) VALUES (?, ?, ?)", [id, "Run Bash", "bash"]);
    return [{ id, label: "Run Bash", args: ["bash"] }];
  }
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    args: parseArgs(r.args),
  }));
}

export function getCommand(id: string): Command | undefined {
  const db = getDb();
  const row = db.query("SELECT id, label, args FROM commands WHERE id = ?").get(id) as
    | { id: string; label: string; args: string }
    | undefined;
  return row ? { id: row.id, label: row.label, args: parseArgs(row.args) } : undefined;
}

export function addCommand(input: { label: string; args: string[] }): Command {
  const db = getDb();
  const id = nanoid(8);
  const serialized = formatArgs(input.args);
  db.run("INSERT INTO commands (id, label, args) VALUES (?, ?, ?)", [id, input.label, serialized]);
  return { id, label: input.label, args: input.args };
}

export async function updateCommand(
  id: string,
  patch: { label?: string; args?: string[] },
): Promise<Command> {
  const db = getDb();
  const existing = getCommand(id);
  if (!existing) throw new Error(`Command ${id} not found`);
  const label = patch.label ?? existing.label;
  const args = patch.args ?? existing.args;
  db.run("UPDATE commands SET label = ?, args = ? WHERE id = ?", [label, formatArgs(args), id]);
  return { id, label, args };
}

export function removeCommand(id: string): void {
  const db = getDb();
  db.run("DELETE FROM commands WHERE id = ?", [id]);
}

export function getDevices(): Device[] {
  const db = getDb();
  const rows = db
    .query("SELECT credential_id, name, created_at, last_used_at, credential FROM devices")
    .all() as {
    credential_id: string;
    name: string;
    created_at: number;
    last_used_at: number | null;
    credential: string;
  }[];
  return rows.map((r) => ({
    credential: JSON.parse(r.credential),
    name: r.name,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

export function addDevice(device: {
  credential: { id: string; publicKey: Uint8Array; counter: number };
  name: string;
  createdAt: string;
}): Device {
  const db = getDb();
  db.run("INSERT INTO devices (credential_id, name, created_at, credential) VALUES (?, ?, ?, ?)", [
    device.credential.id,
    device.name,
    new Date(device.createdAt).getTime(),
    JSON.stringify({
      id: device.credential.id,
      publicKey: device.credential.publicKey,
      counter: device.credential.counter,
    }),
  ]);
  return {
    credential: device.credential as any,
    name: device.name,
    createdAt: device.createdAt,
    lastUsedAt: null,
  };
}

export function removeDeviceById(credentialId: string): void {
  const db = getDb();
  db.run("DELETE FROM devices WHERE credential_id = ?", [credentialId]);
}

export function persistDevice(device: Device, patch: { name?: string; lastUsedAt?: string }): void {
  const db = getDb();
  if (patch.name !== undefined) {
    db.run("UPDATE devices SET name = ? WHERE credential_id = ?", [
      patch.name,
      device.credential.id,
    ]);
  }
  if (patch.lastUsedAt !== undefined) {
    db.run("UPDATE devices SET last_used_at = ? WHERE credential_id = ?", [
      new Date(patch.lastUsedAt).getTime(),
      device.credential.id,
    ]);
  }
}

export function clearDevices(): void {
  const db = getDb();
  db.run("DELETE FROM devices");
}
