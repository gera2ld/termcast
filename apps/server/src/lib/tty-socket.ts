import type { WsClientMessage, WsServerMessage } from "@termcast/shared";
import type { GlobalState } from "./global.svelte";
import { getToken } from "./orpc-client";

/** A mounted terminal view; the manager routes messages for its tab to it. */
export interface TtyConsumer {
  id: string;
  onMessage(msg: WsServerMessage): void;
}

/**
 * One owner WebSocket shared across all tabs. A single tab streams at a time:
 * `select` attaches to a pty (resuming from the client's buffer offset), `leave`
 * detaches it, and the server tags every message with the tab id so messages for a
 * tab that is no longer active can be dropped. The socket survives navigation, so
 * the owner authenticates once; guests keep their own per-tab socket.
 */
export class TtySocket {
  private socket: WebSocket | undefined;
  private consumer: TtyConsumer | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private state: GlobalState) {}

  connect() {
    if (this.socket || this.stopped) return;
    const token = getToken();
    if (!token) return;
    const wsOrigin = window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${wsOrigin}/ws?token=${encodeURIComponent(token)}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.state.wsConnected = true;
      // After (re)connect, resume the tab the user is looking at.
      if (this.consumer) this.select(this.consumer);
    });

    socket.addEventListener("message", (event) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (this.consumer?.id === msg.id) this.consumer.onMessage(msg);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.state.wsConnected = false;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, 1000);
    });
  }

  /** Attaches `consumer` as the active view and selects its tab on the socket. */
  select(consumer: TtyConsumer) {
    this.consumer = consumer;
    const buffer = this.state.connections[consumer.id]?.buffer;
    this.send({
      id: consumer.id,
      type: "select",
      data: { since: buffer?.endOffset ?? 0 },
    });
  }

  /** Drops the view; if it was active, tells the server to detach its tab. */
  leave(id: string) {
    if (this.consumer?.id !== id) return;
    this.consumer = undefined;
    this.send({ id, type: "leave" });
  }

  /** Sends an input/resize message for a tab. */
  send(msg: WsClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  /** Stops for good (logout): no reconnect, drop the socket. */
  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.consumer = undefined;
    this.state.wsConnected = false;
    this.socket?.close();
    this.socket = undefined;
  }
}
