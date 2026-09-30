import { orpc } from "$lib/orpc-client";
import type { IShareToken } from "$lib/types";

export class TabState {
  async listShareTokens(tabId: string) {
    const { tokens } = await orpc.shares.list({ tabId });
    return tokens as IShareToken[];
  }

  /** Mints a link that lets someone else join this exact session. */
  async createShareToken(tabId: string, allowWrite = false, maxConnections = 1) {
    const {
      token,
      expireAt,
      maxConnections: max,
    } = await orpc.shares.create({
      tabId,
      allowWrite,
      maxConnections,
    });
    return { token, expireAt, maxConnections: max };
  }

  async updateShareToken(token: string, allowWrite: boolean, maxConnections?: number) {
    await orpc.shares.update({ token, allowWrite, maxConnections });
  }

  /** Pushes a link's deadline back out to the full window, for guests already on it too. */
  async renewShareToken(token: string) {
    await orpc.shares.renew({ token });
  }

  async revokeShareToken(token: string) {
    await orpc.shares.delete({ token });
  }

  /** Revokes every link for a session, cutting off anyone already using one. */
  async revokeShareTokens(tabId: string) {
    await orpc.shares.revokeAll({ tabId });
  }
}
