import type { Handle } from "@sveltejs/kit";
import type { WsData } from "$lib/server/handlers/terminal";
import { tryUpgrade, websocket } from "$lib/server/ws";
import { PORT } from "$lib/server/core/config";
import { getSettings, needsSetup } from "$lib/server/services/settings";
import { signGrantToken } from "@termcast/shared/server";
import { startTunnel, stopTunnel } from "$lib/server/services/cloudflared";
import { tabRegistry } from "$lib/server/services/tab";

export const handle: Handle = async ({ event, resolve }) => {
  const platform = event.platform as { server?: Bun.Server<WsData>; request?: Request } | undefined;
  const server = platform?.server;
  if (server) {
    const req = platform?.request ?? event.request;
    const res = tryUpgrade(req, server);
    if (res) return res;
  }
  return resolve(event);
};

export { websocket };

export async function init() {
  try {
    const settings = getSettings();
    if (needsSetup()) {
      const token = await signGrantToken();
      const base = import.meta.env.DEV ? "http://localhost:5173" : `http://localhost:${PORT}`;
      const ownerUrl = `${base}/?grant=${token}`;
      console.log("TermCast isn't set up yet.");
      console.log(`Owner URL (open within 5min to sign in): ${ownerUrl}`);
    }
    if (settings.cloudflaredTunnel) {
      const state = await startTunnel(PORT);
      if (state.enabled && state.url) console.log(`Public tunnel: ${state.url}`);
      else console.warn(`Tunnel failed to start: ${state.error ?? "unknown"}`);
    }
  } catch (err) {
    // A fresh database is not yet configured; the owner URL is generated during setup.
    logErrorOnce(err);
  }

  process.on("sveltekit:shutdown", () => {
    for (const tab of tabRegistry.list()) {
      tab.pty.dispose();
    }
    stopTunnel().finally(() => process.exit(0));
  });
}

let loggedError = false;
function logErrorOnce(err: unknown) {
  if (loggedError) return;
  loggedError = true;
  console.warn(`Startup setup skipped: ${(err as Error).message}`);
}
