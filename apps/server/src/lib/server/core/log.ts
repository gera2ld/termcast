let _verbose = false;

export function setVerbose(value: boolean) {
  _verbose = value;
}

export function logError(...args: unknown[]) {
  console.error(...args);
}
