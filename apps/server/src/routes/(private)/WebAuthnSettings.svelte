<script lang="ts">
  import { GlobalState } from "$lib/global.svelte";
  import type { Settings } from "@termcast/shared";
  import { ToastState } from "$lib/toasts.svelte";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  let saving = $state(false);

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
    <h2 class="card-title">WebAuthn Settings</h2>

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
