import type { Device, DeviceInfo, RealtimeEvent, ServerState, UserInfo } from "@termcast/shared";
import { bus } from "../core/events";
import { getTunnelState } from "../services/cloudflared";
import { needsSetup, getSettings } from "../services/settings";
import { getCommands, getDevices } from "../services/store";
import { tabRegistry } from "../services/tab";

export function buildUserInfo(): UserInfo {
  return {
    needsSetup: needsSetup(),
    hasRegistered: getDevices().length > 0,
  };
}

function toDeviceInfo(device: Device): DeviceInfo {
  return {
    id: device.credential.id,
    name: device.name,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt,
  };
}

export async function buildSnapshot(): Promise<ServerState> {
  const settings = getSettings();
  const publicSettings = { ...settings };
  delete publicSettings.sessionEncryptionKey;
  return {
    user: buildUserInfo(),
    tunnel: { state: await getTunnelState() },
    settings: publicSettings,
    devices: getDevices().map(toDeviceInfo),
    commands: getCommands(),
    tabs: tabRegistry.list().map((tab) => tab.toInfo()),
  };
}

const clients = new Set<Bun.ServerWebSocket<any>>();

function send(ws: Bun.ServerWebSocket<any>, event: RealtimeEvent) {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    clients.delete(ws);
  }
}

function broadcast(event: RealtimeEvent) {
  for (const ws of clients) send(ws, event);
}

bus.on("tabs.upsert", (tabId) => {
  const tab = tabRegistry.get(tabId);
  if (tab) broadcast({ type: "tabs.upsert", tab: tab.toInfo() });
});
bus.on("tabs.remove", (tabId) => {
  broadcast({ type: "tabs.remove", id: tabId });
});
bus.on("commands.upsert", (command) => {
  broadcast({ type: "commands.upsert", command });
});
bus.on("commands.remove", (id) => {
  broadcast({ type: "commands.remove", id });
});
bus.on("devices.upsert", (device) => {
  broadcast({ type: "devices.upsert", device });
});
bus.on("devices.remove", (id) => {
  broadcast({ type: "devices.remove", id });
});
bus.on("settings", () => {
  const settings = getSettings();
  const publicSettings = { ...settings };
  delete publicSettings.sessionEncryptionKey;
  broadcast({ type: "settings", settings: publicSettings });
});
bus.on("tunnel", async () => {
  broadcast({ type: "tunnel", tunnel: { state: await getTunnelState() } });
});

export async function handleRealtimeOpen(ws: Bun.ServerWebSocket<any>) {
  clients.add(ws);
  send(ws, { type: "snapshot", state: await buildSnapshot() });
}

export function handleRealtimeClose(ws: Bun.ServerWebSocket<any>) {
  clients.delete(ws);
}
