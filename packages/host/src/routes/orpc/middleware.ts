import { os } from "@orpc/server";
import { ORPCError } from "@orpc/client";
import { verifyOwnerToken } from "../../services/token";
import type { AppContext, InitialContext } from "@termcast/shared";

export const authMiddleware = os
  .$context<InitialContext>()
  .middleware(async ({ context, next }) => {
    const verified = verifyOwnerToken(context.token);
    return next({
      context: {
        ...context,
        verified,
      } satisfies AppContext,
    });
  });

export function requireVerified(ctx: AppContext): void {
  if (!ctx.verified) {
    throw new ORPCError("UNAUTHORIZED");
  }
}
