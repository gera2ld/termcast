import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getSettings } from "./settings";

// Short-lived owner grant. Minted by the `termcast grant` CLI subcommand and exchanged
// for a real owner token via auth.token. Signed with the DB-backed sessionEncryptionKey
// so a separate CLI process can issue tokens the server verifies without any shared
// in-memory state. The 5m TTL is the only expiry; one-time use is not enforced.
const GRANT_TTL = "5m";
const GRANT_TYPE = "owner_grant";

function secret(): Uint8Array {
  const settings = getSettings();
  return new TextEncoder().encode(settings.sessionEncryptionKey);
}

export async function signGrantToken(): Promise<string> {
  return new SignJWT({ type: GRANT_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt()
    .setExpirationTime(GRANT_TTL)
    .sign(secret());
}

export interface GrantClaims {
  jti: string;
}

export async function verifyGrantToken(token: string): Promise<GrantClaims> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.type !== GRANT_TYPE || typeof payload.jti !== "string") {
    throw new Error("Invalid grant token");
  }
  return { jti: payload.jti };
}
