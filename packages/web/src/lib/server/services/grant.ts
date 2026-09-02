import { SignJWT, jwtVerify } from "jose";
import { getDb } from "./db";

const ALGORITHM = "HS256";
const GRANT_TTL = 5 * 60; // 5 minutes in seconds

function getSessionKey(): Uint8Array {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'sessionEncryptionKey'").get() as
    | { value: string }
    | undefined;
  if (!row) throw new Error("Session encryption key not configured");
  return new TextEncoder().encode(JSON.parse(row.value));
}

export async function signGrantToken(): Promise<string> {
  const key = getSessionKey();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${GRANT_TTL}s`)
    .sign(key);
  return token;
}

export async function verifyGrantToken(token: string): Promise<void> {
  const key = getSessionKey();
  await jwtVerify(token, key, { algorithms: [ALGORITHM] });
}
