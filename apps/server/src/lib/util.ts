import type { TtyStatus } from "./types";
import type { TabInfo } from "@termcast/shared";
import { SHARE_VIEW } from "./routes";

export function labelFor(tab: TabInfo) {
  if (tab.label === SHARE_VIEW) return "Shared session";
  return tab.label ?? tab.id;
}

export const statusInfo: Record<TtyStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting...", dot: "bg-chart-4" },
  connected: { label: "Connected", dot: "bg-chart-1" },
  disconnected: { label: "Disconnected", dot: "bg-chart-2" },
  reconnecting: { label: "Reconnecting...", dot: "bg-chart-4" },
};

export function formatTimeLeft(expireAt: number, now: number = Date.now()) {
  const remaining = expireAt - now;
  if (remaining <= 0) return "expired";
  const minutes = Math.floor(remaining / 60_000);
  return minutes >= 1 ? `${minutes} min` : "< 1 min";
}
