<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import NewTabButton from "#lib/components/NewTabButton.svelte";
  import StatusDot from "#lib/components/StatusDot.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { labelFor } from "#lib/util.js";
  import { XIcon } from "@lucide/svelte";

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
  const homeActive = $derived(!activeId && page.url.pathname === "/");
</script>

{#if globalState.user}
  <div class="flex h-screen flex-col">
    <div class="bg-muted flex shrink-0 flex-wrap items-center gap-1 px-4 py-2 sm:px-6">
      <a
        href="/"
        aria-current={homeActive ? "page" : undefined}
        class="focus-visible:ring-ring shrink-0 rounded-md px-1 font-bold focus-visible:ring-2 focus-visible:outline-none"
        class:text-foreground={homeActive}
        class:text-muted-foreground={!homeActive}
      >
        TermCast
      </a>

      <div class="order-1 flex w-full items-center gap-1 md:order-0 md:w-auto">
        <div class="flex shrink-1 grow-0 items-center gap-1 overflow-x-auto">
          {#each globalState.tabs as tab (tab.id)}
            {@const conn = globalState.connections[tab.id]}
            {@const connStatus = conn?.status}
            {@const wsConnected = conn?.token
              ? (conn?.wsConnected ?? false)
              : globalState.wsConnected}
            {@const active = activeId === tab.id}
            <div class="relative shrink-0" class:text-primary-foreground={active}>
              <Button
                href={`/tty/${tab.id}`}
                variant={active ? "default" : "outline"}
                size="sm"
                class="w-full justify-start rounded-full pr-8"
                aria-current={active ? "page" : undefined}
              >
                {#if connStatus}
                  <StatusDot status={connStatus} {wsConnected} />
                {/if}
                <span class="max-w-40 truncate">{labelFor(tab)}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                class="absolute inset-y-0 right-1 my-auto"
                aria-label={`Close ${labelFor(tab)}`}
                onclick={() => globalState.closeTab(tab)}
              >
                <XIcon />
              </Button>
            </div>
          {/each}
        </div>

        <NewTabButton />
      </div>

      <div class="flex-auto"></div>

      {#if globalState.user.hasRegistered}
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="link" size="sm" onclick={handleLogOut}>Log out</Button>
        </div>
      {/if}
    </div>

    <div class="relative min-h-0 flex-1">
      {@render children?.()}
    </div>
  </div>
{/if}
