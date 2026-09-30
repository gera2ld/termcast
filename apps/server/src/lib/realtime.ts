import type { RealtimeEvent } from "@termcast/shared";
import { getToken } from "./orpc-client";
import type { GlobalState } from "./global.svelte";

/** Opens the `/realtime` socket and applies the server's state stream onto `state`.
 * Resolves once the initial snapshot has been applied, and reconnects on drop. Idempotent:
 * a second call while a socket is already live is a no-op, so it is safe to invoke from
 * multiple places (the initial load and the auth-effect). */
export function connectRealtime(state: GlobalState): Promise<void> {
  if (state.realtimeConnected) return Promise.resolve();
  state.realtimeConnected = true;
  return new Promise((resolve, reject) => {
    const wsOrigin = window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(
      `${wsOrigin}/realtime?token=${encodeURIComponent(getToken() ?? "")}`,
    );
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    socket.addEventListener("open", () => {
      // Snapshot arrives immediately; applySnapshot resolves the promise.
    });

    socket.addEventListener("message", (event) => {
      let msg: RealtimeEvent;
      try {
        msg = JSON.parse(event.data) as RealtimeEvent;
      } catch {
        return;
      }
      switch (msg.type) {
        case "snapshot":
          state.applySnapshot(msg.state);
          done();
          break;
        case "tabs.upsert":
          state.upsertTab(msg.tab);
          break;
        case "tabs.remove":
          state.removeTab(msg.id);
          break;
        case "commands.upsert":
          state.upsertCommand(msg.command);
          break;
        case "commands.remove":
          state.removeCommand(msg.id);
          break;
        case "devices.upsert":
          state.upsertDevice(msg.device);
          break;
        case "devices.remove":
          state.removeDevice(msg.id);
          break;
        case "settings":
          state.setSettings(msg.settings);
          break;
        case "tunnel":
          state.setTunnel(msg.tunnel.state);
          break;
      }
    });

    socket.addEventListener("error", () => {
      if (!settled) reject(new Error("Realtime connection failed"));
    });

    socket.addEventListener("close", () => {
      state.realtimeConnected = false;
      if (settled) {
        // The owner token is gone (logout) — stop trying.
        if (getToken()) {
          setTimeout(() => void connectRealtime(state), 1000);
        }
      }
    });
  });
}
