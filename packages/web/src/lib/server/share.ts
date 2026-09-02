import { startTunnel } from "./services/cloudflared";
import { tabRegistry } from "./services/tab";
import { tokenProvider } from "./services/token";
import { signGrantToken } from "./services/grant";
import type { IShareSession } from "./core/types";
import { shareViewUrl } from "./core/share";

const SHARE_MAX_CONNECTIONS = 5;
const DEFAULT_SHARE_TTL = 60 * 60;

export async function startShareSession(
  commandLine: string[] | undefined,
  port: number,
  ttl?: number,
) {
  const args = commandLine?.length ? commandLine : [process.env.SHELL || "bash"];
  const shareTtl = ttl ?? DEFAULT_SHARE_TTL;

  const tab = tabRegistry.open({ args });
  const tabId = tab.id;

  const tokenObj = tokenProvider.create<IShareSession>(
    {
      tabId,
      allowWrite: false,
      maxConnections: SHARE_MAX_CONNECTIONS,
    },
    { ttl: shareTtl },
  );
  const token = tokenObj.token;
  tab.addShareToken(token);

  const grant = await signGrantToken();
  const baseUrl = `http://localhost:${port}`;
  const ownerUrl = `${baseUrl}/tty/${encodeURIComponent(tabId)}?grant=${grant}`;

  console.log("Creating shared session...");
  const tunnelState = await startTunnel(port);
  if (tunnelState.enabled && tunnelState.url) {
    const friendUrl = shareViewUrl(token, tunnelState.url);
    console.log(`\nShare URL (valid for ${shareTtl / 60}min): ${friendUrl}`);
    console.log(`Owner URL (open within 5min to sign in): ${ownerUrl}`);
    return { friendUrl, ownerUrl, token };
  } else {
    console.warn(`\nTunnel failed to start: ${tunnelState.error ?? "unknown"}`);
    return { ownerUrl, token, error: tunnelState.error ?? "unknown" };
  }
}
