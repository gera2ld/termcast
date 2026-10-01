import {
  ClientOp,
  type ClientOp as ClientOpcode,
  ServerOp,
  type ServerOp as ServerOpcode,
  type WsClientMessage,
  type WsServerMessage,
  type WsShareToken,
} from "./state";
import { Packer } from "./packer";

/**
 * Wire format for the `/ws` terminal channel. Frames are `[u8 opcode][packed fields]`; the
 * opcode selects the message and the field layout comes from a `Packer` format string.
 *
 * The packers below are the contract: host and web client both import them, so the two
 * sides cannot disagree about a field's order or width.
 */

export const START_FMT = new Packer("Nv?v"); // id, offset, canWrite, expiresAt
export const CHUNK_FMT = new Packer("v*"); // offset, payload
export const SIZE_FMT = new Packer("HH"); // cols, rows
export const ERROR_FMT = new Packer("T"); // message
export const ACCESS_FMT = new Packer("?v"); // canWrite, expiresAt
/** Per share token, repeated `count` times inside a `connections` frame. */
export const TOKEN_FMT = new Packer("Nv?vv"); // token, expireAt, allowWrite, max, count
const CONNECTIONS_COUNT_FMT = new Packer("v");

export const SELECT_FMT = new Packer("Nv"); // id, since
export const DATA_FMT = new Packer("T"); // keystrokes
export const RESIZE_FMT = new Packer("HH"); // cols, rows

/** Message type to opcode, so dispatch never string-switches at runtime. */
const SERVER_OPCODE: Record<WsServerMessage["type"], ServerOpcode> = {
  start: ServerOp.Start,
  chunk: ServerOp.Chunk,
  size: ServerOp.Size,
  end: ServerOp.End,
  error: ServerOp.Error,
  access: ServerOp.Access,
  connections: ServerOp.Connections,
};

const CLIENT_OPCODE: Record<WsClientMessage["type"], ClientOpcode> = {
  select: ClientOp.Select,
  leave: ClientOp.Leave,
  data: ClientOp.Data,
  resize: ClientOp.Resize,
};

/** Prefixes `fields` with its opcode byte to form a complete frame. */
function frame(opcode: number, fields: Uint8Array): Uint8Array {
  const out = new Uint8Array(fields.length + 1);
  out[0] = opcode;
  out.set(fields, 1);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const SERVER_ENCODERS: Record<ServerOp, (msg: WsServerMessage) => Uint8Array> = {
  [ServerOp.Start]: (m) => {
    if (m.type !== "start") throw new TypeError("expected start");
    return frame(ServerOp.Start, START_FMT.pack(m.id, m.offset, m.canWrite, m.expiresAt));
  },
  [ServerOp.Chunk]: (m) => {
    if (m.type !== "chunk") throw new TypeError("expected chunk");
    return frame(ServerOp.Chunk, CHUNK_FMT.pack(m.offset, m.data));
  },
  [ServerOp.Size]: (m) => {
    if (m.type !== "size") throw new TypeError("expected size");
    return frame(ServerOp.Size, SIZE_FMT.pack(m.cols, m.rows));
  },
  [ServerOp.End]: (m) => {
    if (m.type !== "end") throw new TypeError("expected end");
    return frame(ServerOp.End, new Uint8Array(0));
  },
  [ServerOp.Error]: (m) => {
    if (m.type !== "error") throw new TypeError("expected error");
    return frame(ServerOp.Error, ERROR_FMT.pack(m.message));
  },
  [ServerOp.Access]: (m) => {
    if (m.type !== "access") throw new TypeError("expected access");
    return frame(ServerOp.Access, ACCESS_FMT.pack(m.canWrite, m.expiresAt));
  },
  [ServerOp.Connections]: (m) => {
    if (m.type !== "connections") throw new TypeError("expected connections");
    const parts: Uint8Array[] = [CONNECTIONS_COUNT_FMT.pack(m.tokens.length)];
    for (const t of m.tokens) {
      parts.push(
        TOKEN_FMT.pack(t.token, t.expireAt, t.allowWrite, t.maxConnections, t.connections),
      );
    }
    return frame(ServerOp.Connections, concat(parts));
  },
};

const SERVER_DECODERS: Record<ServerOp, (body: Uint8Array) => WsServerMessage> = {
  [ServerOp.Start]: (b) => {
    const [id, offset, canWrite, expiresAt] = START_FMT.decode(b);
    return { type: "start", id, offset, canWrite, expiresAt };
  },
  [ServerOp.Chunk]: (b) => {
    const [offset, data] = CHUNK_FMT.decode(b);
    return { type: "chunk", offset, data };
  },
  [ServerOp.Size]: (b) => {
    const [cols, rows] = SIZE_FMT.decode(b);
    return { type: "size", cols, rows };
  },
  [ServerOp.End]: () => ({ type: "end" }),
  [ServerOp.Error]: (b) => ({ type: "error", message: ERROR_FMT.decode(b)[0] }),
  [ServerOp.Access]: (b) => {
    const [canWrite, expiresAt] = ACCESS_FMT.decode(b);
    return { type: "access", canWrite, expiresAt };
  },
  // The one nested structure: a varint count followed by that many token records, walked
  // with the cursor-returning `read` rather than a second hand-rolled codec.
  [ServerOp.Connections]: (b) => {
    const [[count], start] = CONNECTIONS_COUNT_FMT.read(b, 0);
    const tokens: WsShareToken[] = [];
    let at = start;
    for (let i = 0; i < count; i++) {
      const [fields, next] = TOKEN_FMT.read(b, at);
      const [token, expireAt, allowWrite, maxConnections, connections] = fields;
      tokens.push({ token, expireAt, allowWrite, maxConnections, connections });
      at = next;
    }
    if (at !== b.byteLength) throw new RangeError("trailing bytes after frame");
    return { type: "connections", tokens };
  },
};

const CLIENT_ENCODERS: Record<ClientOp, (msg: WsClientMessage) => Uint8Array> = {
  [ClientOp.Select]: (m) => {
    if (m.type !== "select") throw new TypeError("expected select");
    return frame(ClientOp.Select, SELECT_FMT.pack(m.id, m.since));
  },
  [ClientOp.Leave]: (m) => {
    if (m.type !== "leave") throw new TypeError("expected leave");
    return frame(ClientOp.Leave, new Uint8Array(0));
  },
  [ClientOp.Data]: (m) => {
    if (m.type !== "data") throw new TypeError("expected data");
    return frame(ClientOp.Data, DATA_FMT.pack(m.data));
  },
  [ClientOp.Resize]: (m) => {
    if (m.type !== "resize") throw new TypeError("expected resize");
    return frame(ClientOp.Resize, RESIZE_FMT.pack(m.cols, m.rows));
  },
};

const CLIENT_DECODERS: Record<ClientOp, (body: Uint8Array) => WsClientMessage> = {
  [ClientOp.Select]: (b) => {
    const [id, since] = SELECT_FMT.decode(b);
    return { type: "select", id, since };
  },
  [ClientOp.Leave]: () => ({ type: "leave" }),
  [ClientOp.Data]: (b) => ({ type: "data", data: DATA_FMT.decode(b)[0] }),
  [ClientOp.Resize]: (b) => {
    const [cols, rows] = RESIZE_FMT.decode(b);
    return { type: "resize", cols, rows };
  },
};

/** The opcode byte of a frame, without copying the body. */
function opcodeOf(frame: Uint8Array): number {
  if (frame.length === 0) throw new RangeError("empty frame");
  return frame[0];
}

export function encodeServerMessage(msg: WsServerMessage): Uint8Array {
  return SERVER_ENCODERS[SERVER_OPCODE[msg.type]](msg);
}

export function decodeServerMessage(frame: Uint8Array): WsServerMessage {
  const opcode = opcodeOf(frame);
  const decoder = SERVER_DECODERS[opcode as ServerOp];
  if (!decoder) throw new RangeError(`unknown server opcode ${opcode}`);
  return decoder(frame.subarray(1));
}

export function encodeClientMessage(msg: WsClientMessage): Uint8Array {
  return CLIENT_ENCODERS[CLIENT_OPCODE[msg.type]](msg);
}

export function decodeClientMessage(frame: Uint8Array): WsClientMessage {
  const opcode = opcodeOf(frame);
  const decoder = CLIENT_DECODERS[opcode as ClientOp];
  if (!decoder) throw new RangeError(`unknown client opcode ${opcode}`);
  return decoder(frame.subarray(1));
}
