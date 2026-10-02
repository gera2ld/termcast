import { TtyBuffer, type TabInfo, type WsServerMessage } from "@termcast/shared";
import { nanoid } from "nanoid";
import { bus } from "../core/events";
import type { IShareSession } from "../core/types";
import { getCommand } from "./store";
import { tokenProvider } from "./token";

export interface IWebSocketCallbacks {
  write(message: WsServerMessage): void;
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

/**
 * How long pty output is held before it is fanned out, so a burst of reads becomes one
 * frame. This also caps how often a client repaints: output arriving faster than this is
 * merged, which is invisible for the sub-20fps animations terminals usually draw and worth
 * roughly 40% of the bytes for the ones that do not.
 */
const COALESCE_MS = 32;
/**
 * A read arriving within this of the last flush means output is still streaming, so it is
 * queued rather than sent alone. Sized to be comfortably wider than {@link COALESCE_MS} so
 * a steady stream stays merged, while an idle pty — a shell waiting on input — is treated
 * as idle and its first read goes out immediately.
 */
const BURST_MS = 64;
/** A batch this large is sent immediately rather than waiting for the timer. */
const COALESCE_BYTES = 32 * 1024;

function concat(parts: Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The pty runs the user's shell, not the server. It gets a minimal environment so terminal
 * identity (`KITTY_WINDOW_ID`, `TERMINFO`, `TERM_PROGRAM`, ...) and server secrets such as
 * `GITHUB_TOKEN` never reach it. Anything else belongs in the user's own rc files.
 */
const INHERITED_ENV_VARS = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SSH_AUTH_SOCK",
  "EDITOR",
  "VISUAL",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
] as const;

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, TERM: "xterm-256color" };
}

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
  /** Reads held back for the current coalescing window, oldest first. */
  private pending: Uint8Array[] = [];
  /** Stream offset of `pending[0]`, so the batch keeps its position in the byte stream. */
  private pendingOffset = 0;
  private pendingBytes = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private lastFlushAt = 0;
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
    // Nothing is left to deliver once the pty is being killed, and a queued timer would
    // otherwise keep the handler alive until it fired.
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pending = [];
    this.pendingBytes = 0;
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
    // Flush before the client joins the set: it would otherwise receive the pending batch
    // twice — once from this flush, and again from the replay that follows.
    this.flush();
    this.clients.add(client);
    this.replayFrom(this.resolveReplayStart(since), client.callbacks);
    client.callbacks.write({ type: "size", cols: this.cols, rows: this.rows });
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
    client.callbacks.write({ type: "error", message });
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
      client.callbacks.write({ type: "access", canWrite: allowWrite, expiresAt: 0 });
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
        type: "access",
        canWrite: client.allowWrite,
        expiresAt,
      });
    }
  }

  private replayFrom(offset: number, callbacks: IWebSocketCallbacks) {
    const { pieces, startOffset } = this.buffer.slice(offset);
    let cursor = startOffset;
    for (const piece of pieces) {
      callbacks.write({ type: "chunk", offset: cursor, data: piece });
      cursor += piece.length;
    }
  }

  private appendHistory(data: Uint8Array) {
    this.buffer.write(data, this.buffer.endOffset);
  }

  /**
   * Holds a pty read back briefly so a burst becomes one frame. The read is already in
   * `buffer`, so replay and resume are unaffected — only the fan-out is delayed.
   *
   * A read that arrives while output is idle is sent straight away: interactive typing is
   * sparse, and making the first fragment wait would add latency where nothing is gained.
   */
  private enqueue(data: Uint8Array, offset: number) {
    if (this.pendingBytes === 0) this.pendingOffset = offset;
    this.pending.push(data);
    this.pendingBytes += data.length;

    const streaming = Date.now() - this.lastFlushAt < BURST_MS;
    if (this.pendingBytes >= COALESCE_BYTES || !streaming) {
      this.flush();
      return;
    }
    this.flushTimer ??= setTimeout(() => this.flush(), COALESCE_MS);
  }

  private flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pendingBytes === 0) return;

    const message: WsServerMessage = {
      type: "chunk",
      offset: this.pendingOffset,
      data: concat(this.pending, this.pendingBytes),
    };
    this.pending = [];
    this.pendingBytes = 0;
    this.lastFlushAt = Date.now();
    for (const client of this.clients) client.callbacks.write(message);
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
      env: childEnv(),
      terminal: {
        cols: 80,
        rows: 24,
        data: (_terminal, data) => {
          const offset = this.buffer.endOffset;
          this.appendHistory(data);
          this.enqueue(data, offset);
        },
      },
    });
    ptyProc.exited.then(() => {
      this.process = undefined;
      this.flush();
      for (const client of this.clients) {
        try {
          client.callbacks.write({ type: "end" });
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
      if (other !== client) other.callbacks.write({ type: "size", cols: columns, rows: rows });
    }
  }

  isActive() {
    return !!this.process;
  }

  broadcastConnectionUpdate() {
    const tokens = shareTokensFor(this.id);
    const message: WsServerMessage = { type: "connections", tokens };
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
