import type { Hono } from "hono";
import { websocket } from "hono/bun";
import { PORT } from "../core/config";
import { isShareMode } from "../core/mode";
import type { HonoEnv } from "../core/types";

export function startServer(app: Hono<HonoEnv>, options: { development: boolean }) {
  // `share` is meant for the machine owner + a tunnel, so it stays on loopback unless
  // an explicit HOST overrides it.
  const hostname = process.env.HOST ?? (isShareMode() ? "127.0.0.1" : "0.0.0.0");
  const server = Bun.serve({
    fetch: app.fetch,
    websocket,
    port: PORT,
    hostname,
    development: options.development,
  });
  if (!process.env.PORT) process.env.PORT = String(server.port);
  console.log(
    `TermCast listening on http://${isShareMode() ? "localhost" : hostname}:${server.port}`,
  );
}
