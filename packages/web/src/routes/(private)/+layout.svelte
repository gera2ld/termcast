<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { labelFor } from "$lib/util";

  const { children } = $props();

  const globalState = GlobalState.get();

  function handleLogOut() {
    globalState.logOut();
  }

  $effect(() => {
    if (!globalState.user) {
      goto("/login");
    }
  });

  const activeId = $derived(page.params.id);
</script>

{#if globalState.user}
  <div class="flex h-screen flex-col">
    <div
      role="tablist"
      class="tabs tabs-lift bg-base-300 shrink-0 flex-nowrap items-center overflow-x-auto px-4 sm:px-6"
    >
      <a
        role="tab"
        href="/"
        aria-current={!activeId && page.url.pathname === "/" ? "page" : undefined}
        class="tab text-base-content/80 shrink-0 font-bold {!activeId && page.url.pathname === '/'
          ? 'tab-active'
          : ''}"
      >
        TermCast
      </a>

      {#if globalState.user}
        {#each globalState.tabs as tab (tab.id)}
          {@const conn = globalState.connections[tab.id]}
          {@const connStatus = conn?.status}
          {@const wsConnected = conn?.token
            ? (conn?.wsConnected ?? false)
            : globalState.wsConnected}
          <div role="tab" class="tab shrink-0 gap-1 {activeId === tab.id ? 'tab-active' : ''}">
            <a class="max-w-40 truncate" href={`/tty/${tab.id}`}>
              {labelFor(tab)}
            </a>
            {#if connStatus}
              <StatusDot status={connStatus} {wsConnected} />
            {/if}
            <button
              class="btn btn-ghost btn-xs btn-circle"
              aria-label={`Close ${labelFor(tab)}`}
              onclick={() => globalState.closeTab(tab)}
            >
              ✕
            </button>
          </div>
        {/each}

        {#if globalState.user.hasRegistered}
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <button class="btn btn-ghost btn-xs" onclick={handleLogOut}>Log out</button>
          </div>
        {/if}
      {/if}
    </div>

    <div class="relative min-h-0 flex-1">
      {@render children?.()}
    </div>
  </div>
{/if}
