import type { ITermToken } from "../core/types";
import { getDb } from "@termcast/shared/server";

interface TokenRow {
  token: string;
  payload: string;
  created_at: number;
  expire_at: number;
}

function rowToEntry<T>(row: TokenRow): ITermToken<T> {
  return {
    token: row.token,
    createdAt: row.created_at,
    expireAt: row.expire_at,
    payload: JSON.parse(row.payload) as T,
  };
}

export class TokenProvider {
  private kind: string;
  private defaultTtl: number;

  constructor(kind: string, defaultTtl: number) {
    this.kind = kind;
    this.defaultTtl = defaultTtl;
  }

  create<T>(payload: T, options?: { ttl?: number; token?: string }): ITermToken<T> {
    const token = options?.token ?? crypto.randomUUID().replace(/-/g, "");
    const now = Date.now();
    const ttl = options?.ttl ?? this.defaultTtl;
    const expireAt = ttl > 0 ? now + ttl * 1000 : 0;
    getDb().run(
      "INSERT INTO tokens (token, kind, payload, created_at, expire_at) VALUES (?, ?, ?, ?, ?)",
      [token, this.kind, JSON.stringify(payload), now, expireAt],
    );
    return { token, createdAt: now, expireAt, payload };
  }

  verify<T>(
    token: string,
    options?: { delete?: boolean; predicate?: (payload: T) => boolean },
  ): ITermToken<T> {
    const entry = this.get<T>(token);
    if (!entry) throw new Error("Token not found");
    if (entry.expireAt > 0 && Date.now() > entry.expireAt) {
      this.remove(token);
      throw new Error("Token expired");
    }
    if (options?.predicate && !options.predicate(entry.payload)) {
      throw new Error("Token predicate failed");
    }
    if (options?.delete) this.remove(token);
    return entry;
  }

  get<T>(token: string): ITermToken<T> | undefined {
    const row = getDb()
      .query(
        "SELECT token, payload, created_at, expire_at FROM tokens WHERE token = ? AND kind = ?",
      )
      .get(token, this.kind) as TokenRow | undefined;
    return row ? rowToEntry<T>(row) : undefined;
  }

  updatePayload<T extends object>(token: string, patch: Partial<T>): void {
    const entry = this.get<T>(token);
    if (!entry) return;
    const merged = { ...entry.payload, ...patch };
    getDb().run("UPDATE tokens SET payload = ? WHERE token = ?", [JSON.stringify(merged), token]);
  }

  renew(token: string, ttl: number): number {
    const entry = this.get(token);
    if (!entry) throw new Error("Token not found");
    const now = Date.now();
    const expireAt = ttl > 0 ? now + ttl * 1000 : 0;
    getDb().run("UPDATE tokens SET expire_at = ? WHERE token = ?", [expireAt, token]);
    return expireAt;
  }

  remove(token: string): void {
    getDb().run("DELETE FROM tokens WHERE token = ?", [token]);
  }

  entries<T>(): ITermToken<T>[] {
    const now = Date.now();
    const rows = getDb()
      .query("SELECT token, payload, created_at, expire_at FROM tokens WHERE kind = ?")
      .all(this.kind) as TokenRow[];
    return rows.filter((r) => r.expire_at === 0 || now <= r.expire_at).map(rowToEntry<T>);
  }

  cleanUp(): void {
    const now = Date.now();
    getDb().run("DELETE FROM tokens WHERE kind = ? AND expire_at > 0 AND expire_at < ?", [
      this.kind,
      now,
    ]);
  }
}

export const tokenProvider = new TokenProvider("share", 7 * 24 * 60 * 60);

const ownerTokens = new TokenProvider("owner", 7 * 24 * 60 * 60);

export function issueOwnerToken() {
  return ownerTokens.create({ verified: true });
}

export function verifyOwnerToken(token?: string): boolean {
  if (!token) return false;
  try {
    ownerTokens.verify(token);
    return true;
  } catch {
    return false;
  }
}

export function revokeOwnerToken(token?: string): void {
  if (token) ownerTokens.remove(token);
}

const challenges = new Map<string, string>();

export function setChallenge(key: string, challenge: string) {
  challenges.set(key, challenge);
}

export function getChallenge(key: string): string | undefined {
  return challenges.get(key);
}

export function clearChallenge(key: string) {
  challenges.delete(key);
}
