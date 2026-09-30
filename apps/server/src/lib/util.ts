import type { TtyStatus } from "./types";
import type { TabInfo } from "@termcast/shared";
import { SHARE_VIEW } from "./routes";

export function labelFor(tab: TabInfo) {
  if (tab.label === SHARE_VIEW) return "Shared session";
  return tab.label ?? tab.id;
}

export const statusInfo: Record<TtyStatus, { label: string; class: string; dot: string }> = {
  connecting: { label: "Connecting...", class: "badge-warning", dot: "bg-warning" },
  connected: { label: "Connected", class: "badge-success", dot: "bg-success" },
  disconnected: { label: "Disconnected", class: "badge-error", dot: "bg-error" },
  reconnecting: { label: "Reconnecting...", class: "badge-warning", dot: "bg-warning" },
};

export function formatTimeLeft(expireAt: number, now: number = Date.now()) {
  const remaining = expireAt - now;
  if (remaining <= 0) return "expired";
  const minutes = Math.floor(remaining / 60_000);
  return minutes >= 1 ? `${minutes} min` : "< 1 min";
}
