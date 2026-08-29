export interface HonoEnv {
  Variables: {
    /**
     * Raw bearer token presented on the request, if any. Verified in the oRPC `base`
     * middleware; the owner token is never exposed to the client as a claim.
     */
    token?: string;
    /**
     * True when the caller is trusted on this install: either a verified owner token, or a fresh
     * install (no passkeys registered yet) that is being configured for the first time.
     */
    verified: boolean;
  };
}

export interface IShareSession {
  allowWrite: boolean;
  /** Set by a share link: attach to this live tab's pty instead of starting a new one. */
  tabId?: string;
  /** Maximum simultaneous viewers allowed through this share link. */
  maxConnections: number;
}

// Shared types for web package
export interface IConnection {
  id: string;
  deviceId: string;
  createdAt: string;
  lastActivity: string;
}

export interface ITermToken<T = unknown> {
  token: string;
  createdAt: number;
  expireAt: number;
  payload: T;
}
