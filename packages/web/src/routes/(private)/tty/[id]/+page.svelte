<script lang="ts">
  import { page } from "$app/state";
  import { GlobalState } from "$lib/global.svelte";

  const globalState = GlobalState.get();
  const tab = $derived(globalState.tabs.find((t) => t.id === page.params.id));
</script>

{#if !tab}
  <div class="absolute inset-0 flex items-center justify-center text-sm opacity-70">
    This session is no longer available.
  </div>
{/if}
