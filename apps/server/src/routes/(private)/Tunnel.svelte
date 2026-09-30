<script lang="ts">
  import { onMount } from "svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { ToastState } from "$lib/toasts.svelte";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();
  const tunnel = $derived(
    globalState.tunnel ?? {
      enabled: false,
      url: undefined,
      error: undefined,
      resolved: false,
      binaryPath: undefined,
    },
  );

  let downloading = $state(false);

  onMount(() => {
    void globalState.loadTunnel();
  });
</script>

<div class="card bg-base-200 shadow-md">
  <div class="card-body">
    <h2 class="card-title">Cloudflared Tunnel</h2>
    <p class="text-sm opacity-70">
      Share sessions publicly via a cloudflared quick tunnel. Enable this to get a public URL
      (trycloudflare.com) that anyone can use to join a shared session.
    </p>

    {#if !tunnel.resolved}
      <div class="alert alert-warning mt-2">
        <span>Cloudflared binary not found. Download it first to enable tunneling.</span>
      </div>
    {/if}

    <div class="mt-2 flex items-center gap-4">
      <button
        class="btn btn-sm"
        disabled={downloading || tunnel.resolved}
        onclick={async () => {
          downloading = true;
          try {
            await globalState.resolveCloudflared();
            await globalState.loadTunnel();
            toastState.show("Cloudflared downloaded successfully.", "info");
          } catch (err) {
            toastState.show(`Failed to download cloudflared: ${(err as Error).message}`, "error");
          } finally {
            downloading = false;
          }
        }}
      >
        {#if downloading}
          <span class="loading loading-spinner loading-xs"></span>
          Downloading...
        {:else}
          Download cloudflared
        {/if}
      </button>
      {#if tunnel.resolved}
        <span class="text-success text-sm">Binary ready</span>
      {:else}
        <span class="text-sm">Not installed</span>
      {/if}
    </div>

    {#if tunnel.binaryPath}
      <div class="mt-2 text-sm opacity-70">
        Path: <code class="text-xs">{tunnel.binaryPath}</code>
      </div>
    {/if}

    <div class="mt-4 flex items-center gap-4">
      <span class="text-sm">{tunnel.enabled ? "Enabled" : "Disabled"}</span>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        checked={tunnel.enabled}
        disabled={!tunnel.resolved}
        onchange={async (e) => {
          if (e.currentTarget.checked) {
            await globalState.enableTunnel();
          } else {
            await globalState.disableTunnel();
          }
        }}
      />
    </div>

    {#if tunnel.url}
      <div class="mt-2 text-sm">
        <span class="opacity-70">Public URL:</span>
        <a href={tunnel.url} class="link link-primary ml-1" target="_blank">{tunnel.url}</a>
      </div>
    {/if}
    {#if tunnel.error}
      <div class="text-error mt-2 text-sm">{tunnel.error}</div>
    {/if}
  </div>
</div>
