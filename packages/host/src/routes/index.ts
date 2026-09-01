import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { poweredBy } from "hono/powered-by";
import type { InitialContext } from "@termcast/shared";
import { router } from "./orpc/router";
import type { HonoEnv } from "../core/types";
import { setVerbose, logError } from "../core/log";
import { setupRealtime } from "./realtime";
import { setUpWebSocket } from "./websocket";
import { staticHandler } from "./static-handler";

export async function buildApp(options: { verbose?: boolean } = {}) {
  const app = new Hono<HonoEnv>();

  setVerbose(options.verbose ?? false);

  if (options.verbose) app.use(logger());

  app.use(poweredBy());

  // oRPC RPC handler — mounts all procedure endpoints at /rpc. Auth is token-based:
  // the raw bearer token is pulled from the Authorization header and handed to the
  // oRPC context, where the `base` middleware verifies it.
  const orpcHandler = new RPCHandler(router, {
    interceptors: [
      onError((error) => {
        logError(error);
      }),
    ],
  });
  app.use("/rpc/*", async (c, next) => {
    const auth = c.req.header("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    const { matched, response } = await orpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context: {
        token,
        request: c.req.raw,
      } satisfies InitialContext,
    });
    if (matched) {
      return c.newResponse(response.body, response);
    }
    await next();
  });

  setUpWebSocket(app);
  setupRealtime(app);
  staticHandler(app);

  return app;
}
