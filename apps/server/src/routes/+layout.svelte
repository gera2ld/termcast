<script lang="ts">
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import type { Snippet } from "svelte";

  const { children }: { children?: Snippet } = $props();

  const globalState = GlobalState.set();

  const ready = globalState.load();

  // Once authenticated, make sure the live sockets are open. `user` becomes truthy only
  // after a successful sign-in/setup (which also calls reloadDashboard → applySnapshot), so
  // this fires exactly when sockets are first needed — without requiring a page refresh.
  $effect(() => {
    if (globalState.user) globalState.ensureConnected();
  });
</script>

<svelte:head>
  <title>TermCast</title>
</svelte:head>

<Toaster richColors closeButton position="bottom-right" />

{#await ready}
  <div class="mt-32 flex justify-center p-4">
    <Spinner />
  </div>
{:then}
  {@render children?.()}
{/await}
