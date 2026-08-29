import { goto, replaceState } from "$app/navigation";
import { page } from "$app/state";
import { ORPCError } from "@orpc/client";
import type {
  CloudflareTunnelState,
  Command,
  DeviceInfo,
  EditableSettings,
  ServerState,
  Settings,
  TabInfo,
  UserInfo,
} from "@termcast/shared";
import { getContext, setContext } from "svelte";
import { clearToken, orpc, setToken } from "./orpc-client";
import { connectRealtime } from "./realtime";
import { shareViewUrl } from "./routes";
import { TtySocket } from "./tty-socket";
import type { TtyConnection } from "./types";

const stateKey = Symbol("GlobalState");

export class GlobalState {
  static set() {
    return setContext(stateKey, new GlobalState());
  }

  static get() {
    const state = getContext<GlobalState>(stateKey);
    if (!state) throw new Error("GlobalState is not injected");
    return state;
  }

  user = $state<UserInfo>();
  tunnel = $state<CloudflareTunnelState | undefined>();
  tabs = $state<TabInfo[]>([]);
  connections = $state<Record<string, TtyConnection>>({});
  settings = $state<Settings | undefined>();
  devices = $state<DeviceInfo[]>([]);
  commands = $state<Command[]>([]);

  /** Shared owner WebSocket multiplexing all tabs (see TtySocket). */
  ttySocket = new TtySocket(this);

  /** Whether the owner's shared WebSocket is connected (drives status-dot opacity). */
  wsConnected = $state(false);

  /** Guards `connectRealtime` so repeated calls don't open duplicate sockets. */
  realtimeConnected = false;

  /** Best-effort: obtain/renew the owner token. A one-time grant token from the
   * `termcast grant` CLI (present in the URL as ?grant=) is exchanged for an owner
   * token and then stripped from the URL. Otherwise an existing token is renewed. */
  async ensureToken() {
    const params = new URLSearchParams(window.location.search);
    const grant = params.get("grant");
    if (grant) {
      try {
        const { token } = await orpc.auth.token({ grant });
        setToken(token);
        params.delete("grant");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        replaceState(next, {});
        return;
      } catch {
        // Invalid, expired, or already-used grant — fall through to untrusted.
      }
    }
  }

  async load() {
    try {
      await this.ensureToken();
      await this.reloadDashboard();
      this.ttySocket.connect();
      connectRealtime(this).catch(() => {
        // Realtime is a live overlay; the dashboard still works from the snapshot above.
      });
    } catch (err) {
      if (!(err instanceof ORPCError && [401].includes(err.status))) {
        throw err;
      }
    }
  }

  /** Re-fetch the dashboard snapshot (used as a refresh; does not open a realtime socket). */
  async reloadDashboard() {
    const state = await orpc.dashboard.get();
    this.applySnapshot(state as Parameters<typeof this.applySnapshot>[0]);
  }

  /** Opens the live sockets after authentication (idempotent; safe to call repeatedly).
   * `ttySocket.connect` guards against a duplicate socket, and `connectRealtime` is guarded
   * by `realtimeConnected`. Called from the auth-effect once `user` is set, so any sign-in
   * path (passkey, token link, or first-time setup) wires up the sockets without a refresh. */
  ensureConnected() {
    this.ttySocket.connect();
    connectRealtime(this).catch(() => {
      // Realtime is a live overlay; the dashboard still works from the snapshot above.
    });
  }

  /** Replace server-derived collections from a full ServerState. The terminal list is
   * taken verbatim; web-local connection state (GlobalState.connections) is left alone so
   * an in-flight WebSocket keeps driving the live status. A connection is created only for
   * tabs that don't already have one, so existing live state is never clobbered. */
  applySnapshot(state: ServerState) {
    this.user = state.user;
    this.tunnel = state.tunnel?.state;
    this.settings = state.settings;
    this.devices = state.devices;
    this.commands = state.commands;
    this.tabs = state.tabs ?? [];
    for (const tab of this.tabs) {
      if (!this.connections[tab.id]) {
        this.connections[tab.id] = { status: "disconnected", shareTokens: [] };
      }
    }
  }

  upsertTab(info: TabInfo) {
    const index = this.tabs.findIndex((tab) => tab.id === info.id);
    if (index >= 0) {
      this.tabs[index] = info;
    } else {
      this.tabs.push(info);
      this.connections[info.id] = { status: "disconnected", shareTokens: [] };
    }
  }

  removeTab(id: string) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    delete this.connections[id];
  }

  upsertCommand(command: Command) {
    const index = this.commands.findIndex((cmd) => cmd.id === command.id);
    if (index >= 0) this.commands[index] = command;
    else this.commands.push(command);
  }

  removeCommand(id: string) {
    this.commands = this.commands.filter((cmd) => cmd.id !== id);
  }

  upsertDevice(device: DeviceInfo) {
    const index = this.devices.findIndex((d) => d.id === device.id);
    if (index >= 0) this.devices[index] = device;
    else this.devices.push(device);
  }

  removeDevice(id: string) {
    this.devices = this.devices.filter((d) => d.id !== id);
  }

  setSettings(settings: Settings) {
    this.settings = settings;
  }

  setTunnel(tunnel: CloudflareTunnelState) {
    this.tunnel = tunnel;
  }

  async loadTunnel() {
    const { tunnel } = await orpc.dashboard.get();
    this.tunnel = tunnel?.state;
  }

  async logOut() {
    await orpc.auth.logout();
    clearToken();
    this.ttySocket.close();
    this.user = undefined;
    this.tunnel = undefined;
    this.tabs = [];
    this.connections = {};
  }

  async enableTunnel() {
    const { state } = await orpc.tunnel.post({ action: "start" });
    this.tunnel = state;
  }

  async disableTunnel() {
    const { state } = await orpc.tunnel.post({ action: "stop" });
    this.tunnel = state;
  }

  async resolveCloudflared() {
    const { url } = await orpc.tunnel.resolve();
    return url;
  }

  async updateSettings(payload: EditableSettings) {
    const { settings } = await orpc.settings.update(payload);
    this.settings = settings;
  }

  shareUrl(token: string) {
    const base = this.tunnel?.url ?? window.location.origin;
    return shareViewUrl(token, base);
  }

  async createCommand(command: Command) {
    command = await orpc.commands.add(command);
    this.commands = [...this.commands, command];
  }

  async updateCommand(id: string, patch: Partial<Command>) {
    const command = await orpc.commands.update({ id, ...patch });
    this.commands = this.commands.map((cmd) => (cmd.id === command.id ? command : cmd));
  }

  async deleteCommand(id: string) {
    await orpc.commands.remove({ id });
    this.commands = this.commands.filter((cmd) => cmd.id !== id);
  }

  async saveSetup(payload: Settings) {
    await orpc.setup.configure(payload);
  }

  /** Mint a fresh owner token (used after verification). */
  async getAuthToken(): Promise<string> {
    const { token } = await orpc.auth.token({});
    setToken(token);
    return token;
  }

  openTab(tab: { id: string; label?: string | null; commandId?: string; args?: string[] }) {
    const placeholder: TabInfo = {
      id: tab.id,
      commandId: tab.commandId ?? null,
      args: tab.args ?? [],
      label: tab.label ?? null,
      status: "active",
      connections: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    this.upsertTab(placeholder);
    const conn = (this.connections[tab.id] ??= { status: "disconnected", shareTokens: [] });
    conn.status = "connecting";
    void goto(`/tty/${tab.id}`);
  }

  async closeTab(tab: { id: string }) {
    const index = this.tabs.findIndex((t) => t.id === tab.id);
    if (index < 0) return;
    const wasActive = page.params.id === tab.id;
    this.tabs.splice(index, 1);
    delete this.connections[tab.id];
    void orpc.tabs.close({ id: tab.id });
    // Only navigate away if the closed tab is the one being viewed.
    if (!wasActive) return;
    const lastTab = this.tabs[index - 1];
    void goto(lastTab ? `/tty/${lastTab.id}` : "/");
  }
}
