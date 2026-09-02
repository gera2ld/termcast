import { SignJWT, jwtVerify } from "jose";
import { ensureSessionKey } from "./db";

const ALGORITHM = "HS256";
const GRANT_TTL = 5 * 60; // 5 minutes in seconds

export async function signGrantToken(): Promise<string> {
  const key = new TextEncoder().encode(ensureSessionKey());
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${GRANT_TTL}s`)
    .sign(key);
  return token;
}

export async function verifyGrantToken(token: string): Promise<void> {
  const key = new TextEncoder().encode(ensureSessionKey());
  await jwtVerify(token, key, { algorithms: [ALGORITHM] });
}
