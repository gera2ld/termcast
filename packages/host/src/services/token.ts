import crypto from "crypto";
import type { ITermToken } from "../core/types";
import { stripUndefined } from "../core/util";

export class TokenProvider {
  private store: Map<string, ITermToken> = new Map();

  constructor(private ttl = 30) {}

  create<T = unknown>(
    payload: T,
    options?: {
      ttl?: number;
      token?: string;
    },
  ) {
    const ttl = options?.ttl ?? this.ttl;
    const token = options?.token ?? crypto.randomBytes(20).toString("hex");
    const tokenObj: ITermToken<T> = {
      token,
      createdAt: Date.now(),
      expireAt: ttl > 0 ? Date.now() + ttl * 1000 : 0,
      payload,
    };
    this.store.set(tokenObj.token, tokenObj);
    return tokenObj;
  }

  verify<T = unknown>(
    token: string,
    options?: {
      delete?: boolean;
      predicate?: (tokenObj: ITermToken<T>) => boolean;
    },
  ) {
    const tokenObj = this.store.get(token) as ITermToken<T>;
    if (tokenObj && options?.delete) this.store.delete(token);
    if (
      !tokenObj ||
      (tokenObj.expireAt >= 0 && tokenObj.expireAt <= Date.now()) ||
      (options?.predicate && !options.predicate(tokenObj))
    ) {
      throw new Error("Invalid token");
    }
    return tokenObj;
  }

  remove(token: string) {
    this.store.delete(token);
  }

  /** Raw read without expiry checks, so handlers can inspect a token's payload. */
  get<T = unknown>(token: string): ITermToken<T> | undefined {
    return this.store.get(token) as ITermToken<T> | undefined;
  }

  /** Shallow-merge a patch into a stored payload, leaving undefined fields untouched. */
  updatePayload<T = unknown>(token: string, patch: Partial<T>): boolean {
    const tokenObj = this.store.get(token) as ITermToken<T> | undefined;
    if (!tokenObj) return false;
    tokenObj.payload = { ...tokenObj.payload, ...stripUndefined(patch) };
    return true;
  }

  /** Extend a token's lifetime, returning the new expireAt (0 means no expiry). */
  renew(token: string, ttl = 3600): number {
    const tokenObj = this.store.get(token);
    if (!tokenObj) return 0;
    const expireAt = ttl > 0 ? Date.now() + ttl * 1000 : 0;
    tokenObj.expireAt = expireAt;
    return expireAt;
  }

  /** Live tokens only, so callers never see ones that have already lapsed. */
  entries<T = unknown>() {
    const now = Date.now();
    return [...this.store.values()].filter(
      (tokenObj) => tokenObj.expireAt < 0 || tokenObj.expireAt > now,
    ) as ITermToken<T>[];
  }

  cleanUp() {
    const now = Date.now();
    for (const tokenObj of this.store.values()) {
      if (tokenObj.expireAt >= 0 && tokenObj.expireAt <= now) this.store.delete(tokenObj.token);
    }
  }
}

export const tokenProvider = new TokenProvider();

// ── Owner auth tokens (opaque, server-side) ──────────────────────────────────────
// Replaces the old cookie-backed session. A token is a random value stored here;
// logout revokes it by deletion. The store is in-memory, so tokens are lost on a
// process restart — an owner re-authenticates via WebAuthn or a fresh grant token
// (see services/grant.ts) afterward. There is no loopback auto-reissue.
export const OWNER_TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days (expiring, no refresh yet)

export const ownerTokens = new TokenProvider(OWNER_TOKEN_TTL);

export function issueOwnerToken(): { token: string; expiresAt: number } {
  const t = ownerTokens.create({ verified: true });
  return { token: t.token, expiresAt: t.expireAt };
}

export function verifyOwnerToken(token?: string | null): boolean {
  if (!token) return false;
  try {
    ownerTokens.verify(token);
    return true;
  } catch {
    return false;
  }
}

export function revokeOwnerToken(token?: string | null): void {
  if (token) ownerTokens.remove(token);
}

// ── WebAuthn challenge store (ephemeral, keyed by owner token) ───────────────────
const challengeStore = new Map<string, string>();

export function setChallenge(key: string, challenge: string): void {
  challengeStore.set(key, challenge);
}

export function getChallenge(key: string): string | undefined {
  return challengeStore.get(key);
}

export function clearChallenge(key: string): void {
  challengeStore.delete(key);
}
