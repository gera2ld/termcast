<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { loadingFonts } from "#lib/font.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { terminalThemes } from "#lib/themes.js";
  import type { TtySocket } from "#lib/tty-socket.js";
  import type { ColorScheme, XTerm } from "#lib/xterm.js";
  import type { TabInfo, TerminalTheme } from "@termcast/shared";
  import { terminalThemeSchema } from "@termcast/shared";
  import "@xterm/xterm/css/xterm.css";
  import { onDestroy, onMount } from "svelte";
  import TtyBar from "./TtyBar.svelte";

  const globalState = GlobalState.get();

  let { tab, active, socket }: { tab: TabInfo; active: boolean; socket: TtySocket } = $props();

  let el: HTMLElement;
  let term = $state<XTerm | undefined>(undefined);
  let unmount: (() => void) | undefined;
  let themeScheme: MediaQueryList;
  /** A watcher may be allowed to type, but never owns the size: it mirrors the owner's. */
  const canResize = $derived(socket.isOwner);
  /** Owner preference comes from dashboard settings; guests mirror it via /api/appearance. */
  let guestPreference = $state<TerminalTheme>(terminalThemeSchema.parse(undefined));
  function currentPreference(): TerminalTheme | undefined {
    if (!socket.isOwner) return guestPreference;
    return globalState.settings?.terminalTheme;
  }
  function resolveScheme(pref: TerminalTheme, matches: boolean): ColorScheme {
    return pref === "auto" ? (matches ? "dark" : "light") : pref;
  }
  const onSchemeChange = (event: MediaQueryListEvent) => {
    if (!term || currentPreference() !== "auto") return;
    term.options.theme = terminalThemes[event.matches ? "dark" : "light"];
  };
  /** Reactive view of the web-local connection state for this tab. */
  const connView = $derived(globalState.connections[tab.id]);

  function handleResize() {
    if (active && canResize) term?.fitAddon.fit();
  }

  // SvelteKit resets focus once a navigation completes, and switching tabs is one, so
  // the terminal has to take focus back afterwards.
  afterNavigate(({ shallow, type }) => {
    if (shallow && type === "goto") return;
    if (active) term?.focus();
  });

  $effect(() => {
    if (active) term?.focus();
  });

  // Apply the saved terminal theme live (e.g. changed in the Appearance card while open).
  $effect(() => {
    const pref = currentPreference();
    if (term && themeScheme && pref) {
      term.options.theme = terminalThemes[resolveScheme(pref, themeScheme.matches)];
    }
  });

  onMount(async () => {
    const { XTerm } = await import("#lib/xterm.js");
    const fontFamily = await loadingFonts;
    themeScheme = matchMedia("(prefers-color-scheme: dark)");
    let initial = currentPreference();
    if (!socket.isOwner) {
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
    instance.onData((data) => socket.input(tab.id, data));
    instance.onResize(({ cols, rows }) => socket.resize(tab.id, cols, rows));
    themeScheme.addEventListener("change", onSchemeChange);
    window.addEventListener("resize", handleResize, false);
    term = instance;
    unmount = socket.mount(tab.id, {
      write: (data) => instance.write(data),
      reset: () => instance.reset(),
      fit: () => {
        instance.fitAddon.fit();
        return { cols: instance.cols, rows: instance.rows };
      },
      resize: (cols, rows) => instance.resize(cols, rows),
    });
  });

  onDestroy(() => {
    themeScheme?.removeEventListener("change", onSchemeChange);
    window.removeEventListener("resize", handleResize, false);
    // Only the view goes: the pty stays alive so a tab survives navigation, and is
    // disposed by tabs.close when the user closes the tab.
    unmount?.();
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
        class="bg-background absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <p class="text-destructive text-lg font-medium">{connView.error}</p>
        {#if connView.token}
          <p class="text-muted-foreground text-sm">Ask whoever shared it for a new link.</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
