/** Internal name of the tab that renders a shared session. */
export const SHARE_VIEW = "@share";

/** Public path a guest uses to join a shared session, followed by the token. */
export const SHARE_PATH = "/share";

export function shareViewUrl(token: string, base: string) {
  return `${base}${SHARE_PATH}/${encodeURIComponent(token)}`;
}
