<script lang="ts">
  import { GlobalState } from "$lib/global.svelte";
  import { ToastState } from "$lib/toasts.svelte";
  import type { Snippet } from "svelte";

  const { children }: { children?: Snippet } = $props();

  const globalState = GlobalState.set();
  const toastState = ToastState.set();

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

{#await ready}
  <div class="mt-32 flex justify-center p-4">
    <span class="loading loading-spinner loading-lg"></span>
  </div>
{:then}
  {@render children?.()}
{/await}

{#if toastState.toasts.length}
  <div class="toast toast-end toast-bottom z-50">
    {#each toastState.toasts as toast (toast.id)}
      <div
        class="alert {toast.kind === 'error'
          ? 'alert-error'
          : 'alert-info'} max-w-sm items-start text-sm"
      >
        <span class="break-words whitespace-normal">{toast.text}</span>
        <button
          class="btn btn-ghost btn-xs btn-circle shrink-0"
          aria-label="Dismiss"
          onclick={() => toastState.dismiss(toast.id)}
        >
          ✕
        </button>
      </div>
    {/each}
  </div>
{/if}
