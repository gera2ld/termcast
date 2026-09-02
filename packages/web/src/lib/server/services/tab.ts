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

export interface IPtyClient extends IPtySettings {
  callbacks: IWebSocketCallbacks;
  isOwner: boolean;
  token?: string;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const defaultPtySettings: IPtySettings = {
  allowWrite: false,
};

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
  onGc?: () => void;
  onChange?: () => void;

  private process: Bun.Subprocess | undefined;
  private clients = new Set<IPtyClient>();
  private ownerSettings: IPtySettings = defaultPtySettings;
  private cols = 80;
  private rows = 24;
  private buffer = new TtyBuffer();
  private destroyScheduler: {
    time: number;
    timer?: NodeJS.Timeout;
  } = { time: Infinity };
  id: string;
  name = "";

  constructor(id: string) {
    this.id = id;
  }

  dispose() {
    const proc = this.process;
    if (proc?.pid) {
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

  get owner(): IPtySettings {
    return this.ownerSettings;
  }

  resolveReplayStart(since?: number) {
    return this.buffer.resolveReplayStart(since);
  }

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
    if (!this.clients.size) this.scheduleDestroy();
    this.onChange?.();
  }

  private evict(client: IPtyClient, message: string) {
    if (!this.clients.has(client)) return;
    client.callbacks.write({ id: this.id, type: "error", data: { message } });
    client.callbacks.end();
    this.detach(client);
  }

  disconnectToken(token: string) {
    for (const client of this.clients) {
      if (client.token === token) this.evict(client, "Access to this session was revoked.");
    }
  }

  setTokenAccess(token: string, allowWrite: boolean) {
    for (const client of this.clients) {
      if (client.token !== token) continue;
      client.allowWrite = allowWrite;
      client.callbacks.write({ id: this.id, type: "access", data: { canWrite: allowWrite } });
    }
  }

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
    for (const other of this.clients) {
      if (other !== client)
        other.callbacks.write({ id: this.id, type: "size", data: [columns, rows] });
    }
  }

  isActive() {
    return !!this.process;
  }

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

  close() {
    tabRegistry.remove(this.id);
  }
}

class TabRegistry {
  private map = new Map<string, Tab>();

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
