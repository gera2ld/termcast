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
  rpId: z.string().default(""),
  rpName: z.string().default(""),
  username: z.string().default(""),
  displayName: z.string().default(""),
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

// ── oRPC contract output schemas ────────────────────────────────────────────────

export const tokenInfoSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});
export type TokenInfo = z.infer<typeof tokenInfoSchema>;

export const settingsInfoSchema = z.object({
  rpId: z.string().default(""),
  rpName: z.string().default(""),
  username: z.string().default(""),
  displayName: z.string().default(""),
  expectedOrigins: z.string().array(),
  cloudflaredTunnel: z.boolean().optional(),
  webhookTermStarted: z.string().optional(),
});
export type SettingsInfo = z.infer<typeof settingsInfoSchema>;

export const shareTokenInfoSchema = z.object({
  token: z.string(),
  expireAt: z.number(),
  allowWrite: z.boolean(),
  maxConnections: z.number(),
  connections: z.number(),
  tabId: z.string().optional(),
});
export type ShareTokenInfo = z.infer<typeof shareTokenInfoSchema>;

export const tabOpenInfoSchema = z.object({
  id: z.string(),
  commandId: z.string().nullish(),
  args: z.string().array(),
});
export type TabOpenInfo = z.infer<typeof tabOpenInfoSchema>;

export const rpIdShape = z.looseObject({
  rpId: z.string().min(1).optional(),
  rp: z.object({ id: z.string().min(1) }).optional(),
});

export const webauthnRegisterVerifySchema = z.object({
  verified: z.boolean(),
  token: z.string(),
});
export type WebauthnRegisterVerify = z.infer<typeof webauthnRegisterVerifySchema>;

export const webauthnAuthVerifySchema = z.object({
  verified: z.boolean(),
  token: z.string().optional(),
});
export type WebauthnAuthVerify = z.infer<typeof webauthnAuthVerifySchema>;

export const tunnelResolveSchema = z.object({
  url: z.string().optional(),
});
export type TunnelResolve = z.infer<typeof tunnelResolveSchema>;
