import { getSettings } from "#lib/server/services/settings.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  const settings = getSettings();
  return Response.json({ terminalTheme: settings.terminalTheme });
};
