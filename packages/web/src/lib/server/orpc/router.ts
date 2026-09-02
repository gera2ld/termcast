import { ORPCError } from "@orpc/client";
import { implement } from "@orpc/server";
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
import type { InitialContext, ServerState } from "@termcast/shared";
import { contract, rpIdShape } from "@termcast/shared";
import { z } from "zod";
import { PORT } from "../core/config";
import { logError } from "../core/log";
import { bus } from "../core/events";
import type { IShareSession } from "../core/types";
import {
  getTunnelState,
  resolveCloudflared,
  startTunnel,
  stopTunnel,
} from "../services/cloudflared";
import { signGrantToken, verifyGrantToken } from "@termcast/shared/server";
import {
  configure,
  getExpectedOrigin,
  getSettings,
  needsSetup,
  setCloudflaredTunnel,
  updateEditable,
} from "../services/settings";
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
} from "../services/store";
import { tabRegistry } from "../services/tab";
import {
  clearChallenge,
  getChallenge,
  issueOwnerToken,
  revokeOwnerToken,
  setChallenge,
  tokenProvider,
} from "../services/token";
import { buildUserInfo } from "../handlers/realtime";
import { authMiddleware, requireVerified } from "./middleware";

const challengeKey = (token?: string) => token ?? "anon";

const impl = implement(contract).$context<InitialContext>().use(authMiddleware);

export const router = impl.router({
  dashboard: {
    get: impl.dashboard.get.handler(async ({ context }) => {
      requireVerified(context);
      const settings = getSettings();
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
    }),
  },
  auth: {
    token: impl.auth.token.handler(async ({ input, context }) => {
      if (input.grant) {
        await verifyGrantToken(input.grant);
        const t = issueOwnerToken();
        return { token: t.token, expiresAt: t.expireAt };
      }
      requireVerified(context);
      const t = issueOwnerToken();
      return { token: t.token, expiresAt: t.expireAt };
    }),
    logout: impl.auth.logout.handler(async ({ context }) => {
      revokeOwnerToken(context.token);
      return {};
    }),
    link: impl.auth.link.handler(async ({ context }) => {
      requireVerified(context);
      const token = await signGrantToken();
      return { token };
    }),
  },
  setup: {
    configure: impl.setup.configure.handler(async ({ input, context }) => {
      requireVerified(context);
      configure(input);
      bus.emit("settings");
      return {};
    }),
  },
  webauthn: {
    registration: {
      options: impl.webauthn.registration.options.handler(async ({ context }) => {
        requireVerified(context);
        const settings = getSettings();
        if (needsSetup()) {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "TermCast hasn't been set up yet. Sign in with a one-time token (run `termcast grant` on the server) to configure it.",
          });
        }
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
        const parsed = rpIdShape.safeParse(options);
        if (!parsed.success) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: z.prettifyError(parsed.error),
          });
        }
        setChallenge(challengeKey(context.token), options.challenge);
        return { options };
      }),
      verify: impl.webauthn.registration.verify.handler(async ({ input, context }) => {
        requireVerified(context);
        const expectedChallenge = getChallenge(challengeKey(context.token)) as string;
        const expectedOrigin = getExpectedOrigin(context.request.headers.get("origin") ?? "");
        if (!expectedOrigin) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Origin not allowed: ${context.request.headers.get("origin") ?? ""}`,
          });
        }
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
          throw new ORPCError("BAD_REQUEST", {
            message: `Registration verification failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        throw new ORPCError("BAD_REQUEST", { message: "Registration verification failed" });
      }),
    },
    authentication: {
      options: impl.webauthn.authentication.options.handler(async ({ context }) => {
        const devices = getDevices();
        const settings = getSettings();
        if (needsSetup()) {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "TermCast hasn't been set up yet. Sign in with a one-time token (run `termcast grant` on the server) to configure it.",
          });
        }
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
        const parsed = rpIdShape.safeParse(options);
        if (!parsed.success) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: z.prettifyError(parsed.error),
          });
        }
        setChallenge(challengeKey(context.token), options.challenge);
        return { options };
      }),
      verify: impl.webauthn.authentication.verify.handler(async ({ input, context }) => {
        const expectedChallenge = getChallenge(challengeKey(context.token)) as string;
        const devices = getDevices();
        const expectedOrigin = getExpectedOrigin(context.request.headers.get("origin") ?? "");
        if (!expectedOrigin) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Origin not allowed: ${context.request.headers.get("origin") ?? ""}`,
          });
        }
        const settings = getSettings();
        let verified = false;
        for (const device of devices) {
          try {
            const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse(
              {
                response: input.authResp as AuthenticationResponseJSON,
                expectedChallenge,
                expectedOrigin,
                credential: {
                  id: device.credential.id,
                  publicKey: device.credential.publicKey,
                  counter: device.credential.counter,
                },
                expectedRPID: settings.rpId,
              },
            );
            if (verification.verified) {
              verified = true;
              persistDevice(device, { lastUsedAt: new Date().toISOString() });
              break;
            }
          } catch (err) {
            logError(err);
          }
        }
        if (!verified) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Authentication failed: passkey assertion could not be verified",
          });
        }
        clearChallenge(challengeKey(context.token));
        return { verified, token: issueOwnerToken().token };
      }),
    },
  },
  settings: {
    update: impl.settings.update.handler(async ({ input, context }) => {
      requireVerified(context);
      updateEditable(input);
      bus.emit("settings");
      const settings = getSettings();
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
    }),
  },
  devices: {
    list: impl.devices.list.handler(async ({ context }) => {
      requireVerified(context);
      return {
        devices: getDevices().map((d) => ({
          id: d.credential.id,
          name: d.name,
          createdAt: d.createdAt,
          lastUsedAt: d.lastUsedAt,
        })),
      };
    }),
    remove: impl.devices.remove.handler(async ({ input, context }) => {
      requireVerified(context);
      removeDeviceById(input.id);
      bus.emit("devices.remove", input.id);
      return {};
    }),
    rename: impl.devices.rename.handler(async ({ input, context }) => {
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
    }),
  },
  commands: {
    list: impl.commands.list.handler(async ({ context }) => {
      requireVerified(context);
      return {
        commands: getCommands(),
      };
    }),
    add: impl.commands.add.handler(async ({ input, context }) => {
      requireVerified(context);
      const command = addCommand(input);
      bus.emit("commands.upsert", command);
      return command;
    }),
    update: impl.commands.update.handler(async ({ input, context }) => {
      requireVerified(context);
      const command = await updateCommand(input.id, {
        label: input.label,
        args: input.args,
      });
      bus.emit("commands.upsert", command);
      return command;
    }),
    remove: impl.commands.remove.handler(async ({ input, context }) => {
      requireVerified(context);
      removeCommand(input.id);
      bus.emit("commands.remove", input.id);
      return {};
    }),
  },
  shares: {
    create: impl.shares.create.handler(async ({ input, context }) => {
      requireVerified(context);
      const tab = tabRegistry.get(input.tabId);
      if (!tab) throw new ORPCError("NOT_FOUND", { message: "Tab not found" });
      const token = tokenProvider.create<IShareSession>(
        {
          allowWrite: input.allowWrite,
          tabId: input.tabId,
          maxConnections: input.maxConnections,
        },
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
    }),
    list: impl.shares.list.handler(async ({ input, context }) => {
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
    }),
    update: impl.shares.update.handler(async ({ input, context }) => {
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
    }),
    renew: impl.shares.renew.handler(async ({ input, context }) => {
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
    }),
    delete: impl.shares.delete.handler(async ({ input, context }) => {
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
    }),
    revokeAll: impl.shares.revokeAll.handler(async ({ input, context }) => {
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
    }),
  },
  tabs: {
    list: impl.tabs.list.handler(async ({ context }) => {
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
    }),
    open: impl.tabs.open.handler(async ({ input, context }) => {
      requireVerified(context);
      const command = getCommand(input.commandId);
      if (!command) throw new ORPCError("NOT_FOUND", { message: "Command not found" });
      const tab = tabRegistry.open({ commandId: command.id, args: command.args });
      return {
        id: tab.id,
        commandId: tab.commandId ?? null,
        args: tab.args,
      };
    }),
    get: impl.tabs.get.handler(async ({ input, context }) => {
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
    }),
    close: impl.tabs.close.handler(async ({ input, context }) => {
      requireVerified(context);
      tabRegistry.remove(input.id);
      return {};
    }),
  },
  tunnel: {
    post: impl.tunnel.post.handler(async ({ input, context }) => {
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
    }),
    resolve: impl.tunnel.resolve.handler(async ({ context }) => {
      requireVerified(context);
      const url = await resolveCloudflared();
      return { url };
    }),
  },
});

export type AppRouter = typeof router;
