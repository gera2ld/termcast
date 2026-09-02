import type { WsClientMessage } from "@termcast/shared";
import { getSettings } from "../services/settings";
import { logError } from "../core/log";
import {
  type IWebSocketCallbacks,
  type IPtyClient,
  PtyHandler,
  tabRegistry,
} from "../services/tab";
import { tokenProvider, verifyOwnerToken } from "../services/token";
import type { IShareSession, ITermToken } from "../core/types";

interface WsAccess {
  role: "owner" | "guest";
  share?: ITermToken<IShareSession>;
}

export function resolveWsAccess(url: URL): WsAccess | null {
  const token = url.searchParams.get("token");
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

interface TerminalWsData {
  type: "terminal";
  access: WsAccess;
  ip: string;
}

export type WsData = TerminalWsData | { type: "realtime" };

interface ConnState {
  handler?: PtyHandler;
  client?: IPtyClient;
  ownerClient?: IPtyClient;
  callbacks?: IWebSocketCallbacks;
  notifiedStarted: boolean;
}

function getConnState(ws: Bun.ServerWebSocket<WsData>): ConnState {
  if (!(ws as any)._connState) {
    (ws as any)._connState = { notifiedStarted: false };
  }
  return (ws as any)._connState;
}

export function handleTerminalMessage(ws: Bun.ServerWebSocket<WsData>, message: string | Buffer) {
  const data = ws.data as TerminalWsData;
  const { access, ip } = data;
  const state = getConnState(ws);

  state.callbacks ||= {
    write(d) {
      ws.send(JSON.stringify(d));
    },
    end() {
      ws.close();
    },
  };

  let msg: WsClientMessage;
  try {
    msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
  } catch {
    return;
  }
  const { id, type } = msg;

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
        if (target.countForToken(access.share!.token) >= access.share!.payload.maxConnections) {
          throw new Error("This link is already at its connection limit.");
        }
      }

      target.renew();

      if (state.handler !== target) {
        if (state.handler && state.client) {
          state.handler.detach(state.client);
          state.handler.broadcastConnectionUpdate();
        }
        state.handler = target;
        if (access.role === "owner") {
          if (!state.ownerClient) {
            state.ownerClient = {
              callbacks: state.callbacks,
              allowWrite: target.owner.allowWrite,
              isOwner: true,
            };
          }
          state.client = state.ownerClient;
        } else {
          state.client = {
            callbacks: state.callbacks,
            token: access.share!.token,
            expiresAt: access.share!.expireAt,
            allowWrite: access.share!.payload.allowWrite,
            isOwner: false,
          };
        }
      } else if (!state.client) {
        throw new Error("This connection is missing its tab.");
      }

      const start = state.handler.resolveReplayStart(msg.data.since);
      state.callbacks.write({
        id: state.handler.id,
        type: "start",
        data: {
          offset: start,
          canWrite: state.client.allowWrite,
          expiresAt: state.client.expiresAt ?? 0,
        },
      });
      state.handler.attach(state.client, msg.data.since);
      state.handler.broadcastConnectionUpdate();

      if (!state.notifiedStarted) {
        state.notifiedStarted = true;
        notify("term.started", {
          ip,
          rpName: settings.rpName,
        });
      }
    } catch (err) {
      state.handler = undefined;
      state.client = undefined;
      state.callbacks!.write({
        id,
        type: "error",
        data: { message: (err as Error).message },
      });
      state.callbacks!.end();
    }
    return;
  }

  if (type === "leave") {
    if (state.handler && state.client && state.handler.id === id) {
      state.handler.detach(state.client);
      state.handler.broadcastConnectionUpdate();
      state.handler = undefined;
      state.client = undefined;
    }
    return;
  }

  if (!state.handler?.isActive() || !state.client) return;

  switch (type) {
    case "resize": {
      const [columns, rows] = msg.data;
      state.handler.resize(columns, rows, state.client);
      break;
    }
    case "data": {
      state.handler.write(msg.data, state.client);
      break;
    }
  }
}

export function handleTerminalClose(ws: Bun.ServerWebSocket<WsData>) {
  const state = getConnState(ws);
  if (state.handler && state.client) {
    state.handler.detach(state.client);
    state.handler.broadcastConnectionUpdate();
  }
}

async function notify(event: string, notiArgs: Record<string, string>) {
  if (event !== "term.started") return;
  const settings = getSettings();
  const url = settings.webhookTermStarted;
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
