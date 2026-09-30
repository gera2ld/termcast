let shareMode = false;

export function setShareMode(on = true) {
  shareMode = on;
}

export const isShareMode = () => shareMode;
