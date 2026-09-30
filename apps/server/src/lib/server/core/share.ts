const SHARE_PATH = "/share";

export function shareViewUrl(token: string, base: string) {
  return `${base}${SHARE_PATH}/${encodeURIComponent(token)}`;
}
