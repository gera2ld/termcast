import {
  decodeServerMessage,
  encodeClientMessage,
  type WsClientMessage,
  type WsServerMessage,
} from "@termcast/shared";
import type { GlobalState } from "./global.svelte";
import { getToken } from "./orpc-client";

/** A mounted terminal view; the manager routes messages for its tab to it. */
export interface TtyConsumer {
  id: string;
  onMessage(msg: WsServerMessage): void;
}

/**
 * One owner WebSocket shared across all tabs. A single tab streams at a time: `select`
 * asks the host to attach to a pty (resuming from the client's buffer offset), `leave`
 * detaches it, and the host names the tab once per stream in its `start` message.
 *
 * The host is the only source of truth about which tab this socket is bound to. `select`
 * therefore just records what was asked for; the committed `consumer` only advances when a
 * `start` for that exact tab arrives. Frames that turn out to belong to a superseded stream
 * are dropped while `discarding` is set, which is what makes a rapid tab switch land on the
 * right terminal instead of interleaving two streams into one buffer.
 *
 * The socket survives navigation, so the owner authenticates once; guests keep their own
 * per-tab socket.
 */
export class TtySocket {
  private socket: WebSocket | undefined;
  /** The committed view. Only ever set from a matching `start`. */
  private consumer: TtyConsumer | undefined;
  /** The view asked for but not yet confirmed by the host. */
  private pending: TtyConsumer | undefined;
  /** Set when a `start` named a tab we did not ask for: drop frames until the next one. */
  private discarding = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private state: GlobalState) {}

  connect() {
    if (this.socket || this.stopped) return;
    const token = getToken();
    if (!token) return;
    const wsOrigin = window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${wsOrigin}/ws?token=${encodeURIComponent(token)}`);
    // Terminal frames are binary; without this the browser hands over Blobs instead.
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.state.wsConnected = true;
      // After (re)connect, resume the tab the user is looking at.
      if (this.pending) this.select(this.pending);
      else if (this.consumer) this.select(this.consumer);
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
      // The server detached us with the socket, so clear the consumer too: otherwise the
      // reconnect's select() would be skipped by the already-attached guard.
      this.consumer = undefined;
      this.pending = undefined;
      this.discarding = false;
      this.state.wsConnected = false;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, 1000);
    });
  }

  private handleMessage(msg: WsServerMessage) {
    if (msg.type === "start") {
      if (this.pending?.id === msg.id) {
        this.consumer = this.pending;
        this.pending = undefined;
        this.discarding = false;
      } else {
        // A start for a tab we already moved past; its frames must not reach any view.
        this.discarding = true;
        return;
      }
    }
    if (this.discarding) return;
    this.consumer?.onMessage(msg);
  }

  /**
   * Asks the host to attach `consumer`'s tab on the socket. Re-selecting a tab that is
   * already attached or pending is a no-op: it would re-fit the pty and send a second
   * SIGWINCH, which makes TUI apps repaint their screen from scratch.
   */
  select(consumer: TtyConsumer) {
    if (this.consumer?.id === consumer.id || this.pending?.id === consumer.id) return;
    this.pending = consumer;
    const buffer = this.state.connections[consumer.id]?.buffer;
    this.send({ type: "select", id: consumer.id, since: buffer?.endOffset ?? 0 });
  }

  /** Drops the view; if it was active, tells the server to detach its tab. */
  leave(id: string) {
    if (this.consumer?.id !== id && this.pending?.id !== id) return;
    this.consumer = undefined;
    this.pending = undefined;
    this.discarding = false;
    this.send({ type: "leave" });
  }

  /** Sends an input/resize message for a tab. */
  send(msg: WsClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      // Copied into a plain ArrayBuffer: the codec's views may sit on a larger buffer,
      // which `WebSocket.send` will not accept as a `BufferSource`.
      this.socket.send(encodeClientMessage(msg).slice().buffer);
    }
  }

  /** Stops for good (logout): no reconnect, drop the socket. */
  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.consumer = undefined;
    this.pending = undefined;
    this.discarding = false;
    this.state.wsConnected = false;
    this.socket?.close();
    this.socket = undefined;
  }
}
