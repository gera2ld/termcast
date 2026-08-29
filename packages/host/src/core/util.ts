/** Returns a shallow copy with every `undefined` field dropped, so partial
 *  patches merge without clobbering fields the caller meant to leave alone. */
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function isLoopbackHost(host: string): boolean {
  return (
    host === "127.0.0.1" || host === "::1" || host === "::ffff:127.0.0.1" || host === "localhost"
  );
}
