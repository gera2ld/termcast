/**
 * Wire-size benchmark for the `/ws` terminal channel.
 *
 * Measures all four combinations — old/new framing x on/off compression — by counting
 * real TCP bytes through a proxy in front of an echo server, rather than estimating with
 * an offline compressor. That matters because Bun negotiates `permessage-deflate` *without*
 * context takeover, so every message compresses independently and a single-stream gzip
 * ratio is far too generous.
 *
 * The old framing is reconstructed verbatim from the pre-commit implementation
 * (tab.ts / terminal.ts / TtyView.svelte).
 *
 * Run with: just bench-ws
 */
import {
  decodeServerMessage,
  encodeServerMessage,
  type WsServerMessage,
} from "../packages/shared/src";

const enc = new TextEncoder();
const dec = new TextDecoder();
const TAB_ID = "V1StGXR8_Z5jdHi6B-myT";

// `@gera2ld/common`'s b64encode/b64decode are standard base64 with padding, so Buffer
// produces identical bytes without depending on a package that only resolves in apps/server.
const b64encode = (b: Uint8Array) => Buffer.from(b).toString("base64");
const b64decode = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** The framing used before the binary protocol: JSON envelope + base64 payload. */
const oldEncode = (offset: number, data: Uint8Array): Uint8Array =>
  enc.encode(
    JSON.stringify({ id: TAB_ID, type: "chunk", data: { offset, chunk: b64encode(data) } }),
  );

const newEncode = (offset: number, data: Uint8Array): Uint8Array =>
  encodeServerMessage({ type: "chunk", offset, data });

const oldDecode = (frame: Uint8Array) => {
  const msg = JSON.parse(dec.decode(frame)) as { data: { chunk: string } };
  return b64decode(msg.data.chunk);
};
const newDecode = (frame: Uint8Array) => {
  const msg = decodeServerMessage(frame) as Extract<WsServerMessage, { type: "chunk" }>;
  return msg.data;
};

interface Workload {
  name: string;
  frames: Uint8Array[];
}

const workloads: Workload[] = [
  {
    name: "spinner repaint",
    frames: Array.from({ length: 300 }, (_, i) =>
      enc.encode(`\x1b[5;10H${["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"][i % 8]}`),
    ),
  },
  {
    name: "progress bar",
    frames: Array.from({ length: 200 }, (_, i) => {
      const filled = Math.round((i / 200) * 60);
      return enc.encode(`\x1b[3;1H[${"#".repeat(filled)}${"-".repeat(60 - filled)}]`);
    }),
  },
  {
    name: "full-screen TUI repaint",
    frames: Array.from({ length: 60 }, (_, i) => {
      const rows = Array.from(
        { length: 24 },
        (_, r) => `\x1b[${r + 1};1Hrow ${r} ${"#".repeat((i + r) % 40)}`,
      ).join("");
      return enc.encode(rows);
    }),
  },
  {
    name: "bulk output (cat)",
    frames: Array.from({ length: 20 }, (_, i) =>
      enc.encode(
        Array.from({ length: 200 }, (_, r) => `line ${i}-${r} ${(i * r * 7919) % 100003}`).join(
          "\n",
        ),
      ),
    ),
  },
  {
    name: "shell prompt echo",
    frames: Array.from({ length: 100 }, (_, i) => enc.encode(`user@host:~$ cmd${i}\r\n`)),
  },
];

/**
 * Sends `frames` through a real WebSocket and reports the bytes that crossed the TCP
 * connection from server to client.
 *
 * A raw TCP proxy sits in front of the echo server so the byte count is taken off the
 * socket rather than inferred from the decoded message: the client only ever sees
 * decompressed frames, which is precisely why an offline estimate is misleading.
 */
async function measureOnWire(
  frames: Uint8Array[],
  opts: { format: "old" | "new"; compress: boolean },
): Promise<number> {
  const server = Bun.serve({
    port: 0,
    development: false,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined as unknown as Response;
      return new Response("no", { status: 400 });
    },
    websocket: {
      perMessageDeflate: opts.compress,
      message(ws, raw) {
        ws.send(new Uint8Array(raw as ArrayBuffer), opts.compress);
      },
    },
  });

  // Counts bytes the relay forwards downstream (server -> client), which is the only leg
  // carrying our frames. The upgrade handshake rides the same leg, so it is measured
  // separately as a baseline and subtracted.
  let wireBytes = 0;
  let baseline = 0;
  // `Bun.connect` resolves asynchronously, so bytes that arrive before the upstream is
  // ready are buffered per socket and replayed rather than dropped.
  const upstreams = new Map<Bun.Socket, Bun.Socket>();
  const buffered = new Map<Bun.Socket, Uint8Array[]>();

  const proxy = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      async open(client) {
        buffered.set(client, []);
        const upstream = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: {
            data(_up, data) {
              wireBytes += data.byteLength;
              client.write(data);
            },
          },
        });
        upstreams.set(client, upstream);
        for (const chunk of buffered.get(client) ?? []) upstream.write(chunk);
      },
      data(client, data) {
        const upstream = upstreams.get(client);
        if (upstream) upstream.write(data);
        else buffered.get(client)?.push(data);
      },
      close(client) {
        upstreams.get(client)?.close();
        upstreams.delete(client);
        buffered.delete(client);
      },
      error(client) {
        upstreams.get(client)?.close();
        upstreams.delete(client);
        buffered.delete(client);
      },
    },
  });

  let received = 0;
  const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/`);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve) => {
    ws.addEventListener("open", () => {
      // Read the handshake cost off the counter before any frame is sent.
      baseline = wireBytes;
      for (const f of frames) ws.send(f, opts.compress);
    });
    ws.addEventListener("message", (e) => {
      const bytes = new Uint8Array(e.data as ArrayBuffer);
      // Decoding proves the frame survived the round trip under this framing.
      if (opts.format === "old") oldDecode(bytes);
      else newDecode(bytes);
      received++;
    });
    ws.addEventListener("close", () => resolve());
    setTimeout(() => {
      ws.close();
      resolve();
    }, 300);
  });

  proxy.stop(true);
  server.stop(true);
  if (received !== frames.length) {
    throw new Error(
      `${opts.format}/compress=${opts.compress}: ${received}/${frames.length} echoed`,
    );
  }
  // Close frames are sent by the client, so only the payload leg is left to account for.
  return wireBytes - baseline;
}

const kb = (n: number) => (n / 1024).toFixed(1).padStart(6);

interface Row {
  name: string;
  frames: number;
  payload: number;
  oldRaw: number;
  oldDefl: number;
  newRaw: number;
  newDefl: number;
}

const rows: Row[] = [];
for (const w of workloads) {
  const oldFrames = w.frames.map((f, i) => oldEncode(i * f.length, f));
  const newFrames = w.frames.map((f, i) => newEncode(i * f.length, f));
  rows.push({
    name: w.name,
    frames: w.frames.length,
    payload: w.frames.reduce((n, f) => n + f.length, 0),
    oldRaw: await measureOnWire(oldFrames, { format: "old", compress: false }),
    oldDefl: await measureOnWire(oldFrames, { format: "old", compress: true }),
    newRaw: await measureOnWire(newFrames, { format: "new", compress: false }),
    newDefl: await measureOnWire(newFrames, { format: "new", compress: true }),
  });
}

console.log("bytes on the TCP connection per run (KiB), counted at the socket\n");
console.log("workload                frames  payload    old raw  old+defl    new raw  new+defl");
console.log("-".repeat(78));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(22)}${String(r.frames).padStart(5)}  ${kb(r.payload)}` +
      `  ${kb(r.oldRaw)}  ${kb(r.oldDefl)}  ${kb(r.newRaw)}  ${kb(r.newDefl)}`,
  );
}

console.log("\nevery variant as a percentage of old raw (lower is better)\n");
console.log("workload                 old raw    old+defl     new raw    new+defl");
console.log("-".repeat(64));
for (const r of rows) {
  const rel = (n: number) => `${((n / r.oldRaw) * 100).toFixed(1)}%`.padStart(10);
  console.log(
    `${r.name.padEnd(22)}${rel(r.oldRaw)} ${rel(r.oldDefl)} ${rel(r.newRaw)} ${rel(r.newDefl)}`,
  );
}

console.log("\nsaving versus old raw\n");
console.log("workload              old+defl     new raw    new+defl        best");
console.log("-".repeat(72));
for (const r of rows) {
  const save = (n: number) => `${((1 - n / r.oldRaw) * 100).toFixed(1)}%`.padStart(9);
  const best = Math.min(r.oldDefl, r.newRaw, r.newDefl);
  const who =
    best === r.oldDefl ? "old + deflate" : best === r.newRaw ? "binary alone" : "binary + deflate";
  console.log(
    `${r.name.padEnd(22)}${save(r.oldDefl)} ${save(r.newRaw)} ${save(r.newDefl)}` +
      `   ${who} (${((1 - best / r.oldRaw) * 100).toFixed(1)}%)`,
  );
}
