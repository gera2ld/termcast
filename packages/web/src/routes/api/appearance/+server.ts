import { json } from "@sveltejs/kit";
import { getSettings } from "$lib/server/services/settings";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  const settings = getSettings();
  return json({ terminalTheme: settings.terminalTheme });
};
