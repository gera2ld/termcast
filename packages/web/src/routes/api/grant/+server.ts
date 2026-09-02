import { json } from "@sveltejs/kit";
import { signGrantToken } from "$lib/server/services/grant";
import { PORT } from "$lib/server/core/config";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async () => {
  const token = await signGrantToken();
  const url = `http://localhost:${PORT}/?grant=${token}`;
  return json({ token, url });
};
