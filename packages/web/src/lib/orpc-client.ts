import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract } from "@termcast/shared";

const TOKEN_KEY = "termcast_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  headers: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

export const orpc = createORPCClient<ContractRouterClient<AppContract>>(link);
