/** Public path a guest uses to join a shared session, followed by the token. */
const SHARE_PATH = "/share";

export function shareViewUrl(token: string, base: string) {
  return `${base}${SHARE_PATH}/${encodeURIComponent(token)}`;
}
