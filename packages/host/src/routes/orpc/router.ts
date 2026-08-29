import { ORPCError } from "@orpc/client";
import type {
  AuthenticationResponseJSON,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { ServerState } from "@termcast/shared";
import { commandArgsSchema, settingsSchema } from "@termcast/shared";
import { z } from "zod";
import { PORT } from "../../core/config";
import { logError } from "../../core/log";
import { bus } from "../../core/events";
import type { IShareSession } from "../../core/types";
import {
  getTunnelState,
  resolveCloudflared,
  startTunnel,
  stopTunnel,
} from "../../services/cloudflared";
import { signGrantToken, verifyGrantToken } from "../../services/grant";
import {
  configure,
  getExpectedOrigin,
  setCloudflaredTunnel,
  settings,
  updateEditable,
} from "../../services/settings";
import {
  addCommand,
  addDevice,
  getCommand,
  getCommands,
  getDevices,
  persistDevice,
  removeCommand,
  removeDeviceById,
  updateCommand,
} from "../../services/store";
import { tabRegistry } from "../../services/tab";
import {
  clearChallenge,
  getChallenge,
  issueOwnerToken,
  revokeOwnerToken,
  setChallenge,
  tokenProvider,
} from "../../services/token";
import { buildUserInfo } from "../realtime";
import { base, requireVerified } from "./middleware";

// WebAuthn challenges are ephemeral and keyed by the caller's owner token.
const challengeKey = (token?: string) => token ?? "anon";

// ── WebAuthn / Settings / Dashboard ─────────────────────────────────────────────

const postLogout = base.handler(async ({ context }) => {
  revokeOwnerToken(context.token);
  return {};
});

// Mint a device-link grant. An already-verified owner requests this; the resulting
// short-lived grant JWT is exchanged for an owner token via auth.token — the same
// path as the `termcast grant` CLI. Replaces the old in-memory server-verify token.
const initServerVerify = base.handler(async ({ context }) => {
  requireVerified(context);
  const token = await signGrantToken();
  return { token };
});

const getRegistrationOptions = base.handler(async ({ context }) => {
  requireVerified(context);
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: settings.rpName,
    rpID: settings.rpId,
    userID: new TextEncoder().encode("term"),
    userName: settings.username,
    userDisplayName: settings.displayName,
    challenge: "challenge",
    supportedAlgorithmIDs: [-7, -257],
  };
  const options = await generateRegistrationOptions(opts);
  setChallenge(challengeKey(context.token), options.challenge);
  return { options };
});

const postVerifyRegistration = base
  .input(z.object({ name: z.string(), attResp: z.any() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const expectedChallenge = getChallenge(challengeKey(context.token)) as string;
    const expectedOrigin = getExpectedOrigin(context.request.headers.get("origin") ?? "");
    if (!expectedOrigin) return { verified: false };
    try {
      const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
        response: input.attResp as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin,
      });
      const { verified, registrationInfo } = verification;
      if (verified && registrationInfo) {
        const { id, publicKey, counter } = registrationInfo.credential;
        const device = await addDevice({
          credential: {
            id,
            publicKey,
            counter,
          },
          name: input.name,
          createdAt: new Date().toISOString(),
        });
        bus.emit("devices.upsert", {
          id: device.credential.id,
          name: device.name,
          createdAt: device.createdAt,
          lastUsedAt: device.lastUsedAt,
        });
        clearChallenge(challengeKey(context.token));
        return { verified, token: issueOwnerToken().token };
      }
    } catch (err) {
      logError(err);
    }
    return { verified: false };
  });

const getAuthenticationOptions = base.handler(async ({ context }) => {
  // NOTE: must be reachable without an owner token — this is the login path itself.
  const devices = getDevices();
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: settings.rpId,
    challenge: "challenge",
    allowCredentials: devices.map((device) => ({
      id: device.credential.id,
      type: "public-key" as const,
      transports: ["internal" as const],
    })),
  };
  const options = await generateAuthenticationOptions(opts);
  setChallenge(challengeKey(context.token), options.challenge);
  return { options };
});

const postVerifyAuthentication = base
  .input(z.object({ authResp: z.any() }))
  .handler(async ({ input, context }) => {
    // NOTE: must be reachable without an owner token — this verifies the login and issues one.
    const expectedChallenge = getChallenge(challengeKey(context.token)) as string;
    const devices = getDevices();
    const expectedOrigin = getExpectedOrigin(context.request.headers.get("origin") ?? "");
    if (!expectedOrigin) return { verified: false, token: undefined };
    let verified = false;
    for (const device of devices) {
      try {
        const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
          response: input.authResp as AuthenticationResponseJSON,
          expectedChallenge,
          expectedOrigin,
          credential: {
            id: device.credential.id,
            publicKey: device.credential.publicKey,
            counter: device.credential.counter,
          },
          expectedRPID: settings.rpId,
        });
        if (verification.verified) {
          verified = true;
          persistDevice(device, { lastUsedAt: new Date().toISOString() });
          break;
        }
      } catch (err) {
        logError(err);
      }
    }
    if (verified) clearChallenge(challengeKey(context.token));
    return { verified, token: verified ? issueOwnerToken().token : undefined };
  });

const postConfigure = base.input(settingsSchema).handler(async ({ input, context }) => {
  // The grant flow supplies a valid owner token before first-run setup, so verification is
  // always required — this also blocks an unauthenticated takeover of a fresh server.
  requireVerified(context);
  configure(input);
  bus.emit("settings");
  return {};
});

const updateSettings = base
  .input(
    z.object({
      rpName: z.string().optional(),
      displayName: z.string().optional(),
      username: z.string().optional(),
      expectedOrigins: z.array(z.string()).optional(),
      webhookTermStarted: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    requireVerified(context);
    updateEditable(input);
    bus.emit("settings");
    // Return updated settings
    return {
      settings: {
        rpId: settings.rpId,
        rpName: settings.rpName,
        username: settings.username,
        displayName: settings.displayName,
        expectedOrigins: settings.expectedOrigins,
        cloudflaredTunnel: settings.cloudflaredTunnel,
        webhookTermStarted: settings.webhookTermStarted,
      },
    };
  });

// ── Device Management ───────────────────────────────────────────────────────────

const getDevicesList = base.handler(async ({ context }) => {
  requireVerified(context);
  return {
    devices: getDevices().map((d) => ({
      id: d.credential.id,
      name: d.name,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt,
    })),
  };
});

const postRemoveDevice = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    removeDeviceById(input.id);
    bus.emit("devices.remove", input.id);
    return {};
  });

const postRenameDevice = base
  .input(z.object({ id: z.string(), name: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const device = getDevices().find((d) => d.credential.id === input.id);
    if (!device) throw new ORPCError("NOT_FOUND", { message: "Device not found" });
    persistDevice(device, { name: input.name });
    bus.emit("devices.upsert", {
      id: device.credential.id,
      name: input.name,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
    });
    return {};
  });

// ── Command Management ──────────────────────────────────────────────────────────

const getCommandsList = base.handler(async ({ context }) => {
  requireVerified(context);
  return {
    commands: getCommands(),
  };
});

const postAddCommand = base
  .input(
    z.object({
      id: z.string(),
      label: z.string(),
      args: commandArgsSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const command = addCommand(input);
    bus.emit("commands.upsert", command);
    return command;
  });

const postUpdateCommand = base
  .input(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      args: commandArgsSchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const command = await updateCommand(input.id, {
      label: input.label,
      args: input.args,
    });
    bus.emit("commands.upsert", command);
    return command;
  });

const postRemoveCommand = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    removeCommand(input.id);
    bus.emit("commands.remove", input.id);
    return {};
  });

// ── Share Tokens ───────────────────────────────────────────────────────────────

const postCreateShareToken = base
  .input(
    z.object({
      tabId: z.string(),
      allowWrite: z.boolean().default(false),
      maxConnections: z.number().int().min(1).default(1),
      expiresIn: z.number().int().min(1).default(3600),
    }),
  )
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const tab = tabRegistry.get(input.tabId);
    if (!tab) throw new ORPCError("NOT_FOUND", { message: "Tab not found" });
    const token = tokenProvider.create<IShareSession>(
      { allowWrite: input.allowWrite, tabId: input.tabId, maxConnections: input.maxConnections },
      { ttl: input.expiresIn },
    );
    tab.addShareToken(token.token);
    bus.emit("tabs.upsert", input.tabId);
    return {
      token: token.token,
      expireAt: token.expireAt > 0 ? token.expireAt : 0,
      allowWrite: input.allowWrite,
      maxConnections: input.maxConnections,
    };
  });

const getShareTokens = base
  .input(z.object({ tabId: z.string().optional() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const tokens = tokenProvider
      .entries<IShareSession>()
      .filter((t) => !input.tabId || t.payload.tabId === input.tabId)
      .map((t) => {
        const tabId = t.payload.tabId;
        const pty = tabId ? tabRegistry.get(tabId)?.pty : undefined;
        return {
          token: t.token,
          expireAt: t.expireAt > 0 ? t.expireAt : 0,
          allowWrite: t.payload.allowWrite,
          maxConnections: t.payload.maxConnections,
          connections: pty?.countForToken(t.token) ?? 0,
          tabId,
        };
      });
    return { tokens };
  });

const updateShareToken = base
  .input(
    z.object({
      token: z.string(),
      allowWrite: z.boolean().optional(),
      maxConnections: z.number().int().min(1).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const entry = tokenProvider.get<IShareSession>(input.token);
    if (!entry) throw new ORPCError("NOT_FOUND", { message: "Token not found" });
    tokenProvider.updatePayload<IShareSession>(input.token, {
      allowWrite: input.allowWrite,
      maxConnections: input.maxConnections,
    });
    const tabId = entry.payload.tabId;
    if (tabId) {
      tabRegistry
        .get(tabId)
        ?.pty?.setTokenAccess(input.token, input.allowWrite ?? entry.payload.allowWrite);
    }
    return {};
  });

const renewShareToken = base
  .input(z.object({ token: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const entry = tokenProvider.get<IShareSession>(input.token);
    if (!entry) throw new ORPCError("NOT_FOUND", { message: "Token not found" });
    const expireAt = tokenProvider.renew(input.token, 3600);
    const tabId = entry.payload.tabId;
    if (tabId) {
      tabRegistry.get(tabId)?.pty?.setTokenExpiry(input.token, expireAt);
    }
    return {
      expireAt: expireAt > 0 ? expireAt : 0,
    };
  });

const deleteShareToken = base
  .input(z.object({ token: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const entry = tokenProvider.get<IShareSession>(input.token);
    const tabId = entry?.payload.tabId;
    tokenProvider.remove(input.token);
    if (tabId) {
      tabRegistry.get(tabId)?.pty?.disconnectToken(input.token);
      tabRegistry.get(tabId)?.removeShareToken(input.token);
      bus.emit("tabs.upsert", tabId);
    }
    return {};
  });

const revokeShareTokens = base
  .input(z.object({ tabId: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const tab = tabRegistry.get(input.tabId);
    const removed = tokenProvider
      .entries<IShareSession>()
      .filter((t) => t.payload.tabId === input.tabId);
    for (const t of removed) {
      tokenProvider.remove(t.token);
      tab?.pty?.disconnectToken(t.token);
      tab?.removeShareToken(t.token);
    }
    bus.emit("tabs.upsert", input.tabId);
    return {};
  });

// ── Dashboard ──────────────────────────────────────────────────────────────────

const getDashboard = base.handler(async ({ context }) => {
  requireVerified(context);
  return {
    user: buildUserInfo(),
    tunnel: {
      state: await getTunnelState(),
    },
    settings: {
      rpId: settings.rpId,
      rpName: settings.rpName,
      username: settings.username,
      displayName: settings.displayName,
      expectedOrigins: settings.expectedOrigins,
      cloudflaredTunnel: settings.cloudflaredTunnel,
      webhookTermStarted: settings.webhookTermStarted,
    },
    tabs: tabRegistry.list().map((tab) => ({
      id: tab.id,
      commandId: tab.commandId ?? null,
      args: tab.args,
      label: tab.commandId ? (getCommand(tab.commandId)?.label ?? null) : null,
      status: tab.isActive ? "active" : "ended",
      connections: tab.connectionCount,
      shareTokens: tab.shareTokens.size,
      createdAt: new Date(tab.createdAt).toISOString(),
      lastActivity: new Date(tab.lastActivity).toISOString(),
    })),
    devices: getDevices().map((d) => ({
      id: d.credential.id,
      name: d.name,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt,
    })),
    commands: getCommands(),
  } satisfies ServerState;
});

// ── Tabs ────────────────────────────────────────────────────────────────────────

const getTabs = base.handler(async ({ context }) => {
  requireVerified(context);
  return {
    tabs: tabRegistry.list().map((tab) => ({
      id: tab.id,
      commandId: tab.commandId ?? null,
      args: tab.args,
      label: tab.commandId ? (getCommand(tab.commandId)?.label ?? null) : null,
      status: tab.isActive ? "active" : "ended",
      connections: tab.connectionCount,
      shareTokens: tab.shareTokens.size,
      createdAt: new Date(tab.createdAt).toISOString(),
      lastActivity: new Date(tab.lastActivity).toISOString(),
    })),
  };
});

const postOpenTab = base
  .input(z.object({ commandId: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    const command = getCommand(input.commandId);
    if (!command) throw new ORPCError("NOT_FOUND", { message: "Command not found" });
    const tab = tabRegistry.open({ commandId: command.id, args: command.args });
    return {
      id: tab.id,
      commandId: tab.commandId ?? null,
      args: tab.args,
    };
  });

const getTab = base.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
  requireVerified(context);
  const tab = tabRegistry.get(input.id);
  if (!tab) throw new ORPCError("NOT_FOUND", { message: "Tab not found" });
  return {
    id: tab.id,
    commandId: tab.commandId ?? null,
    args: tab.args,
    label: tab.commandId ? (getCommand(tab.commandId)?.label ?? null) : null,
    status: tab.isActive ? "active" : "ended",
    connections: tab.connectionCount,
    shareTokens: tab.shareTokens.size,
    createdAt: new Date(tab.createdAt).toISOString(),
    lastActivity: new Date(tab.lastActivity).toISOString(),
  };
});

const postCloseTab = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    tabRegistry.remove(input.id);
    return {};
  });

// ── Tunnel ──────────────────────────────────────────────────────────────────────

const postTunnel = base
  .input(z.object({ action: z.enum(["start", "stop"]) }))
  .handler(async ({ input, context }) => {
    requireVerified(context);
    if (input.action === "start") {
      await startTunnel(PORT);
    } else {
      await stopTunnel();
    }
    setCloudflaredTunnel(input.action === "start");
    bus.emit("tunnel");
    return {
      state: await getTunnelState(),
    };
  });

const postTunnelResolve = base.handler(async ({ context }) => {
  requireVerified(context);
  const url = await resolveCloudflared();
  return { url };
});

// ── Auth token issuance ─────────────────────────────────────────────────────────
// Mint an owner token. Either exchange a grant token (minted by `termcast
// grant`) for an owner token, or renew an existing owner token. Stays on `base` (no
// top-level requireVerified) so the grant path is reachable for first-time owners.
const getAuthToken = base
  .input(z.object({ grant: z.string().optional() }))
  .handler(async ({ input, context }) => {
    if (input.grant) {
      await verifyGrantToken(input.grant);
      return issueOwnerToken();
    }
    requireVerified(context);
    return issueOwnerToken();
  });

// ── Router ─────────────────────────────────────────────────────────────────────

export const router = {
  dashboard: {
    get: getDashboard,
  },
  auth: {
    token: getAuthToken,
    logout: postLogout,
    link: initServerVerify,
  },
  setup: {
    configure: postConfigure,
  },
  webauthn: {
    registration: {
      options: getRegistrationOptions,
      verify: postVerifyRegistration,
    },
    authentication: {
      options: getAuthenticationOptions,
      verify: postVerifyAuthentication,
    },
  },
  settings: {
    update: updateSettings,
  },
  devices: {
    list: getDevicesList,
    remove: postRemoveDevice,
    rename: postRenameDevice,
  },
  commands: {
    list: getCommandsList,
    add: postAddCommand,
    update: postUpdateCommand,
    remove: postRemoveCommand,
  },
  shares: {
    create: postCreateShareToken,
    list: getShareTokens,
    update: updateShareToken,
    renew: renewShareToken,
    delete: deleteShareToken,
    revokeAll: revokeShareTokens,
  },
  tabs: {
    list: getTabs,
    open: postOpenTab,
    get: getTab,
    close: postCloseTab,
  },
  tunnel: {
    post: postTunnel,
    resolve: postTunnelResolve,
  },
};

export type AppRouter = typeof router;
