import { b64decode, b64encode } from "@gera2ld/common";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import z from "zod";
import { parseArgs } from "./util";

export const commandArgsSchema = z.union([
  z.string().transform((cmd) => parseArgs(cmd)),
  z.string().array(),
]);

export const commandSchema = z.object({
  id: z.string(),
  label: z.string(),
  args: commandArgsSchema,
});
export type Command = z.infer<typeof commandSchema>;

export const credentialRecordSchema = z.object({
  id: z.string(),
  publicKey: z.union([z.instanceof(Uint8Array), z.string().transform((b64) => b64decode(b64))]),
  counter: z.number(),
  transports: z.array(z.string<AuthenticatorTransportFuture>()).optional(),
});
export type CredentialRecord = z.infer<typeof credentialRecordSchema>;

export function serializeCredential(credential: CredentialRecord) {
  return JSON.stringify({
    id: credential.id,
    publicKey: b64encode(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
  });
}

export const deviceSchema = z.object({
  name: z.string(),
  credential: z.preprocess(
    (s) => (typeof s === "string" ? JSON.parse(s) : s),
    credentialRecordSchema,
  ),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullish(),
});
export type Device = z.infer<typeof deviceSchema>;

export const deviceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullish(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

// Flat settings schema
export const settingsSchema = z.object({
  // WebAuthn settings
  rpId: z.string(),
  rpName: z.string(),
  username: z.string(),
  displayName: z.string(),
  expectedOrigins: z.string().array().default([]),

  // Server settings — sessionEncryptionKey is the auth-token signing secret and is never
  // returned to clients, so it is optional in the public Settings type.
  sessionEncryptionKey: z.string().optional(),
  cloudflaredTunnel: z.boolean().optional(),

  // Webhooks
  webhookTermStarted: z.string().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const userInfoSchema = z.object({
  needsSetup: z.boolean(),
  hasRegistered: z.boolean(),
});
export type UserInfo = z.infer<typeof userInfoSchema>;

export const cloudflareTunnelStateSchema = z.object({
  enabled: z.boolean(),
  url: z.string().optional(),
  error: z.string().optional(),
  resolved: z.boolean().optional(),
  binaryPath: z.string().optional(),
});
export type CloudflareTunnelState = z.infer<typeof cloudflareTunnelStateSchema>;
