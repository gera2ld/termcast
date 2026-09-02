import { json } from "@sveltejs/kit";
import { startShareSession } from "$lib/server/share";
import { PORT } from "$lib/server/core/config";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}) as { command?: string; ttl?: number });
  const command = body.command ? [body.command] : undefined;
  const result = await startShareSession(command, PORT, body.ttl);
  return json(result);
};
