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

export const tabInfoSchema = z.object({
  id: z.string(),
  commandId: z.string().nullish(),
  args: z.string().array(),
  label: z.string().nullish(),
  status: z.enum(["active", "ended"]),
  connections: z.number(),
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
 * Wire protocol for `/ws`. Every message is tagged with the tab `id` it belongs to, so the
 * client can route (or drop) messages even while switching. `offset` is a cumulative byte
 * position in the pty's output stream: each `chunk` reports the offset its bytes *start at*
 * (so chunk ranges are `[offset, offset + len)`), a `start` reports the resume position, and
 * a client resumes by sending `select { since }` with the last offset it has rendered.
 */
export type WsClientMessage =
  | { id: string; type: "select"; data: { since: number } }
  | { id: string; type: "leave" }
  | { id: string; type: "data"; data: string }
  | { id: string; type: "resize"; data: [number, number] };

/** Messages the server sends over `/ws`. */
export type WsServerMessage =
  | { id: string; type: "start"; data: { offset: number; canWrite: boolean; expiresAt: number } }
  | { id: string; type: "chunk"; data: { offset: number; chunk: string } }
  | { id: string; type: "size"; data: [number, number] }
  | { id: string; type: "end" }
  | { id: string; type: "error"; data: { message: string } }
  | { id: string; type: "access"; data: { canWrite: boolean; expiresAt?: number } }
  | { id: string; type: "connections"; data: { tokens: WsShareToken[] } };

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
