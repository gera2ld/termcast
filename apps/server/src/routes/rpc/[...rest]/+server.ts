import { onError, ORPCError, ValidationError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Interceptor } from "@orpc/shared";
import type { RequestEvent } from "@sveltejs/kit";
import type { InitialContext } from "@termcast/shared";
import { router } from "#lib/server/orpc/router.js";
import { logError } from "#lib/server/core/log.js";
import { z } from "zod";

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

export async function POST(event: RequestEvent) {
  const auth = event.request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const { matched, response } = await rpcHandler.handle(event.request, {
    prefix: "/rpc",
    context: { token, request: event.request } satisfies InitialContext,
  });
  if (matched) return response;
  return new Response("Not found", { status: 404 });
}
