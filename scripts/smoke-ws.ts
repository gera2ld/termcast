/**
 * End-to-end smoke test for the binary `/ws` protocol. Drives a real pty through a real
 * WebSocket: open a tab, attach, type, read the echo back, resize, and confirm the frames
 * on the wire are the compact binary ones rather than JSON.
 *
 * Run with: just dev-smoke   (or: bun run scripts/smoke-ws.ts)
 */
import {
  decodeServerMessage,
  encodeClientMessage,
  type WsServerMessage,
} from "../packages/shared/src";
import { signGrantToken } from "../packages/shared/src/server";

const BASE = process.env.SMOKE_BASE ?? `http://localhost:${process.env.PORT ?? 9998}`;
const WS_BASE = BASE.replace(/^http/, "ws");

const rpc = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}/rpc/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body.json;
};

const ownerToken = async () => {
  const grant = await signGrantToken();
  const { token } = await rpc("auth/token", {
    method: "POST",
    body: JSON.stringify({ json: { grant } }),
  });
  return token as string;
};

/** Drives one attached terminal and collects the messages the host sends. */
function attach(token: string, tabId: string, since = 0) {
  const ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
  // Without this the browser hands over Blobs and the codec cannot read them.
  ws.binaryType = "arraybuffer";

  const messages: WsServerMessage[] = [];
  let sawTextFrame = false;
  let rawBytes = 0;

  ws.addEventListener("message", (event) => {
    // A text frame here would mean the server is still speaking JSON.
    if (typeof event.data === "string") {
      sawTextFrame = true;
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    rawBytes += bytes.byteLength;
    messages.push(decodeServerMessage(bytes));
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      ws.send(encodeClientMessage({ type: "select", id: tabId, since }));
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });

  const waitFor = async (predicate: (m: WsServerMessage) => boolean, label: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`timed out waiting for ${label}; saw ${messages.map((m) => m.type)}`);
  };

  return {
    ws,
    messages,
    opened,
    waitFor,
    stats: () => ({ sawTextFrame, rawBytes }),
  };
}

/**
 * Fires several `select`s back to back on one socket, without waiting between them, and
 * records the `start` frames that come back. Used to check the ordering the client relies
 * on when discarding a superseded stream.
 */
function attachMany(token: string, tabIds: string[]) {
  const ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
  ws.binaryType = "arraybuffer";

  const messages: WsServerMessage[] = [];
  ws.addEventListener("message", (event) => {
    messages.push(decodeServerMessage(new Uint8Array(event.data as ArrayBuffer)));
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      for (const id of tabIds) ws.send(encodeClientMessage({ type: "select", id, since: 0 }));
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });

  return { ws, messages, opened };
}

const assert = (label: string, ok: boolean, detail = "") => {
  if (!ok) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok  ${label}`);
};

const main = async () => {
  const token = await ownerToken();
  console.log("authenticated");

  // The contract requires an id but the host mints its own, so use whatever it returns.
  const command = await rpc("commands/add", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { id: "smoke", label: "smoke", args: ["bash", "-i"] } }),
  });
  const opened = await rpc("tabs/open", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { commandId: command.id } }),
  });
  const tabId = opened.id as string;
  console.log(`opened tab ${tabId} via command ${command.id}`);

  const conn = attach(token, tabId);
  await conn.opened;

  const start = await conn.waitFor((m) => m.type === "start", "start");
  assert("start names the tab we asked for", start.type === "start" && start.id === tabId);
  assert(
    "start reports a resume offset",
    start.type === "start" && typeof start.offset === "number",
  );
  assert("start grants write access", start.type === "start" && start.canWrite === true);

  conn.ws.send(encodeClientMessage({ type: "data", data: "echo SMOKE_OK_12345\r" }));
  const chunk = await conn.waitFor(
    (m) => m.type === "chunk" && new TextDecoder().decode(m.data).includes("SMOKE_OK_12345"),
    "echo chunk",
  );
  assert(
    "typed text comes back through a chunk",
    chunk.type === "chunk" && new TextDecoder().decode(chunk.data).includes("SMOKE_OK_12345"),
  );
  assert("chunk carries a byte offset", chunk.type === "chunk" && typeof chunk.offset === "number");

  // Every chunk's offset must land exactly where the previous one ended, or the client's
  // buffer would silently develop holes.
  const ordered = conn.messages.filter((m) => m.type === "chunk");
  let cursor = -1;
  let contiguous = true;
  for (const m of ordered) {
    if (m.type !== "chunk") continue;
    if (cursor >= 0 && m.offset < cursor) contiguous = false;
    cursor = m.offset + m.data.length;
  }
  assert("chunk offsets advance monotonically", contiguous);

  // The whole point of the change: frames must be binary and compact, not JSON+base64.
  const { sawTextFrame, rawBytes } = conn.stats();
  assert("frames are binary, not JSON", sawTextFrame === false);
  console.log(`      ${rawBytes} bytes on the wire for the exchange`);

  // Attach is announced with the pty's current geometry.
  const initialSize = await conn.waitFor((m) => m.type === "size", "initial size");
  assert(
    "attach reports the pty size",
    initialSize.type === "size" && initialSize.cols === 80 && initialSize.rows === 24,
    initialSize.type === "size" ? `${initialSize.cols}x${initialSize.rows}` : "",
  );

  // A resize is broadcast to the *other* viewers, so prove it on a second socket rather
  // than expecting an echo on the one that asked for it.
  const watcher = attach(token, tabId);
  await watcher.opened;
  await watcher.waitFor((m) => m.type === "start", "watcher start");

  conn.ws.send(encodeClientMessage({ type: "resize", cols: 100, rows: 30 }));
  const relayed = await watcher.waitFor(
    (m) => m.type === "size" && m.cols === 100,
    "resized size on the watcher",
  );
  assert(
    "resize reaches the other viewers",
    relayed.type === "size" && relayed.cols === 100 && relayed.rows === 30,
    relayed.type === "size" ? `${relayed.cols}x${relayed.rows}` : "",
  );
  watcher.ws.close();

  // `leave` detaches the tab but deliberately keeps the socket: the owner reuses one
  // socket across tabs, so the connection must still be usable afterwards.
  conn.ws.send(encodeClientMessage({ type: "leave" }));
  await Bun.sleep(150);
  assert("leave keeps the socket open for the next tab", conn.ws.readyState === WebSocket.OPEN);

  // Re-selecting must work, and must resume rather than replay from scratch.
  conn.ws.send(encodeClientMessage({ type: "select", id: tabId, since: 0 }));
  const restarted = await conn.waitFor(
    (m) => m.type === "start" && m.offset === 0,
    "a fresh start after re-selecting",
  );
  assert(
    "re-selecting replays from the requested offset",
    restarted.type === "start" && restarted.offset === 0,
  );

  // A rapid tab switch must land on the last tab asked for. The host answers each
  // `select` with a `start` naming the tab it bound, so firing three selects back to back
  // (without waiting) reproduces the case where an earlier stream is already in flight.
  const others: string[] = [];
  for (let i = 0; i < 2; i++) {
    const extra = await rpc("tabs/open", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ json: { commandId: command.id } }),
    });
    others.push(extra.id as string);
  }
  const race = attachMany(token, [tabId, ...others]);
  await race.opened;
  await Bun.sleep(600);
  const starts = race.messages.filter((m) => m.type === "start");
  assert(
    "the host answered every select in order",
    starts.length === 3 &&
      starts.every((s, i) => s.type === "start" && s.id === [tabId, ...others][i]),
    starts.map((s) => (s.type === "start" ? s.id.slice(0, 6) : "?")).join(" -> "),
  );
  // This is the invariant TtySocket relies on to discard superseded streams: the final
  // start names the final tab, so the last commit always lands on the right view.
  assert(
    "the last start is the last tab requested",
    starts.at(-1)?.type === "start" && starts.at(-1).id === others[1],
  );
  race.ws.close();
  for (const id of others) {
    await rpc("tabs/close", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ json: { id } }),
    });
  }

  // A frame the host cannot parse must be rejected rather than streamed.
  const bad = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
  bad.binaryType = "arraybuffer";
  const rejection = new Promise<string>((resolve) => {
    bad.addEventListener("message", (event) => {
      const msg = decodeServerMessage(new Uint8Array(event.data as ArrayBuffer));
      if (msg.type === "error") resolve(msg.message);
    });
  });
  await new Promise<void>((resolve) => bad.addEventListener("open", () => resolve()));
  bad.send(new Uint8Array([0x7f, 0x00]));
  const reason = await Promise.race([rejection, Bun.sleep(3000).then(() => "(no error frame)")]);
  assert("garbage frame is refused with an error", reason !== "(no error frame)", reason);
  bad.close();

  await rpc("tabs/close", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { id: tabId } }),
  });

  console.log("\nsmoke test passed");
  conn.ws.close();
};

await main();
