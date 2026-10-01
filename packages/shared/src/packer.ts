/**
 * A binary packing format in the spirit of Python's `struct`: a format string describes a
 * record's fields, and `new Packer(format)` compiles it into a reusable reader/writer.
 *
 * Codes are deliberately single characters — that is what lets `Fields<F>` infer the
 * decoded tuple by splitting the string with template literal types.
 *
 *   b h H i I q Q  fixed-width integers, little-endian by default (`>` prefix for big)
 *   ?              bool
 *   v              varint (LEB128), decodes to number
 *   n N            length-prefixed bytes / utf8 string
 *   * T            the entire remainder of the buffer, as bytes / utf8 string
 *
 * `n`/`N`/`*`/`T` have no Python equivalents. Real `struct`'s `s`/`p` are *counted* fields,
 * which is a different thing and deliberately not reused here. `v` exists for unbounded
 * integers, `n`/`N` for a variable-length field partway through a record, and `*` for the
 * common case where the buffer is already delimited and the payload runs to the end.
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Byte width of each fixed-width integer code; absent for the variable-length ones. */
const FIXED_SIZE: Record<string, number> = { b: 1, h: 2, H: 2, i: 4, I: 4, q: 8, Q: 8 };

/** Which of the 64-bit codes are signed. Matches `struct`: `q` signed, `Q` unsigned. */
const SIGNED_64: Record<string, boolean> = { q: true, Q: false };

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Upper bound on the buffer a packer will allocate, so a hostile length prefix cannot
 * exhaust memory. Far above any realistic single record. */
const MAX_PACKED = 16 * 1024 * 1024;

/** Bytes a LEB128 varint occupies for `v`. */
function varintSize(v: number): number {
  if (v < 0 || !Number.isInteger(v)) throw new RangeError(`varint out of range: ${v}`);
  let size = 1;
  for (let rest = Math.floor(v / 128); rest > 0; rest = Math.floor(rest / 128)) size++;
  return size;
}

type FieldOf<C extends string> = C extends "b"
  ? number
  : C extends "h" | "H" | "i" | "I"
    ? number
    : C extends "q" | "Q"
      ? bigint
      : C extends "?"
        ? boolean
        : C extends "v"
          ? number
          : C extends "n" | "*"
            ? Uint8Array
            : C extends "N" | "T"
              ? string
              : never;

/** Splits a format string into its field tuple, one code per character. A leading `>`
 * selects big-endian and is not itself a field. */
export type Fields<F extends string> = F extends `>${infer R}`
  ? Fields<R>
  : F extends `${infer C}${infer R}`
    ? [FieldOf<C>, ...Fields<R>]
    : [];

class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private at = 0;

  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number) {
    this.view.setUint8(this.at, v);
    this.at += 1;
  }

  uint(v: number | bigint, size: number, little: boolean, signed: boolean) {
    if (size === 8) {
      const big = typeof v === "bigint" ? v : BigInt(v);
      if (signed) this.view.setBigInt64(this.at, big, little);
      else this.view.setBigUint64(this.at, big, little);
    } else if (size === 4) this.view.setUint32(this.at, Number(v), little);
    else if (size === 2) this.view.setUint16(this.at, Number(v), little);
    else this.view.setUint8(this.at, Number(v));
    this.at += size;
  }

  varint(v: number) {
    if (v < 0 || !Number.isInteger(v)) throw new RangeError(`varint out of range: ${v}`);
    // Divided rather than shifted: `>>` is a 32-bit operation and would corrupt large values.
    let n = v;
    while (n >= 0x80) {
      this.u8((n % 128) + 0x80);
      n = Math.floor(n / 128);
    }
    this.u8(n);
  }

  raw(bytes: Uint8Array) {
    this.buf.set(bytes, this.at);
    this.at += bytes.length;
  }

  done(): Uint8Array {
    return this.buf.subarray(0, this.at);
  }
}

class Reader {
  private view: DataView;
  private at: number;
  private readonly end: number;

  constructor(buf: Uint8Array, start: number) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.at = start;
    this.end = buf.byteLength;
  }

  get offset() {
    return this.at;
  }

  private need(n: number) {
    // Checked before every read so a truncated buffer throws instead of silently producing
    // garbage (or reading out of bounds).
    if (this.at + n > this.end) throw new RangeError("truncated buffer");
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.at++);
  }

  uint(size: number, little: boolean, signed: boolean): number | bigint {
    this.need(size);
    const v =
      size === 8
        ? signed
          ? this.view.getBigInt64(this.at, little)
          : this.view.getBigUint64(this.at, little)
        : size === 4
          ? this.view.getUint32(this.at, little)
          : size === 2
            ? this.view.getUint16(this.at, little)
            : this.view.getUint8(this.at);
    this.at += size;
    return v;
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (let i = 0; ; i++) {
      const byte = this.u8();
      // Guard both the numeric ceiling and a runaway continuation before it overflows.
      if (result > MAX_SAFE) throw new RangeError("varint exceeds safe integer range");
      result += (byte & 0x7f) * shift;
      if (byte < 0x80) return result;
      shift *= 128;
      if (i > 9) throw new RangeError("varint too long");
    }
  }

  /** The rest of the buffer, or a `length`-byte slice. The length is validated against
   * what is actually left before allocating, so a buffer cannot request an arbitrary view. */
  bytes(length?: number): Uint8Array {
    if (length === undefined) {
      const out = new Uint8Array(
        this.view.buffer,
        this.view.byteOffset + this.at,
        this.end - this.at,
      );
      this.at = this.end;
      return out;
    }
    this.need(length);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, length);
    this.at += length;
    return out;
  }
}

/**
 * A compiled format string. Validation happens in the constructor rather than per record,
 * so a malformed format throws where it is written instead of at the first call.
 */
export class Packer<F extends string> {
  readonly format: F;
  private readonly little: boolean;
  private readonly codes: readonly string[];
  /** Total width of the fixed-width and single-byte fields; the rest is measured per pack. */
  private readonly fixed: number;

  /**
   * The type parameter is inferred from this argument, so it must stay a direct `F`
   * parameter: widening it to `string` (or dropping the constructor) makes `F` fall back to
   * `string`, which collapses `Fields<string>` to `[]` and silently rejects every `pack`.
   */

  constructor(format: F) {
    const big = format.startsWith(">");
    this.format = format;
    this.little = !big;
    this.codes = big ? format.slice(1).split("") : format.split("");

    let fixed = 0;
    let restAt = -1;
    for (const [i, code] of this.codes.entries()) {
      if (code === "*" || code === "T") {
        // Nothing can follow a rest-of-buffer field: it would have nowhere left to read from.
        if (restAt >= 0) throw new Error(`${format}: duplicate rest-of-buffer field`);
        if (i !== this.codes.length - 1) throw new Error(`${format}: rest-of-buffer must be last`);
        restAt = i;
        continue;
      }
      const known =
        code in FIXED_SIZE || code === "?" || code === "v" || code === "n" || code === "N";
      if (!known) throw new Error(`${format}: unknown field code '${code}'`);
      // A bare `v` may still widen past one byte, but its own value is only known at pack
      // time; length-prefixed fields get their prefix measured there instead.
      if (code in FIXED_SIZE) fixed += FIXED_SIZE[code];
      else if (code === "v" || code === "?") fixed += 1;
    }
    this.fixed = fixed;
  }

  pack(...values: Fields<F>): Uint8Array {
    const { codes, fixed, little } = this;
    if (values.length !== codes.length) {
      throw new TypeError(`${this.format}: expected ${codes.length} values, got ${values.length}`);
    }
    const vals = values as readonly unknown[];
    // `fixed` already covers the fixed-width codes; the rest have to be measured, since a
    // varint widens with its value and the length-prefixed fields carry their own payload.
    let size = fixed;
    for (const [i, code] of codes.entries()) {
      const value = vals[i];
      if (code === "v") size += varintSize(value as number);
      else if (code === "n" || code === "N" || code === "*" || code === "T") {
        const len =
          typeof value === "string" ? utf8.encode(value).length : (value as Uint8Array).length;
        // Only the length-prefixed forms pay for a prefix.
        size += len + (code === "n" || code === "N" ? varintSize(len) : 0);
      }
    }
    if (size > MAX_PACKED) throw new RangeError(`${this.format}: packed size exceeds limit`);

    const out = new Writer(size);
    for (const [i, code] of codes.entries()) {
      const value = vals[i];
      if (code in FIXED_SIZE) {
        out.uint(value as number | bigint, FIXED_SIZE[code], little, SIGNED_64[code] ?? false);
      } else if (code === "?") out.u8(value ? 1 : 0);
      else if (code === "v") out.varint(value as number);
      else if (code === "n") {
        out.varint((value as Uint8Array).length);
        out.raw(value as Uint8Array);
      } else if (code === "N") {
        const bytes = utf8.encode(value as string);
        out.varint(bytes.length);
        out.raw(bytes);
      } else if (code === "T") out.raw(utf8.encode(value as string));
      else out.raw(value as Uint8Array);
    }
    return out.done();
  }

  /**
   * Reads the fields starting at `offset`. Returns just the fields, so the common case
   * destructures directly. No trailing-byte check, which makes it safe to use on a buffer
   * a caller will keep reading from — use `read` for that.
   */
  unpack(buf: Uint8Array, offset = 0): Fields<F> {
    return this.read(buf, offset)[0];
  }

  /**
   * Reads the fields at `offset` and returns them alongside the offset just past the last
   * byte consumed. This is how nested records walk one buffer: the offset is a named second
   * element rather than an extra trailing one, so it can never be confused with a field of
   * the format itself.
   */
  read(buf: Uint8Array, offset: number): [Fields<F>, number] {
    const { codes, little } = this;
    const r = new Reader(buf, offset);
    const values: unknown[] = [];
    for (const code of codes) {
      if (code in FIXED_SIZE) {
        values.push(r.uint(FIXED_SIZE[code], little, SIGNED_64[code] ?? false));
      } else if (code === "?") values.push(r.u8() !== 0);
      else if (code === "v") values.push(r.varint());
      else if (code === "n") values.push(r.bytes(r.varint()));
      else if (code === "N") values.push(utf8Decoder.decode(r.bytes(r.varint())));
      else if (code === "*") values.push(r.bytes());
      else values.push(utf8Decoder.decode(r.bytes()));
    }
    return [values as Fields<F>, r.offset];
  }

  /** `unpack` that requires the format to consume `buf` exactly; throws on trailing bytes. */
  decode(buf: Uint8Array): Fields<F> {
    const [values, next] = this.read(buf, 0);
    // A non-rest format must consume the buffer exactly; anything left over means the
    // format and the encoder disagree.
    if (next !== buf.byteLength) throw new RangeError("trailing bytes after record");
    return values;
  }
}
