import type { WsData } from "./handlers/terminal";
import { resolveWsAccess } from "./handlers/terminal";
import { verifyOwnerToken } from "./services/token";
import { websocket } from "./websocket";

export { websocket };

/**
 * Upgrades a WebSocket request if the path is a known WS endpoint.
 * Returns a 101 Response on success, or an error/404 Response otherwise.
 * Returns `null` if the request is not a WebSocket upgrade.
 */
export function tryUpgrade(req: Request, server: Bun.Server<WsData>): Response | null {
  if (
    !req.headers.get("connection")?.toLowerCase().includes("upgrade") ||
    req.headers.get("upgrade")?.toLowerCase() !== "websocket"
  ) {
    return null;
  }

  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    const access = resolveWsAccess(url);
    if (!access) return new Response("Forbidden", { status: 403 });
    const ip = req.headers.get("x-forwarded-for") || "";
    const ok = server.upgrade(req, {
      data: { type: "terminal", access, ip } as WsData,
    });
    return ok
      ? new Response(null, { status: 101 })
      : new Response("Upgrade failed", { status: 500 });
  }

  if (url.pathname === "/realtime") {
    const token = url.searchParams.get("token") ?? undefined;
    if (!verifyOwnerToken(token)) return new Response("Forbidden", { status: 403 });
    const ok = server.upgrade(req, {
      data: { type: "realtime" } as WsData,
    });
    return ok
      ? new Response(null, { status: 101 })
      : new Response("Upgrade failed", { status: 500 });
  }

  return new Response("Not found", { status: 404 });
}
