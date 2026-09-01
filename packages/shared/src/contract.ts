import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  cloudflareTunnelStateSchema,
  commandArgsSchema,
  commandSchema,
  deviceInfoSchema,
  settingsInfoSchema,
  settingsSchema,
  shareTokenInfoSchema,
  tabOpenInfoSchema,
  tokenInfoSchema,
  tunnelResolveSchema,
  webauthnAuthVerifySchema,
  webauthnOptionsSchema,
  webauthnRegisterVerifySchema,
} from "./schemas";
import { serverStateSchema, tabInfoSchema } from "./state";

const empty = z.object({});

export const contract = oc.router({
  dashboard: {
    get: oc.output(serverStateSchema),
  },
  auth: {
    token: oc.input(z.object({ grant: z.string().optional() })).output(tokenInfoSchema),
    logout: oc.output(empty),
    link: oc.output(z.object({ token: z.string() })),
  },
  setup: {
    configure: oc.input(settingsSchema).output(empty),
  },
  webauthn: {
    registration: {
      options: oc.output(webauthnOptionsSchema),
      verify: oc
        .input(z.object({ name: z.string(), attResp: z.any() }))
        .output(webauthnRegisterVerifySchema),
    },
    authentication: {
      options: oc.output(webauthnOptionsSchema),
      verify: oc.input(z.object({ authResp: z.any() })).output(webauthnAuthVerifySchema),
    },
  },
  settings: {
    update: oc
      .input(
        z.object({
          rpName: z.string().optional(),
          displayName: z.string().optional(),
          username: z.string().optional(),
          expectedOrigins: z.string().array().optional(),
          webhookTermStarted: z.string().optional(),
        }),
      )
      .output(z.object({ settings: settingsInfoSchema })),
  },
  devices: {
    list: oc.output(z.object({ devices: deviceInfoSchema.array() })),
    remove: oc.input(z.object({ id: z.string() })).output(empty),
    rename: oc.input(z.object({ id: z.string(), name: z.string() })).output(empty),
  },
  commands: {
    list: oc.output(z.object({ commands: commandSchema.array() })),
    add: oc
      .input(
        z.object({
          id: z.string(),
          label: z.string(),
          args: commandArgsSchema,
        }),
      )
      .output(commandSchema),
    update: oc
      .input(
        z.object({
          id: z.string(),
          label: z.string().optional(),
          args: commandArgsSchema.optional(),
        }),
      )
      .output(commandSchema),
    remove: oc.input(z.object({ id: z.string() })).output(empty),
  },
  shares: {
    create: oc
      .input(
        z.object({
          tabId: z.string(),
          allowWrite: z.boolean().default(false),
          maxConnections: z.number().int().min(1).default(1),
          expiresIn: z.number().int().min(1).default(3600),
        }),
      )
      .output(
        z.object({
          token: z.string(),
          expireAt: z.number(),
          allowWrite: z.boolean(),
          maxConnections: z.number(),
        }),
      ),
    list: oc
      .input(z.object({ tabId: z.string().optional() }))
      .output(z.object({ tokens: shareTokenInfoSchema.array() })),
    update: oc
      .input(
        z.object({
          token: z.string(),
          allowWrite: z.boolean().optional(),
          maxConnections: z.number().int().min(1).optional(),
        }),
      )
      .output(empty),
    renew: oc.input(z.object({ token: z.string() })).output(z.object({ expireAt: z.number() })),
    delete: oc.input(z.object({ token: z.string() })).output(empty),
    revokeAll: oc.input(z.object({ tabId: z.string() })).output(empty),
  },
  tabs: {
    list: oc.output(z.object({ tabs: tabInfoSchema.array() })),
    open: oc.input(z.object({ commandId: z.string() })).output(tabOpenInfoSchema),
    get: oc.input(z.object({ id: z.string() })).output(tabInfoSchema),
    close: oc.input(z.object({ id: z.string() })).output(empty),
  },
  tunnel: {
    post: oc
      .input(z.object({ action: z.enum(["start", "stop"]) }))
      .output(z.object({ state: cloudflareTunnelStateSchema })),
    resolve: oc.output(tunnelResolveSchema),
  },
});

export type AppContract = typeof contract;
