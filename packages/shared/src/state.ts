import z from "zod";
import {
  type CloudflareTunnelState,
  type Command,
  type DeviceInfo,
  type Settings,
  cloudflareTunnelStateSchema,
  commandSchema,
  deviceInfoSchema,
  settingsSchema,
  userInfoSchema,
} from "./schemas";

/** Opcodes for the binary `/ws` terminal channel. */
export const ServerOp = {
  Start: 0x01,
  Chunk: 0x02,
  Size: 0x03,
  End: 0x04,
  Error: 0x05,
  Access: 0x06,
  Connections: 0x07,
} as const;
export type ServerOp = (typeof ServerOp)[keyof typeof ServerOp];

export const ClientOp = {
  Select: 0x01,
  Leave: 0x02,
  Data: 0x03,
  Resize: 0x04,
} as const;
export type ClientOp = (typeof ClientOp)[keyof typeof ClientOp];

export const tabInfoSchema = z.object({
  id: z.string(),
  commandId: z.string().nullish(),
  args: z.string().array(),
  label: z.string().nullish(),
  status: z.enum(["active", "ended"]),
  createdAt: z.string(),
  lastActivity: z.string(),
});
export type TabInfo = z.infer<typeof tabInfoSchema>;

export const serverStateSchema = z.object({
  user: userInfoSchema,
  tunnel: z.object({ state: cloudflareTunnelStateSchema }),
  settings: settingsSchema,
  devices: deviceInfoSchema.array(),
  commands: commandSchema.array(),
  tabs: tabInfoSchema.array(),
});
export type ServerState = z.infer<typeof serverStateSchema>;

/** Real-time wire events streamed to connected dashboards over the `/realtime` channel. */
export type RealtimeEvent =
  | { type: "snapshot"; state: ServerState }
  | { type: "tabs.upsert"; tab: TabInfo }
  | { type: "tabs.remove"; id: string }
  | { type: "commands.upsert"; command: Command }
  | { type: "commands.remove"; id: string }
  | { type: "devices.upsert"; device: DeviceInfo }
  | { type: "devices.remove"; id: string }
  | { type: "settings"; settings: Settings }
  | { type: "tunnel"; tunnel: { state: CloudflareTunnelState } };

/** One attached share link, as broadcast to the owner via `connections`. */
export interface WsShareToken {
  token: string;
  expireAt: number;
  allowWrite: boolean;
  maxConnections: number;
  connections: number;
}

/**
 * Wire protocol for `/ws`, serialized by `ws-protocol.ts` as `[u8 opcode][fields]`, with
 * each direction negotiated once on the upgrade and never renegotiated.
 *
 * The socket is the routing key: a connection is bound to exactly one tab from the moment
 * its `select` is answered, so only `select` and `start` name a tab and the remaining
 * messages do not repeat it. `offset` is a cumulative byte position in the pty's output
 * stream: each `chunk` reports the offset its bytes *start at* (so chunk ranges are
 * `[offset, offset + len)`), a `start` reports the resume position, and a client resumes by
 * sending `select { since }` with the last offset it has rendered.
 *
 * `expiresAt` is always present; `0` means the session never expires.
 */
export type WsClientMessage =
  | { type: "select"; id: string; since: number }
  | { type: "leave" }
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number };

/** Messages the server sends over `/ws`. */
export type WsServerMessage =
  | { type: "start"; id: string; offset: number; canWrite: boolean; expiresAt: number }
  | { type: "chunk"; offset: number; data: Uint8Array }
  | { type: "size"; cols: number; rows: number }
  | { type: "end" }
  | { type: "error"; message: string }
  | { type: "access"; canWrite: boolean; expiresAt: number }
  | { type: "connections"; tokens: WsShareToken[] };

/**
 * Internal, in-process event bus map. State mutations emit here; `realtime.ts` subscribes once and
 * fans the changes out to every connected dashboard socket. Keeping this separate from the socket
 * layer means emit sites (router, tab registry, pty) never import the transport.
 */
export type RealtimeEvents = {
  "tabs.upsert": (tabId: string) => void;
  "tabs.remove": (tabId: string) => void;
  "commands.upsert": (command: Command) => void;
  "commands.remove": (id: string) => void;
  "devices.upsert": (device: DeviceInfo) => void;
  "devices.remove": (id: string) => void;
  settings: () => void;
  tunnel: () => void;
};
