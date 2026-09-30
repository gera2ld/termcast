import type { TtyBuffer } from "@termcast/shared";

export type TtyStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

export interface IShareToken {
  token: string;
  expireAt: number;
  allowWrite: boolean;
  maxConnections: number;
  connections: number;
  tabId?: string;
}

/** Web-local connection state for a terminal session, owned by the client.
 *
 * Keyed by tab id in `GlobalState.connections`. The terminal list (`TabInfo` from
 * `@termcast/shared`) holds only server-derived data; everything the WebSocket drives
 * (the live status, the owner/share token used to connect, write access, the
 * share-token array, and the output buffer) lives here so a realtime snapshot can
 * refresh the list without clobbering an in-flight connection. */
export interface TtyConnection {
  status: TtyStatus;
  /** Whether this tab's WebSocket is connected. The owner shares one socket for all
   * tabs; guests keep a per-tab socket, so this is set per connection. */
  wsConnected?: boolean;
  token?: string;
  canWrite?: boolean;
  expiresAt?: number;
  error?: string;
  shareTokens: IShareToken[];
  buffer?: TtyBuffer;
}
