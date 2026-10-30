import {
  decodeServerMessage,
  encodeClientMessage,
  TtyBuffer,
  type WsClientMessage,
  type WsServerMessage,
} from "@termcast/shared";
import type { GlobalState } from "./global.svelte";
import { getToken } from "./orpc-client";

/** A mounted xterm for one tab. The socket drives it; the view only renders. */
export interface TtyTerminal {
  write(data: Uint8Array): void;
  reset(): void;
  /** Fits the terminal to its view and returns the resulting size. */
  fit(): { cols: number; rows: number };
  /** Mirrors the host pty's size; only a guest is driven this way. */
  resize(cols: number, rows: number): void;
}

/** The owner may switch between tabs; a guest's share token pins it to one. */
export type TtyAuth = { role: "owner" } | { role: "guest"; token: string };

/**
 * The terminal WebSocket and everything it drives: which tab the host streams, the per-tab
 * buffer and connection state, and the mounted terminals. The UI only says which tab it
 * wants with `setActive` and mounts terminals; it never sends `select`/`leave` itself.
 *
 * The host is the only source of truth about which tab this socket is bound to. A select
 * just records what was asked for (`requested`); `committed` only advances when a `start`
 * for that exact tab arrives. Frames that turn out to belong to a superseded stream are
 * dropped while `discarding` is set, which is what makes a rapid tab switch land on the
 * right terminal instead of interleaving two streams into one buffer.
 *
 * The owner's socket survives navigation, so it authenticates once; a guest gets one per
 * share page.
 */
export class TtySocket {
  private socket: WebSocket | undefined;
  private terminals = new Map<string, TtyTerminal>();
  /** The tab the UI wants attached, or null for none. */
  private active: string | null = null;
  /** What the last select/leave asked for: the tab the host is bound to once it catches up. */
  private requested: string | null = null;
  /** The `since` sent with that select, to tell a resume overlap from a host-side restart. */
  private requestedSince = 0;
  /** The tab arriving frames belong to. Only ever set from a matching `start`. */
  private committed: string | null = null;
  /** Set when a `start` named a tab we did not ask for: drop frames until the next one. */
  private discarding = false;
  /** A tab that errored or ended; not re-selected on reconnect until it is activated again. */
  private halted: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private state: GlobalState,
    private auth: TtyAuth,
  ) {}

  get isOwner() {
    return this.auth.role === "owner";
  }

  connect() {
    if (this.socket || this.stopped) return;
    const token = this.auth.role === "owner" ? getToken() : this.auth.token;
    if (!token) return;
    if (this.auth.role === "guest") {
      const conn = this.state.connections[this.auth.token];
      if (conn) conn.status = "connecting";
    }
    const wsOrigin = window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${wsOrigin}/ws?token=${encodeURIComponent(token)}`);
    // Terminal frames are binary; without this the browser hands over Blobs instead.
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.setConnected(true);
      this.sync();
    });

    socket.addEventListener("message", (event) => {
      let msg: WsServerMessage;
      try {
        msg = decodeServerMessage(new Uint8Array(event.data as ArrayBuffer));
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      // The host detached us with the socket; the next open re-selects `active`.
      this.requested = null;
      this.committed = null;
      this.discarding = false;
      this.setConnected(false);
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, 1000);
    });
  }

  /** Sets the tab the host should stream, or null to stream none. */
  setActive(id: string | null) {
    if (id === this.active) return;
    this.active = id;
    this.halted = null;
    this.sync();
  }

  /**
   * Registers a tab's terminal and re-renders its buffered scrollback into it. Returns the
   * matching unmount.
   */
  mount(id: string, terminal: TtyTerminal): () => void {
    this.terminals.set(id, terminal);
    const buf = this.state.connections[id]?.buffer;
    if (buf?.size) {
      terminal.reset();
      for (const piece of buf.slice().pieces) terminal.write(piece);
    }
    if (id === this.committed) this.reportSize(id, terminal);
    return () => {
      if (this.terminals.get(id) === terminal) this.terminals.delete(id);
    };
  }

  /** Forwards keyboard input; dropped unless the host is bound to this tab. */
  input(id: string, data: string) {
    if (id === this.requested) this.send({ type: "data", data });
  }

  /** Forwards a terminal resize; only the owner sizes the pty, and only the bound tab's. */
  resize(id: string, cols: number, rows: number) {
    if (this.isOwner && id === this.requested) this.send({ type: "resize", cols, rows });
  }

  /** Stops for good (logout, or leaving a share page): no reconnect, drop the socket. */
  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.requested = null;
    this.committed = null;
    this.discarding = false;
    this.setConnected(false);
    this.socket?.close();
    this.socket = undefined;
  }

  /**
   * Brings the host's binding in line with `active`. Sends only on an actual change:
   * re-selecting re-fits the pty, and the SIGWINCH makes TUI apps repaint from scratch.
   */
  private sync() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const target = this.active === this.halted ? null : this.active;
    if (target === this.requested) return;
    this.requested = target;
    if (target) {
      // The host rebinds on select, so switching tabs needs no leave first.
      this.requestedSince = this.state.connections[target]?.buffer?.endOffset ?? 0;
      this.send({ type: "select", id: target, since: this.requestedSince });
    } else {
      // Frames still in flight are dropped; the next select resumes from what was kept.
      this.committed = null;
      this.discarding = false;
      this.send({ type: "leave" });
    }
  }

  private handleMessage(msg: WsServerMessage) {
    if (msg.type === "error") {
      // A failed select errors before any start, so it belongs to the tab asked for.
      const id = this.requested ?? this.committed;
      const conn = id ? this.state.connections[id] : undefined;
      if (id && conn) {
        conn.error = msg.message;
        this.halt(id);
      }
      return;
    }
    if (msg.type === "start") {
      // A guest's socket serves one tab, which the host names by its real id, not the token.
      if (!this.isOwner || msg.id === this.requested) {
        this.committed = this.requested;
        this.discarding = false;
      } else {
        // A start for a tab we already moved past; its frames must not reach any view.
        this.discarding = true;
        return;
      }
    }
    if (this.discarding || !this.committed) return;
    this.apply(this.committed, msg);
  }

  /** Applies a frame from the committed stream to its tab's state and terminal. */
  private apply(id: string, msg: WsServerMessage) {
    const conn = this.state.connections[id];
    if (!conn) return;
    const terminal = this.terminals.get(id);
    switch (msg.type) {
      case "start": {
        const buf = (conn.buffer ??= new TtyBuffer());
        if (msg.offset !== this.requestedSince) {
          // The host no longer has what we have (out of sync): discard both.
          buf.clear(msg.offset);
          terminal?.reset();
        }
        conn.error = undefined;
        conn.canWrite = msg.canWrite;
        conn.expiresAt = msg.expiresAt || undefined;
        conn.status = "connected";
        if (terminal) this.reportSize(id, terminal);
        break;
      }
      case "chunk": {
        const buf = (conn.buffer ??= new TtyBuffer());
        // A resume can overlap what an earlier stream already delivered; keep only new bytes.
        const overlap = Math.max(0, buf.endOffset - msg.offset);
        if (overlap >= msg.data.length) break;
        const data = msg.data.subarray(overlap);
        buf.write(data, msg.offset + overlap);
        terminal?.write(data);
        break;
      }
      case "size": {
        // Watchers mirror the owner's terminal rather than reflowing to their window.
        if (!this.isOwner) terminal?.resize(msg.cols, msg.rows);
        break;
      }
      case "end": {
        conn.status = "disconnected";
        this.halt(id);
        break;
      }
      case "access": {
        conn.canWrite = msg.canWrite;
        conn.expiresAt = msg.expiresAt || undefined;
        break;
      }
      case "connections": {
        conn.shareTokens = msg.tokens;
        break;
      }
    }
  }

  /** Tells the host the bound tab's size, so the pty matches what the owner sees. */
  private reportSize(id: string, terminal: TtyTerminal) {
    if (!this.isOwner || id !== this.requested) return;
    const { cols, rows } = terminal.fit();
    this.send({ type: "resize", cols, rows });
  }

  /** Keeps a dead tab from being re-selected on every reconnect; a guest has nothing else. */
  private halt(id: string) {
    if (this.isOwner) this.halted = id;
    else this.stopped = true;
  }

  private setConnected(connected: boolean) {
    if (this.auth.role === "owner") {
      this.state.wsConnected = connected;
    } else {
      const conn = this.state.connections[this.auth.token];
      if (conn) conn.wsConnected = connected;
    }
  }

  private send(msg: WsClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      // Copied into a plain ArrayBuffer: the codec's views may sit on a larger buffer,
      // which `WebSocket.send` will not accept as a `BufferSource`.
      this.socket.send(encodeClientMessage(msg).slice().buffer);
    }
  }
}
