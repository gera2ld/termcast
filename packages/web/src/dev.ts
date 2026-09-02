import { onError, ORPCError, ValidationError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Interceptor } from "@orpc/shared";
import type { InitialContext } from "@termcast/shared";
import { z } from "zod";
import { logError } from "$lib/server/core/log";
import { PORT } from "$lib/server/core/config";
import { router } from "$lib/server/orpc/router";
import { tryUpgrade, websocket } from "$lib/server/ws";

const formatValidationError: Interceptor<any, any> = async (options) => {
  try {
    return await options.next();
  } catch (error) {
    if (error instanceof ORPCError && error.cause instanceof ValidationError) {
      throw new ORPCError(error.code, {
        message: z.prettifyError(error.cause),
        data: error.data,
        cause: error.cause,
      });
    }
    throw error;
  }
};

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      logError(error);
    }),
    formatValidationError,
  ],
});

const devPort = Number(process.env.DEV_PORT ?? PORT);

Bun.serve({
  port: devPort,
  hostname: "0.0.0.0",
  development: true,
  async fetch(req, server) {
    const res = tryUpgrade(req, server);
    if (res) return res;
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const { matched, response } = await rpcHandler.handle(req, {
      prefix: "/rpc",
      context: { token, request: req } satisfies InitialContext,
    });
    if (matched) return response;
    return new Response("Not found", { status: 404 });
  },
  websocket,
});

console.log(`TermCast dev API/WS server on http://localhost:${devPort}`);
