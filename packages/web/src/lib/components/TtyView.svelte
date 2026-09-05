<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { loadingFonts } from "$lib/font";
  import { terminalThemes } from "$lib/themes";
  import type { ColorScheme, XTerm } from "$lib/xterm";
  import { b64decode } from "@gera2ld/common";
  import type { TabInfo, TerminalTheme, WsServerMessage } from "@termcast/shared";
  import { terminalThemeSchema, TtyBuffer } from "@termcast/shared";
  import { GlobalState } from "$lib/global.svelte";
  import "@xterm/xterm/css/xterm.css";
  import { onDestroy, onMount, untrack } from "svelte";
  import TtyBar from "./TtyBar.svelte";

  const globalState = GlobalState.get();

  let { tab, active }: { tab: TabInfo; active: boolean } = $props();

  let el: HTMLElement;
  let term = $state<XTerm | undefined>(undefined);
  let ended = false;
  let lastActive = 0;
  let themeScheme: MediaQueryList;
  /** Owner preference comes from dashboard settings; guests mirror it via /api/appearance. */
  let guestPreference = $state<TerminalTheme>(terminalThemeSchema.parse(undefined));
  function currentPreference(): TerminalTheme | undefined {
    if (globalState.connections[tab.id]?.token) return guestPreference;
    return globalState.settings?.terminalTheme;
  }
  function resolveScheme(pref: TerminalTheme, matches: boolean): ColorScheme {
    return pref === "auto" ? (matches ? "dark" : "light") : pref;
  }
  const onSchemeChange = (event: MediaQueryListEvent) => {
    if (!term || currentPreference() !== "auto") return;
    term.options.theme = terminalThemes[event.matches ? "dark" : "light"];
  };
  /** Guest-only socket; the owner shares one multiplexed socket via `globalState.ttySocket`. */
  let socket: WebSocket | undefined;
  let connecting = false;
  /** Whether this view already re-rendered its buffer into the terminal (once per mount). */
  let started = false;

  /** A guest joined with a share link (has a token); otherwise this is the owner. */
  const isGuest = $derived(!!globalState.connections[tab.id]?.token);
  /** A watcher may be allowed to type, but never owns the size: it mirrors the owner's. */
  const canResize = $derived(!globalState.connections[tab.id]?.token);
  /** Reactive view of the web-local connection state for this tab. */
  const connView = $derived(globalState.connections[tab.id]);

  /** The FE buffer store for this tab, created on first use. */
  function buffer(): TtyBuffer {
    const conn = globalState.connections[tab.id];
    if (!conn) throw new Error("Connection state missing for tab");
    return (conn.buffer ??= new TtyBuffer());
  }

  /** Handles a server message, keeping the FE buffer in sync with the server's. */
  function handleMessage(msg: WsServerMessage) {
    const conn = globalState.connections[tab.id];
    if (!conn) return;
    switch (msg.type) {
      case "start": {
        const { offset, canWrite, expiresAt } = msg.data;
        const buf = buffer();
        if (buf.size > 0 && buf.endOffset !== offset) {
          // The server no longer has what we have (out of sync): discard both.
          buf.clear(offset);
          term?.reset();
        }
        conn.error = undefined;
        conn.canWrite = canWrite;
        conn.expiresAt = expiresAt || undefined;
        conn.status = "connected";
        if (canResize && term) {
          term.fitAddon.fit();
          send({ type: "resize", data: [term.cols, term.rows] });
        }
        lastActive = Date.now();
        break;
      }
      case "chunk": {
        const bytes = b64decode(msg.data.chunk);
        buffer().write(bytes, msg.data.offset);
        term?.write(bytes);
        lastActive = Date.now();
        break;
      }
      case "size": {
        const [cols, rows] = msg.data;
        // Watchers mirror the owner's terminal rather than reflowing to their window.
        if (!canResize) term?.resize(cols, rows);
        break;
      }
      case "end": {
        ended = true;
        conn.status = "disconnected";
        break;
      }
      case "access": {
        conn.canWrite = msg.data.canWrite !== false;
        if (msg.data.expiresAt !== undefined) conn.expiresAt = msg.data.expiresAt || undefined;
        break;
      }
      case "connections": {
        conn.shareTokens = msg.data.tokens;
        break;
      }
      case "error": {
        conn.error = msg.data.message;
        break;
      }
    }
  }

  function send(
    message: { type: "data"; data: string } | { type: "resize"; data: [number, number] },
  ) {
    lastActive = Date.now();
    if (isGuest) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: tab.id, ...message }));
      }
    } else {
      globalState.ttySocket.send({ id: tab.id, ...message });
    }
  }

  function handleResize() {
    if (active && canResize) term?.fitAddon.fit();
  }

  // SvelteKit resets focus once a navigation completes, and switching tabs is one, so
  // the terminal has to take focus back afterwards.
  afterNavigate(() => {
    if (active) term?.focus();
  });

  /** Once per mount: re-render any buffered scrollback into the fresh terminal. The view
   * stays mounted across tab switches (see tty/+layout.svelte), so this only runs for a
   * genuinely fresh terminal, never when returning to an already-rendered tab. */
  $effect(() => {
    if (!term || started) return;
    started = true;
    if (isGuest) return;
    const buf = connView?.buffer;
    if (buf?.size) {
      term.reset();
      for (const piece of buf.slice().pieces) term.write(piece);
      if (canResize) term.fitAddon.fit();
    }
  });

  // Apply the saved terminal theme live (e.g. changed in the Appearance card while open).
  $effect(() => {
    const pref = currentPreference();
    if (term && themeScheme && pref) {
      term.options.theme = terminalThemes[resolveScheme(pref, themeScheme.matches)];
    }
  });

  // Attach to the socket while active and detach when the user moves elsewhere.
  $effect(() => {
    if (!term) return;
    if (active) {
      if (isGuest) {
        connect();
      } else {
        // select() reads the buffer's endOffset to compute `since`; that internal read must
        // not make this effect re-run (and re-select) on every chunk that lands in the buffer.
        untrack(() => globalState.ttySocket.select({ id: tab.id, onMessage: handleMessage }));
      }
      term.focus();
    } else {
      if (isGuest) {
        detach();
      } else {
        globalState.ttySocket.leave(tab.id);
      }
    }
  });

  async function connect() {
    if (!term || socket || connecting || !isGuest) return;
    connecting = true;
    ended = false;
    const conn = globalState.connections[tab.id];
    if (!conn?.token) return;
    try {
      const wsOrigin = window.location.origin.replace(/^http/, "ws");
      const url = `${wsOrigin}/ws?token=${encodeURIComponent(conn.token)}`;
      conn.status = "connecting";
      const ws = new WebSocket(url);
      socket = ws;

      ws.addEventListener("open", () => {
        conn.wsConnected = true;
        ws.send(
          JSON.stringify({
            id: tab.id,
            type: "select",
            data: { since: buffer().endOffset },
          }),
        );
        lastActive = Date.now();
      });
      ws.addEventListener("message", (event) => {
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        handleMessage(msg);
      });
      ws.addEventListener("close", () => {
        if (socket !== ws) return;
        socket = undefined;
        conn.wsConnected = false;
        // Only worth retrying for a tab the user is looking at.
        if (!ended && !conn.error && lastActive + 60_000 >= Date.now()) {
          setTimeout(connect, 1000);
        }
      });
    } catch {
      conn.wsConnected = false;
    } finally {
      connecting = false;
    }
  }

  function detach() {
    socket?.close();
    socket = undefined;
  }

  onMount(async () => {
    const { XTerm } = await import("$lib/xterm");
    const fontFamily = await loadingFonts;
    themeScheme = matchMedia("(prefers-color-scheme: dark)");
    let initial = currentPreference();
    if (globalState.connections[tab.id]?.token) {
      try {
        const res = await fetch("/api/appearance");
        const data = (await res.json()) as { terminalTheme?: unknown };
        const parsed = terminalThemeSchema.parse(data.terminalTheme);
        guestPreference = parsed;
        initial = parsed;
      } catch {
        // Keep the seeded default when the appearance endpoint is unreachable.
      }
    }
    // Unreachable in practice: owners mount after the dashboard load, guests use the seed.
    if (initial === undefined) return;
    const instance = new XTerm(
      {
        fontFamily: fontFamily ? `${fontFamily}, monospace` : undefined,
      },
      resolveScheme(initial, themeScheme.matches),
    );
    instance.open(el);
    instance.onData((data) => send({ type: "data", data }));
    instance.onResize(({ cols, rows }) => send({ type: "resize", data: [cols, rows] }));
    themeScheme.addEventListener("change", onSchemeChange);
    window.addEventListener("resize", handleResize, false);
    term = instance;
  });

  onDestroy(() => {
    themeScheme?.removeEventListener("change", onSchemeChange);
    window.removeEventListener("resize", handleResize, false);
    if (isGuest) {
      // Drops the socket only: the pty stays alive so a tab survives navigation, and is
      // disposed by tabs.close when the user closes the tab.
      detach();
    } else {
      globalState.ttySocket.leave(tab.id);
    }
    const conn = globalState.connections[tab.id];
    try {
      term?.dispose();
    } catch {
      // The canvas addon throws while tearing down a terminal whose host is already gone.
    }
  });
</script>

<div class="flex h-full w-full flex-col">
  <!-- A watcher cannot mint share links. -->
  {#if canResize}
    <TtyBar {tab} />
  {/if}
  <div class="relative min-h-0 flex-1">
    <!-- The fit addon sizes the terminal from this element, so padding here makes it come
         out wider than the space available. A watcher is sized to the owner's window
         instead of its own, and scrolls to reach the rest. -->
    <div class="h-full w-full {canResize ? '' : 'overflow-auto'}" bind:this={el}></div>

    {#if connView?.error}
      <div
        class="bg-base-100 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <p class="text-error text-lg font-medium">{connView.error}</p>
        {#if connView.token}
          <p class="text-sm opacity-70">Ask whoever shared it for a new link.</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
