let shareMode = false;

/** Marks the process as running a `termcast share` session. Set before buildApp(). */
export function setShareMode(on = true) {
  shareMode = on;
}

export const isShareMode = () => shareMode;
