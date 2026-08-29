import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "node:path";
import { HonoEnv } from "../core/types";

const embedded = process.env.TERMCAST_EMBEDDED === "1";
const dir = embedded
  ? join(import.meta.dir, "public")
  : (process.env.TERMCAST_WEB_DIR ?? "./build");

export const staticHandler: (app: Hono<HonoEnv>) => void = (app) => {
  app.get("*", serveStatic({ root: dir }), serveStatic({ root: dir, path: "/index.html" }));
};
