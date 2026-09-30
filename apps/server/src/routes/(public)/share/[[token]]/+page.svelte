<script lang="ts">
  import { page } from "$app/state";
  import TtyView from "$lib/components/TtyView.svelte";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { SHARE_VIEW } from "$lib/routes";
  import { formatTimeLeft } from "$lib/util";
  import type { TabInfo } from "@termcast/shared";

  const globalState = GlobalState.get();
  const token = page.params.token;

  const tab: TabInfo = {
    id: token ?? "",
    label: SHARE_VIEW,
    status: "active",
    commandId: null,
    args: [],
    connections: 0,
    createdAt: "",
    lastActivity: "",
  };

  if (token) {
    globalState.connections[token] = { token, status: "connecting", shareTokens: [] };
  }

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const conn = $derived(globalState.connections[token ?? ""]);
</script>

<svelte:head>
  <title>Shared session — TermCast</title>
</svelte:head>

<div class="flex h-screen flex-col">
  {#if token}
    <div
      role="tablist"
      class="tabs tabs-lift bg-base-300 shrink-0 flex-nowrap items-center overflow-x-auto px-4 sm:px-6"
    >
      <span class="tab text-base-content/80 shrink-0 font-bold">TermCast</span>
      <span
        class={`badge badge-sm ${conn?.canWrite ? "badge-warning" : ""}`}
        title={conn?.canWrite
          ? "You can type in this terminal, and everyone sees the same screen."
          : "View only — you cannot type in this terminal."}
      >
        Shared session
      </span>
      {#if conn?.status}
        <StatusDot status={conn.status} wsConnected={conn?.wsConnected ?? false} />
      {/if}
      {#if conn?.expiresAt}
        <span class="ml-auto opacity-70">Expires in {formatTimeLeft(conn.expiresAt, now)}</span>
      {/if}
    </div>
  {/if}

  <div class="relative min-h-0 flex-1">
    {#if token}
      <TtyView {tab} active />
    {:else}
      <div class="my-8 text-center text-sm opacity-70">
        This shared session link is missing its token.
      </div>
    {/if}
  </div>
</div>
