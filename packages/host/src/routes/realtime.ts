import type { Device, DeviceInfo, RealtimeEvent, ServerState, UserInfo } from "@termcast/shared";
import type { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { bus } from "../core/events";
import type { HonoEnv } from "../core/types";
import { getTunnelState } from "../services/cloudflared";
import { needsSetup, settings } from "../services/settings";
import { getCommands, getDevices } from "../services/store";
import { tabRegistry } from "../services/tab";
import { verifyOwnerToken } from "../services/token";

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

const clients = new Set<WSContext>();

function send(ws: WSContext, event: RealtimeEvent) {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    clients.delete(ws);
  }
}

function broadcast(event: RealtimeEvent) {
  for (const ws of clients) send(ws, event);
}

// Forward internal mutations to every connected dashboard.
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
  const publicSettings = { ...settings };
  delete publicSettings.sessionEncryptionKey;
  broadcast({ type: "settings", settings: publicSettings });
});
bus.on("tunnel", async () => {
  broadcast({ type: "tunnel", tunnel: { state: await getTunnelState() } });
});

/**
 * Mounts the realtime state channel at `/realtime`. A client receives a full `snapshot` on connect,
 * then incremental events as state changes.
 *
 * Auth is token-based: the owner token is passed as a `?token=` query param and verified against the
 * server-side owner-token store. Unauthorized upgrades are rejected with a real 403 before the
 * handshake completes — there is no loopback/trusted tier.
 */
export function setupRealtime(app: Hono<HonoEnv>) {
  app.get(
    "/realtime",
    async (c, next) => {
      // Reject unauthorized upgrades with a real 403 before the handshake completes.
      if (!verifyOwnerToken(c.req.query("token"))) {
        return c.text("Forbidden", 403);
      }
      await next();
    },
    upgradeWebSocket(() => {
      return {
        async onOpen(_event, ws) {
          clients.add(ws);
          send(ws, { type: "snapshot", state: await buildSnapshot() });
        },
        onClose(_event, ws) {
          clients.delete(ws);
        },
      };
    }),
  );
}
