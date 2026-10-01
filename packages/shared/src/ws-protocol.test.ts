import { describe, expect, test } from "bun:test";
import {
  ACCESS_FMT,
  CHUNK_FMT,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  ERROR_FMT,
  SIZE_FMT,
  START_FMT,
} from "./ws-protocol";
import { ClientOp, ServerOp } from "./state";
import type { WsClientMessage, WsServerMessage, WsShareToken } from "./state";

const bytes = (...v: number[]) => new Uint8Array(v);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("server messages", () => {
  const cases: WsServerMessage[] = [
    { type: "start", id: "V1StGXR8_Z5jdHi6B-myT", offset: 4096, canWrite: true, expiresAt: 0 },
    {
      type: "start",
      id: "tab-2",
      offset: 1_788_888_888_888,
      canWrite: false,
      expiresAt: 1_788_888_999_999,
    },
    { type: "chunk", offset: 0, data: new Uint8Array(0) },
    { type: "chunk", offset: 12345, data: utf8("\x1b[2J\x1b[Hhello") },
    { type: "size", cols: 80, rows: 24 },
    { type: "size", cols: 65535, rows: 65535 },
    { type: "end" },
    { type: "error", message: "This session has ended." },
    { type: "error", message: "héllo — ünïcode ✓" },
    { type: "access", canWrite: true, expiresAt: 0 },
    { type: "access", canWrite: false, expiresAt: 1_788_888_999_999 },
    { type: "connections", tokens: [] },
    {
      type: "connections",
      tokens: [
        {
          token: "a".repeat(32),
          expireAt: 0,
          allowWrite: false,
          maxConnections: 5,
          connections: 0,
        },
        {
          token: "b".repeat(32),
          expireAt: 1_788_888_999_999,
          allowWrite: true,
          maxConnections: 1,
          connections: 1,
        },
      ],
    },
  ];

  for (const msg of cases) {
    test(`round-trips ${msg.type}${msg.type === "connections" ? ` (${msg.tokens.length} tokens)` : ""}`, () => {
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    });
  }

  test("every message type maps to a distinct opcode", () => {
    const opcodes = cases.map((m) => encodeServerMessage(m)[0]);
    expect(new Set(opcodes).size).toBe(new Set(cases.map((m) => m.type)).size);
  });

  test("chunk is far smaller than the old JSON and base64 framing", () => {
    const payload = utf8("\x1b[5;10H|");
    const framed = encodeServerMessage({ type: "chunk", offset: 15, data: payload });
    // Opcode plus a one-byte varint plus the payload, versus ~82 bytes of JSON envelope
    // and a third again from base64.
    expect(framed.length).toBe(payload.length + 2);
  });

  test("rejects an unknown opcode", () => {
    expect(() => decodeServerMessage(bytes(0x7f, 0x00))).toThrow(/unknown server opcode/);
  });

  test("rejects an empty frame", () => {
    expect(() => decodeServerMessage(new Uint8Array(0))).toThrow(/empty frame/);
  });

  test("rejects a body that does not match the opcode's format", () => {
    expect(() => decodeServerMessage(bytes(ServerOp.Size, 0x01))).toThrow();
  });
});

describe("client messages", () => {
  const cases: WsClientMessage[] = [
    { type: "select", id: "V1StGXR8_Z5jdHi6B-myT", since: 0 },
    { type: "select", id: "tab-2", since: 4_294_967_296 },
    { type: "leave" },
    { type: "data", data: "" },
    { type: "data", data: "ls -la\r" },
    { type: "data", data: "é✓\x03" },
    { type: "resize", cols: 80, rows: 24 },
  ];

  for (const msg of cases) {
    test(`round-trips ${msg.type}`, () => {
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
    });
  }

  test("every message type maps to a distinct opcode", () => {
    const opcodes = cases.map((m) => encodeClientMessage(m)[0]);
    expect(new Set(opcodes).size).toBe(new Set(cases.map((m) => m.type)).size);
  });

  test("select and start agree on the id field", () => {
    const id = "V1StGXR8_Z5jdHi6B-myT";
    const sel = decodeClientMessage(encodeClientMessage({ type: "select", id, since: 7 }));
    const start = decodeServerMessage(
      encodeServerMessage({ type: "start", id, offset: 7, canWrite: true, expiresAt: 0 }),
    );
    expect(sel.type === "select" && sel.id).toBe(start.type === "start" && start.id);
  });

  test("a data frame carries its payload as the frame remainder", () => {
    // `data` uses the rest-of-buffer string code, so truncation is unobservable by
    // construction: whatever bytes remain are the message. This documents the trade-off.
    const framed = encodeClientMessage({ type: "data", data: "abc" });
    expect(framed).toEqual(bytes(ClientOp.Data, 0x61, 0x62, 0x63));
    expect(decodeClientMessage(framed)).toEqual({ type: "data", data: "abc" });
  });

  test("rejects an unknown opcode", () => {
    expect(() => decodeClientMessage(bytes(0x7f))).toThrow(/unknown client opcode/);
  });

  test("rejects a truncated length-prefixed frame", () => {
    // `select` starts with a length-prefixed id, so cutting it short is detectable.
    const framed = encodeClientMessage({ type: "select", id: "abcdef", since: 0 });
    expect(() => decodeClientMessage(framed.subarray(0, 4))).toThrow(/truncated/);
  });
});

describe("connections cursor walk", () => {
  test("reads token records back to back", () => {
    const tokens: WsShareToken[] = [
      { token: "t1", expireAt: 0, allowWrite: true, maxConnections: 3, connections: 1 },
      { token: "t2", expireAt: 100, allowWrite: false, maxConnections: 2, connections: 0 },
      { token: "t3", expireAt: 200, allowWrite: true, maxConnections: 1, connections: 1 },
    ];
    const msg = decodeServerMessage(
      encodeServerMessage({ type: "connections", tokens }),
    ) as Extract<WsServerMessage, { type: "connections" }>;
    expect(msg.tokens).toEqual(tokens);
  });

  test("rejects a truncated final token", () => {
    const good = encodeServerMessage({
      type: "connections",
      tokens: [{ token: "t1", expireAt: 0, allowWrite: true, maxConnections: 3, connections: 1 }],
    });
    // Keep the count but cut the record, so the cursor walk runs off the end.
    expect(() => decodeServerMessage(good.subarray(0, good.length - 3))).toThrow();
  });
});

describe("format constants", () => {
  test("stay distinct from one another", () => {
    expect(START_FMT.format).toBe("Nv?v");
    expect(CHUNK_FMT.format).toBe("v*");
    expect(SIZE_FMT.format).toBe("HH");
    expect(ERROR_FMT.format).toBe("T");
    expect(ACCESS_FMT.format).toBe("?v");
  });
});
