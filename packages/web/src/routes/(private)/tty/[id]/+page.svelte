<script lang="ts">
  import { page } from "$app/state";
  import { GlobalState } from "$lib/global.svelte";
  import TtyView from "$lib/components/TtyView.svelte";

  const globalState = GlobalState.get();
  const tab = $derived(globalState.tabs.find((t) => t.id === page.params.id));
</script>

{#if tab}
  {#key tab.id}
    <TtyView {tab} active />
  {/key}
{:else}
  <div class="flex h-full items-center justify-center text-sm opacity-70">
    This session is no longer available.
  </div>
{/if}
