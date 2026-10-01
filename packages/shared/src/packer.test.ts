import { describe, expect, test } from "bun:test";
import { Packer } from "./packer";

const bytes = (...v: number[]) => new Uint8Array(v);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("fixed-width fields", () => {
  test("round-trips unsigned values little-endian by default", () => {
    const p = new Packer("bHHI");
    const packed = p.pack(200, 1000, 65535, 4_000_000_000);
    expect(packed).toEqual(bytes(200, 0xe8, 0x03, 0xff, 0xff, 0x00, 0x28, 0x6b, 0xee));
    expect(p.decode(packed)).toEqual([200, 1000, 65535, 4_000_000_000]);
  });

  test("honours the big-endian prefix", () => {
    const p = new Packer(">H");
    expect(p.pack(0x1234)).toEqual(bytes(0x12, 0x34));
    expect(p.decode(bytes(0x12, 0x34))).toEqual([0x1234]);
  });

  test("round-trips bigints", () => {
    const p = new Packer("qQ");
    const packed = p.pack(-2n, 2n ** 63n);
    expect(p.decode(packed)).toEqual([-2n, 2n ** 63n]);
  });

  test("round-trips booleans", () => {
    const p = new Packer("???");
    const packed = p.pack(true, false, true);
    expect(packed).toEqual(bytes(1, 0, 1));
    expect(p.decode(packed)).toEqual([true, false, true]);
  });

  test("round-trips an empty format", () => {
    const p = new Packer("");
    expect(p.pack()).toEqual(new Uint8Array(0));
    expect(p.decode(new Uint8Array(0))).toEqual([]);
  });
});

describe("varints", () => {
  test("round-trips the LEB128 boundaries", () => {
    const p = new Packer("vvvv");
    // 0, 127 and 128 are where the encoding changes width; 16384 goes wider still.
    expect(p.pack(0, 127, 128, 16_384)).toEqual(bytes(0, 0x7f, 0x80, 0x01, 0x80, 0x80, 0x01));
    expect(p.decode(bytes(0, 0x7f, 0x80, 0x01, 0x80, 0x80, 0x01))).toEqual([0, 127, 128, 16_384]);
    expect(p.decode(p.pack(0, 2 ** 21, 2 ** 28, 2 ** 32))).toEqual([0, 2 ** 21, 2 ** 28, 2 ** 32]);
  });

  test("round-trips values past u32, which a fixed field could not hold", () => {
    const p = new Packer("v");
    const offset = 4_294_967_296;
    expect(p.decode(p.pack(offset))).toEqual([offset]);
  });

  test("rejects a value that cannot round-trip", () => {
    const p = new Packer("v");
    expect(() => p.pack(-1)).toThrow(RangeError);
    expect(() => p.pack(1.5)).toThrow(RangeError);
  });

  test("rejects a varint that overruns the safe-integer range", () => {
    const p = new Packer("v");
    // Eleven continuation bytes: far past 2**53, so it must throw rather than lose precision.
    const runaway = bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f);
    expect(() => p.decode(runaway)).toThrow(RangeError);
  });

  test("rejects a truncated varint", () => {
    expect(() => new Packer("v").decode(bytes(0x80))).toThrow(/truncated/);
  });
});

describe("length-prefixed fields", () => {
  test("round-trips bytes and strings mid-record", () => {
    const p = new Packer("nN");
    const packed = p.pack(utf8("abc"), "héllo");
    expect(p.decode(packed)).toEqual([utf8("abc"), "héllo"]);
    // The prefix counts bytes and is not reused as a field width.
    expect(packed[0]).toBe(3);
  });

  test("measures a string in bytes, not characters", () => {
    const p = new Packer("N");
    const packed = p.pack("é");
    expect(packed).toEqual(bytes(2, 0xc3, 0xa9));
    expect(p.decode(packed)).toEqual(["é"]);
  });

  test("round-trips empty values", () => {
    const p = new Packer("nN");
    expect(p.decode(p.pack(new Uint8Array(0), ""))).toEqual([new Uint8Array(0), ""]);
  });

  test("rejects a length prefix larger than the remaining buffer", () => {
    // Claims 2**40 bytes while only two remain: must throw before allocating.
    expect(() => new Packer("n").decode(bytes(0x80, 0x80, 0x80, 0x80, 0x80, 0x40, 0x00))).toThrow(
      RangeError,
    );
  });
});

describe("rest-of-buffer fields", () => {
  test("round-trips the whole remainder with no length prefix", () => {
    const p = new Packer("v*");
    const payload = bytes(0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x48, 0x21);
    const packed = p.pack(999, payload);
    // 999 is two varint bytes; the payload follows with nothing counting it.
    expect(packed).toEqual(bytes(0xe7, 0x07, ...payload));
    const [offset, data] = p.decode(packed);
    expect(offset).toBe(999);
    expect(data).toEqual(payload);
  });

  test("round-trips an empty remainder", () => {
    const p = new Packer("v*");
    expect(p.decode(p.pack(0, new Uint8Array(0)))).toEqual([0, new Uint8Array(0)]);
  });

  test("round-trips a rest-of-buffer string", () => {
    const p = new Packer("T");
    expect(p.decode(p.pack("this link has expired."))).toEqual(["this link has expired."]);
  });
});

describe("reading from a cursor", () => {
  test("read reports where it stopped and unpack reads from an offset", () => {
    const pair = new Packer("HH");
    const single = new Packer("H");
    // 0x0100 and 0x0302 little-endian, then 0x0900, which `read` must not consume.
    const buf = bytes(0x00, 0x01, 0x02, 0x03, 0x00, 0x09);
    const [first, at] = pair.read(buf, 0);
    expect(first).toEqual([0x0100, 0x0302]);
    expect(at).toBe(4);
    // `unpack` returns the fields alone, so the offset can never be mistaken for one.
    expect(single.unpack(buf, at)).toEqual([0x0900]);
  });

  test("walks nested records back to back", () => {
    const header = new Packer("v");
    const record = new Packer("HH");
    const body = concat([header.pack(2), record.pack(1, 2), record.pack(3, 4)]);

    const [[count], at] = header.read(body, 0);
    expect(count).toBe(2);
    const rows: number[][] = [];
    let cursor = at;
    for (let i = 0; i < count; i++) {
      const [fields, next] = record.read(body, cursor);
      rows.push(fields);
      cursor = next;
    }
    expect(rows).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(cursor).toBe(body.byteLength);
  });
});

describe("validation", () => {
  test("rejects an unknown field code at build time", () => {
    expect(() => new Packer("hz")).toThrow(/unknown field code/);
  });

  test("rejects a rest-of-buffer field that is not last", () => {
    expect(() => new Packer("*v")).toThrow(/must be last/);
    // Two rest fields: the second is reported as not-last, which is the real problem.
    expect(() => new Packer("T*")).toThrow(/must be last/);
  });

  test("rejects a wrong number of values", () => {
    // The tuple type already rejects this at compile time, so the runtime guard is
    // asserted through a deliberately widened call.
    const p = new Packer("HH");
    const pack = p.pack as (...values: unknown[]) => Uint8Array;
    expect(() => pack(1)).toThrow(TypeError);
  });

  test("decode rejects trailing bytes", () => {
    const p = new Packer("HH");
    expect(() => p.decode(bytes(1, 0, 2, 0, 0xff))).toThrow(/trailing bytes/);
  });

  test("decode rejects a truncated buffer", () => {
    const p = new Packer("HH");
    expect(() => p.decode(bytes(1))).toThrow(/truncated/);
    expect(() => p.decode(new Uint8Array(0))).toThrow(/truncated/);
  });
});

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
