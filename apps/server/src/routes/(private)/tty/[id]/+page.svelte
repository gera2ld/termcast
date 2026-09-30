<script lang="ts">
  import { page } from "$app/state";
  import { GlobalState } from "$lib/global.svelte";

  const globalState = GlobalState.get();
  const tab = $derived(globalState.tabs.find((t) => t.id === page.params.id));
</script>

{#if !tab}
  <div class="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
    This session is no longer available.
  </div>
{/if}
