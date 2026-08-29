<script>
  import { page } from "$app/state";
  import { GlobalState } from "@/lib/global.svelte";
  import { labelFor } from "@/lib/util";

  const { children } = $props();

  const globalState = GlobalState.get();

  const activeTab = $derived(globalState.tabs.find((tab) => tab.id === page.params.id));

  const pageTitle = $derived(activeTab ? `${labelFor(activeTab)} - TermCast` : "TermCast");
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

{@render children?.()}
