<script lang="ts">
  import { onMount } from "svelte";
  import { GlobalState } from "$lib/global.svelte";
  import type { Settings } from "@termcast/shared";
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

  let saving = $state(false);
  let downloading = $state(false);

  interface SettingsForm {
    rpName: string;
    displayName: string;
    username: string;
    origins: string;
    webhook: string;
  }

  function toForm(s: Settings | undefined): SettingsForm {
    if (!s) return { rpName: "", displayName: "", username: "", origins: "", webhook: "" };
    return {
      rpName: s.rpName,
      displayName: s.displayName,
      username: s.username,
      origins: s.expectedOrigins.join(", "),
      webhook: s.webhookTermStarted ?? "",
    };
  }

  let form = $state<SettingsForm>(toForm(globalState.settings));

  onMount(() => {
    void globalState.loadTunnel();
  });

  // Reset the editable fields whenever the server settings change (initial load, save
  // confirmation, or a realtime "settings" event).
  $effect(() => {
    form = toForm(globalState.settings);
  });

  async function save() {
    saving = true;
    try {
      await globalState.updateSettings({
        rpName: form.rpName,
        displayName: form.displayName,
        username: form.username,
        expectedOrigins: form.origins
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        webhookTermStarted: form.webhook.trim() || undefined,
      });
      await globalState.reloadDashboard();
      toastState.show("Settings saved.", "info");
    } catch (err) {
      toastState.show(`Failed to save settings: ${(err as Error).message}`, "error");
    } finally {
      saving = false;
    }
  }
</script>

<div class="card bg-base-200 shadow-md">
  <div class="card-body">
    <h2 class="card-title">Settings</h2>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">rpId</legend>
      <input
        class="input input-bordered w-full"
        value={globalState.settings?.rpId ?? ""}
        readonly
      />
      <p class="text-xs opacity-60">Read-only here. To change it, use the danger zone.</p>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">rpName</legend>
      <input class="input input-bordered w-full" bind:value={form.rpName} />
    </fieldset>

    <div class="grid grid-cols-2 gap-2">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Display name</legend>
        <input class="input input-bordered w-full" bind:value={form.displayName} />
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Username</legend>
        <input class="input input-bordered w-full" bind:value={form.username} />
      </fieldset>
    </div>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Expected origins (comma separated)</legend>
      <input class="input input-bordered w-full" bind:value={form.origins} />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Webhook (term.started URL)</legend>
      <input
        class="input input-bordered w-full"
        bind:value={form.webhook}
        placeholder="https://hooks.example.com"
      />
    </fieldset>

    <div class="flex justify-end">
      <button class="btn btn-primary" onclick={save} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  </div>
</div>

<div class="card bg-base-200 mt-4 shadow-md">
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
