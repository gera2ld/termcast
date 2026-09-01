import type { Command, Device } from "@termcast/shared";
import { commandSchema, deviceSchema, formatArgs, serializeCredential } from "@termcast/shared";
import { nanoid } from "nanoid";
import { stripUndefined } from "../core/util";
import { getDb } from "./db";

// Seeded on a fresh install (when no commands exist) so the app is usable immediately.
const DEFAULT_COMMANDS: Command[] = [
  {
    id: "",
    label: "Run Bash",
    args: ["bash"],
  },
];

// ---- commands ----

export function getCommands(): Command[] {
  const commandRows = getDb()
    .query<
      {
        id: string;
        label: string;
        args: string;
      },
      []
    >("SELECT id, label, args FROM commands ORDER BY args")
    .all();
  let commandList = commandRows.map((row) => commandSchema.parse(row));

  // A fresh install has no commands yet; seed the default so the app is usable at once.
  if (!commandList.length) {
    commandList = DEFAULT_COMMANDS.map(addCommand);
  }
  return commandList;
}

export function getCommand(id: string) {
  const commandRow = getDb()
    .query<
      {
        id: string;
        label: string;
        args: string;
      },
      [string]
    >("SELECT id, label, args FROM commands WHERE id=?")
    .get(id);
  return commandRow && commandSchema.parse(commandRow);
}

export function addCommand(command: Command) {
  command = {
    ...command,
    id: command.id || nanoid(8),
  };
  getDb().run("INSERT INTO commands (id, label, args) VALUES (?, ?, ?)", [
    command.id,
    command.label,
    formatArgs(command.args),
  ]);
  return command;
}

export async function updateCommand(id: string, patch: Partial<Command>) {
  let command = getCommand(id);
  if (!command) throw new Error(`Command not found: ${id}`);
  delete patch.id;
  command = commandSchema.parse({ ...command, ...stripUndefined(patch) });
  getDb().run("UPDATE commands SET label = ?, args = ? WHERE id = ?", [
    command.label,
    formatArgs(command.args),
    id,
  ]);
  return command;
}

export async function removeCommand(id: string) {
  getDb().run("DELETE FROM commands WHERE id = ?", [id]);
}

// ---- Devices ----

export function getDevices(): Device[] {
  const deviceRows = getDb()
    .query<
      {
        name: string;
        created_at: number;
        last_used_at: number | null;
        credential: string;
      },
      []
    >("SELECT name, created_at, last_used_at, credential FROM devices ORDER BY created_at")
    .all();
  const deviceList = deviceRows.map((row) =>
    deviceSchema.parse({
      name: row.name,
      credential: row.credential,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }),
  );
  return deviceList;
}

export async function addDevice(device: Device) {
  getDb().run(
    "INSERT INTO devices (credential_id, name, created_at, last_used_at, credential) VALUES (?, ?, ?, ?, ?)",
    [
      device.credential.id,
      device.name,
      device.createdAt,
      device.lastUsedAt ?? null,
      serializeCredential(device.credential),
    ],
  );
  return device;
}

export async function removeDeviceById(id: string) {
  getDb().run("DELETE FROM devices WHERE credential_id = ?", [id]);
}

export async function persistDevice(device: Device, patch: Partial<Device>) {
  delete patch.credential;
  device = deviceSchema.parse({
    ...device,
    ...stripUndefined(patch),
  });
  getDb().run(
    "UPDATE devices SET name = ?, last_used_at = ?, credential = ? WHERE credential_id = ?",
    [
      device.name,
      device.lastUsedAt ?? null,
      serializeCredential(device.credential),
      device.credential.id,
    ],
  );
}

/** Called by the /setup confirm: wipes every registered passkey. */
export async function clearDevices() {
  getDb().run("DELETE FROM devices");
}
