import type { Context, Hono } from "hono";
import { getConnInfo, upgradeWebSocket } from "hono/bun";
import { getSettings } from "../services/settings";
import { logError } from "../core/log";
import {
  type IWebSocketCallbacks,
  type IPtyClient,
  PtyHandler,
  tabRegistry,
} from "../services/tab";
import { tokenProvider, verifyOwnerToken } from "../services/token";
import type { WsClientMessage } from "@termcast/shared";
import type { HonoEnv, IShareSession, ITermToken } from "../core/types";

interface WsAccess {
  role: "owner" | "guest";
  share?: ITermToken<IShareSession>;
}

/**
 * Decides whether a `/ws` upgrade may proceed and, if so, what identity it connects as.
 * Called before the upgrade so unauthorized requests can be rejected with a 403.
 * An owner authenticates with a single `?token=` — there is no tab id in the URL;
 * tab selection happens in-protocol via `select`. A guest connects with a share token
 * that is inherently tab-scoped.
 */
function resolveWsAccess(c: Context<HonoEnv>): WsAccess | null {
  const token = c.req.query("token");
  if (!token) return null;
  if (verifyOwnerToken(token)) return { role: "owner" };
  try {
    const share = tokenProvider.verify<IShareSession>(token);
    if (!share.payload.tabId) return null;
    return { role: "guest", share };
  } catch {
    return null;
  }
}

export function setUpWebSocket(app: Hono<HonoEnv>) {
  app.get(
    "/ws",
    async (c, next) => {
      // Reject unauthorized upgrades with a real 403 before the handshake completes.
      if (!resolveWsAccess(c)) return c.text("Forbidden", 403);
      await next();
    },
    upgradeWebSocket((c) => {
      const info = getConnInfo(c);
      const access = resolveWsAccess(c)!;
      const ip = c.req.header("x-forwarded-for") || info.remote.address || "";
      let handler: PtyHandler | undefined;
      let client: IPtyClient | undefined;
      /** Reusable owner client: one socket, may select any tab. */
      let ownerClient: IPtyClient | undefined;
      let callbacks: IWebSocketCallbacks | undefined;
      let notifiedStarted = false;

      return {
        onMessage(event, ws) {
          callbacks ||= {
            write(data) {
              ws.send(JSON.stringify(data));
            },
            end() {
              ws.close();
            },
          };

          let message: WsClientMessage;
          try {
            message = JSON.parse(event.data as string);
          } catch {
            return;
          }
          const { id, type } = message;

          if (type === "select") {
            try {
              const settings = getSettings();
              const tabId = access.role === "owner" ? id : access.share!.payload.tabId;
              if (!tabId) throw new Error("This connection is missing its tab.");

              const tab = tabRegistry.get(tabId);
              if (!tab) throw new Error("This connection is no longer available.");

              const target = tab.pty;
              if (!target.isActive()) throw new Error("This session has ended.");

              if (access.role === "guest") {
                if (
                  target.countForToken(access.share!.token) >= access.share!.payload.maxConnections
                ) {
                  throw new Error("This link is already at its connection limit.");
                }
              }

              target.renew();

              if (handler !== target) {
                if (handler && client) {
                  handler.detach(client);
                  handler.broadcastConnectionUpdate();
                }
                handler = target;
                client =
                  access.role === "owner"
                    ? (ownerClient ??= {
                        callbacks,
                        ...handler.owner,
                        isOwner: true,
                      })
                    : {
                        callbacks,
                        token: access.share!.token,
                        expiresAt: access.share!.expireAt,
                        allowWrite: access.share!.payload.allowWrite,
                        isOwner: false,
                      };
              } else if (!client) {
                throw new Error("This connection is missing its tab.");
              }

              const start = handler.resolveReplayStart(message.data.since);
              callbacks.write({
                id: handler.id,
                type: "start",
                data: {
                  offset: start,
                  canWrite: client.allowWrite,
                  expiresAt: client.expiresAt ?? 0,
                },
              });
              handler.attach(client, message.data.since);
              handler.broadcastConnectionUpdate();

              if (!notifiedStarted) {
                notifiedStarted = true;
                notify("term.started", {
                  ip,
                  rpName: settings.rpName,
                });
              }
            } catch (err) {
              handler = undefined;
              client = undefined;
              callbacks.write({
                id,
                type: "error",
                data: { message: (err as Error).message },
              });
              callbacks.end();
            }
            return;
          }

          if (type === "leave") {
            if (handler && client && handler.id === id) {
              handler.detach(client);
              handler.broadcastConnectionUpdate();
              handler = undefined;
              client = undefined;
            }
            return;
          }

          // data + resize require an active handler
          if (!handler?.isActive() || !client) return;

          switch (type) {
            case "resize": {
              const [columns, rows] = message.data;
              handler.resize(columns, rows, client);
              break;
            }
            case "data": {
              handler.write(message.data, client);
              break;
            }
          }
        },
        onClose() {
          if (handler && client) {
            handler.detach(client);
            handler.broadcastConnectionUpdate();
          }
        },
      };
    }),
  );
}

async function notify(event: string, notiArgs: Record<string, string>) {
  if (event !== "term.started") return;
  const settings = getSettings();
  const url = settings.webhookTermStarted;
  if (!url) return;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, ...notiArgs }),
    });
    logError(`Notified ${event} for ${notiArgs.ip}, http code: ${res.status}`);
  } catch (e) {
    logError("Failed to notify", e);
  }
}
