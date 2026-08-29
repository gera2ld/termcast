let verbose = false;

export function setVerbose(value: boolean) {
  verbose = value;
}

export function logError(...args: unknown[]) {
  if (verbose) console.error(...args);
}
