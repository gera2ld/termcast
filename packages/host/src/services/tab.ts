import { b64encode } from "@gera2ld/common";
import { TtyBuffer, type TabInfo } from "@termcast/shared";
import { nanoid } from "nanoid";
import { bus } from "../core/events";
import type { IShareSession } from "../core/types";
import { getCommand } from "./store";
import { tokenProvider } from "./token";

export interface IWebSocketCallbacks {
  write(data: unknown): void;
  end(): void;
}

export interface IPtySettings {
  allowWrite: boolean;
}

/** One attached socket. The owner may type; a guest gets whatever its link grants. */
export interface IPtyClient extends IPtySettings {
  callbacks: IWebSocketCallbacks;
  /** The owner resizes the pty; everyone else mirrors its size. */
  isOwner: boolean;
  /** Share token this guest joined with, so revoking it can cut them off. */
  token?: string;
  /** When that token lapses; access ends with the link, not just new connections. */
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const defaultPtySettings: IPtySettings = {
  allowWrite: false,
};

// A pty outlives its sockets so a tab can be switched away from and come back to.
// Closing the tab disposes it immediately; this window only reaps ptys nobody returned to.
const DETACHED_PTY_TTL = 30 * 60_000;

function shareTokensFor(tabId: string) {
  return tokenProvider
    .entries<IShareSession>()
    .filter((tokenObj) => tokenObj.payload.tabId === tabId)
    .map(({ token, expireAt, payload }) => {
      const pty = tabRegistry.get(tabId)?.pty;
      return {
        token,
        expireAt,
        allowWrite: payload.allowWrite,
        maxConnections: payload.maxConnections,
        connections: pty?.countForToken(token) ?? 0,
      };
    });
}

export class PtyHandler {
  /** Set by the owning Tab; fires when the scheduled destroy elapses so the tab tears down. */
  onGc?: () => void;
  /** Set by the owning Tab; fires when connection count or liveness changes, to resync dashboards. */
  onChange?: () => void;

  private process: Bun.Subprocess | undefined;
  private clients = new Set<IPtyClient>();
  private ownerSettings: IPtySettings = defaultPtySettings;
  private cols = 80;
  private rows = 24;
  /** Rolling window of output, so a client attaching with a fresh terminal gets its scrollback. */
  private buffer = new TtyBuffer();
  private destroyScheduler: {
    time: number;
    timer?: NodeJS.Timeout;
  } = { time: Infinity };
  /** Equals the owning Tab id, so the websocket and share tokens share one identity. */
  id: string;
  /** Command this pty was started from, so a reloaded client can label its tab. */
  name = "";

  constructor(id: string) {
    this.id = id;
  }

  dispose() {
    const proc = this.process;
    if (proc?.pid) {
      // Interactive shells (e.g. bash) ignore SIGTERM, so a plain kill leaves the pty
      // running forever and `exited` never fires. Escalate to SIGKILL on the whole
      // process group so the session dies and the sockets can close on exit.
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    this.process = undefined;
  }

  scheduleDestroy(ttl: number = DETACHED_PTY_TTL) {
    const time = Date.now() + ttl;
    if (time < this.destroyScheduler.time) {
      this.destroyScheduler.time = time;
      clearTimeout(this.destroyScheduler.timer);
      this.destroyScheduler.timer = setTimeout(() => {
        this.destroyScheduler.timer = undefined;
        this.onGc?.();
      }, ttl);
    }
  }

  renew() {
    if (!this.process) throw new Error(`Invalid PtyHandler: ${this.id}`);
    this.destroyScheduler.time = Infinity;
    clearTimeout(this.destroyScheduler.timer);
    this.destroyScheduler.timer = undefined;
  }

  get connectionCount() {
    return this.clients.size;
  }

  /** What the owner was allowed to do, reapplied when they reattach. */
  get owner(): IPtySettings {
    return this.ownerSettings;
  }

  /**
   * Where a client's stream should start, given the offset it already has. `since` absent
   * means a fresh terminal, so it gets the whole window; `since` inside the retained window
   * resumes from there; anything outside (history evicted, or the client ahead of the stream)
   * is out of sync and restarts at the beginning of the window so the client discards its buffer.
   */
  resolveReplayStart(since?: number) {
    return this.buffer.resolveReplayStart(since);
  }

  /**
   * `since` is the client's own position in the output stream: absent for a terminal with
   * nothing on screen, so it gets the whole window, otherwise just what it missed.
   */
  attach(client: IPtyClient, since?: number) {
    this.clients.add(client);
    this.replayFrom(this.resolveReplayStart(since), client.callbacks);
    client.callbacks.write({ id: this.id, type: "size", data: [this.cols, this.rows] });
    if (client.expiresAt && client.expiresAt > 0) {
      const remaining = Math.max(0, client.expiresAt - Date.now());
      client.timer = setTimeout(
        () => this.evict(client, "This shared link has expired."),
        remaining,
      );
    }
    this.onChange?.();
  }

  detach(client: IPtyClient) {
    clearTimeout(client.timer);
    this.clients.delete(client);
    // Kept alive while anyone is still watching.
    if (!this.clients.size) this.scheduleDestroy();
    this.onChange?.();
  }

  private evict(client: IPtyClient, message: string) {
    if (!this.clients.has(client)) return;
    client.callbacks.write({ id: this.id, type: "error", data: { message } });
    client.callbacks.end();
    this.detach(client);
  }

  /** Cuts off the guests that joined with a token, so revoking takes effect at once. */
  disconnectToken(token: string) {
    for (const client of this.clients) {
      if (client.token === token) this.evict(client, "Access to this session was revoked.");
    }
  }

  /** Applies a token's new permission to the guests already using it. */
  setTokenAccess(token: string, allowWrite: boolean) {
    for (const client of this.clients) {
      if (client.token !== token) continue;
      client.allowWrite = allowWrite;
      client.callbacks.write({ id: this.id, type: "access", data: { canWrite: allowWrite } });
    }
  }

  /** Pushes a renewed deadline out to the guests already using the token. */
  setTokenExpiry(token: string, expiresAt: number) {
    for (const client of this.clients) {
      if (client.token !== token) continue;
      client.expiresAt = expiresAt;
      clearTimeout(client.timer);
      client.timer = setTimeout(
        () => this.evict(client, "This shared link has expired."),
        Math.max(0, expiresAt - Date.now()),
      );
      client.callbacks.write({
        id: this.id,
        type: "access",
        data: { canWrite: client.allowWrite, expiresAt },
      });
    }
  }

  private replayFrom(offset: number, callbacks: IWebSocketCallbacks) {
    const { pieces, startOffset } = this.buffer.slice(offset);
    let cursor = startOffset;
    for (const piece of pieces) {
      callbacks.write({
        id: this.id,
        type: "chunk",
        data: { offset: cursor, chunk: b64encode(piece) },
      });
      cursor += piece.length;
    }
  }

  private appendHistory(data: Uint8Array) {
    this.buffer.write(data, this.buffer.endOffset);
  }

  startPty(args: string[]) {
    if (this.process) {
      throw new Error("Pty already started");
    }
    // In case fails to start
    this.scheduleDestroy();
    this.name = args.join(" ");
    this.ownerSettings = { allowWrite: true };
    const ptyProc = Bun.spawn(args, {
      cwd: process.env.HOME,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
      terminal: {
        cols: 80,
        rows: 24,
        data: (_terminal, data) => {
          this.appendHistory(data);
          const message = {
            id: this.id,
            type: "chunk",
            data: { offset: this.buffer.endOffset - data.length, chunk: b64encode(data) },
          };
          for (const client of this.clients) client.callbacks.write(message);
        },
      },
    });
    ptyProc.exited.then(() => {
      this.process = undefined;
      for (const client of this.clients) {
        try {
          client.callbacks.write({ id: this.id, type: "end" });
        } finally {
          client.callbacks.end();
        }
      }
      this.clients.clear();
      this.scheduleDestroy(0);
      this.onChange?.();
    });
    this.process = ptyProc;
    // Started PTY, cancel scheduled destroy
    this.renew();
  }

  write(data: string, client: IPtyClient) {
    if (!client.allowWrite) return;
    this.process?.terminal?.write(data);
  }

  resize(columns: number, rows: number, client: IPtyClient) {
    if (!client.isOwner) return;
    this.cols = columns;
    this.rows = rows;
    this.process?.terminal?.resize(columns, rows);
    // Watchers mirror the size, so they see the same layout rather than a reflowed one.
    for (const other of this.clients) {
      if (other !== client)
        other.callbacks.write({ id: this.id, type: "size", data: [columns, rows] });
    }
  }

  isActive() {
    return !!this.process;
  }

  /** How many attached guests are currently on a given share link. */
  broadcastConnectionUpdate() {
    const tokens = shareTokensFor(this.id);
    const message = {
      id: this.id,
      type: "connections",
      data: { tokens },
    };
    for (const client of this.clients) {
      if (client.isOwner) {
        client.callbacks.write(message);
      }
    }
  }

  countForToken(token: string) {
    let count = 0;
    for (const client of this.clients) if (client.token === token) count++;
    return count;
  }
}

/**
 * A Tab is the stable, backend-owned unit the frontend addresses (route `/tty/{id}`).
 * It owns exactly one pty, so the tab id doubles as the pty id — there is no separate
 * scheme to keep in sync. Share links belong to a tab, not a pty looked up by string.
 */
export class Tab {
  readonly id: string;
  readonly pty: PtyHandler;
  readonly shareTokens = new Set<string>();
  readonly commandId?: string;
  readonly args: string[];
  readonly createdAt = Date.now();
  lastActivity = Date.now();

  constructor(opts: { id: string; commandId?: string; args: string[] }) {
    this.id = opts.id;
    this.commandId = opts.commandId;
    this.args = opts.args;
    this.pty = new PtyHandler(opts.id);
    this.pty.onGc = () => tabRegistry.remove(this.id);
    this.pty.onChange = () => bus.emit("tabs.upsert", this.id);
  }

  get isActive() {
    return this.pty.isActive();
  }

  get connectionCount() {
    return this.pty.connectionCount;
  }

  /** The payload broadcast to dashboards; the single source of truth for a tab's state. */
  toInfo(): TabInfo {
    return {
      id: this.id,
      commandId: this.commandId ?? null,
      args: this.args,
      label: this.commandId ? (getCommand(this.commandId)?.label ?? null) : null,
      status: this.isActive ? ("active" as const) : ("ended" as const),
      connections: this.connectionCount,
      createdAt: new Date(this.createdAt).toISOString(),
      lastActivity: new Date(this.lastActivity).toISOString(),
    };
  }

  touch() {
    this.lastActivity = Date.now();
  }

  addShareToken(token: string) {
    this.shareTokens.add(token);
  }

  removeShareToken(token: string) {
    this.shareTokens.delete(token);
  }

  /** Disposes the pty, revokes every share link, and drops the tab from the registry. */
  close() {
    tabRegistry.remove(this.id);
  }
}

class TabRegistry {
  private map = new Map<string, Tab>();

  /** Spawns the pty eagerly so the tab is live the moment it is returned. */
  open(input: { commandId?: string; args: string[] }): Tab {
    const id = nanoid();
    const tab = new Tab({
      id,
      commandId: input.commandId,
      args: input.args,
    });
    this.map.set(id, tab);
    try {
      tab.pty.startPty(input.args);
    } catch (err) {
      this.remove(id);
      throw err;
    }
    bus.emit("tabs.upsert", id);
    return tab;
  }

  register(tab: Tab) {
    this.map.set(tab.id, tab);
  }

  get(id: string): Tab | undefined {
    return this.map.get(id);
  }

  list(): Tab[] {
    return [...this.map.values()];
  }

  /** Tears down a tab: kill the pty, revoke its tokens, forget it. Idempotent. */
  remove(id: string) {
    const tab = this.map.get(id);
    if (!tab) return;
    this.map.delete(id);
    tab.pty.dispose();
    for (const token of tab.shareTokens) tokenProvider.remove(token);
    bus.emit("tabs.remove", id);
  }
}

export const tabRegistry = new TabRegistry();
