import { os } from "@orpc/server";
import { ORPCError } from "@orpc/client";
import { verifyOwnerToken } from "../../services/token";
import type { InitialContext, AppContext } from "./context";

export const base = os.$context<InitialContext>().use(async ({ context, next }) => {
  const { token } = context;
  const verified = verifyOwnerToken(token);
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
