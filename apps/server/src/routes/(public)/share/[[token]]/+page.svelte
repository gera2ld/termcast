<script lang="ts">
  import { page } from "$app/state";
  import TtyView from "#lib/components/TtyView.svelte";
  import StatusDot from "#lib/components/StatusDot.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { SHARE_VIEW } from "#lib/routes.js";
  import { formatTimeLeft } from "#lib/util.js";
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
      class="bg-muted flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6"
    >
      <span class="bg-secondary text-secondary-foreground shrink-0 rounded-full px-3 font-bold">
        TermCast
      </span>
      <Badge
        variant={conn?.canWrite ? "default" : "secondary"}
        title={conn?.canWrite
          ? "You can type in this terminal, and everyone sees the same screen."
          : "View only — you cannot type in this terminal."}
      >
        Shared session
      </Badge>
      {#if conn?.status}
        <StatusDot status={conn.status} wsConnected={conn?.wsConnected ?? false} />
      {/if}
      {#if conn?.expiresAt}
        <span class="text-muted-foreground ml-auto text-sm">
          Expires in {formatTimeLeft(conn.expiresAt, now)}
        </span>
      {/if}
    </div>
  {/if}

  <div class="relative min-h-0 flex-1">
    {#if token}
      <TtyView {tab} active />
    {:else}
      <div class="text-muted-foreground my-8 text-center text-sm">
        This shared session link is missing its token.
      </div>
    {/if}
  </div>
</div>
