<script lang="ts">
  import { page } from "$app/state";
  import TtyView from "#lib/components/TtyView.svelte";
  import { GlobalState } from "#lib/global.svelte.js";
  import { labelFor } from "#lib/util.js";
  import { onDestroy } from "svelte";

  const { children } = $props();

  const globalState = GlobalState.get();

  const activeId = $derived(page.params.id);
  const activeTab = $derived(globalState.tabs.find((tab) => tab.id === page.params.id));

  // The one place that decides which tab the owner socket streams.
  const streamedId = $derived(activeTab?.id ?? null);
  $effect(() => {
    globalState.ttySocket.setActive(streamedId);
  });
  onDestroy(() => globalState.ttySocket.setActive(null));

  const pageTitle = $derived(activeTab ? `${labelFor(activeTab)} - TermCast` : "TermCast");
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="relative size-full">
  {#each globalState.tabs as tab (tab.id)}
    {@const active = tab.id === activeId}
    <div class="absolute inset-0 {active ? '' : 'hidden'}">
      <TtyView {tab} {active} socket={globalState.ttySocket} />
    </div>
  {/each}

  {@render children?.()}
</div>
