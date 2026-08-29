<script lang="ts">
  import { generateSessionKey } from "@termcast/shared";
  import { GlobalState } from "$lib/global.svelte";
  import { ToastState } from "$lib/toasts.svelte";

  type SetupMode = "setup" | "reset";

  const CONTENT: Record<SetupMode, { title: string; intro?: string; submitLabel: string }> = {
    setup: { title: "Set up TermCast", submitLabel: "Confirm & finish" },
    reset: {
      title: "Reset & reconfigure TermCast",
      intro: "Confirming below applies the new configuration. Nothing changes until you confirm.",
      submitLabel: "Save settings",
    },
  };

  let {
    open = $bindable(false),
    mode,
    onsaved,
  }: {
    open?: boolean;
    mode: SetupMode;
    onsaved?: () => void;
  } = $props();

  const content = $derived(CONTENT[mode]);

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  let dialog: HTMLDialogElement | undefined = $state();

  let saving = $state(false);
  let rpId = $state("");
  let rpName = $state("");
  let displayName = $state("");
  let username = $state("");
  let origins = $state("");
  let webhook = $state("");
  let sessionKey = $state("");

  function loadFromSettings() {
    const s = globalState.settings;
    rpId = s?.rpId || location.hostname;
    rpName = s?.rpName || "TermCast";
    displayName = s?.displayName || "TermCast";
    username = s?.username || "term";
    origins = (s?.expectedOrigins ?? []).join(", ");
    webhook = s?.webhookTermStarted ?? "";
    sessionKey = "";
  }

  function generateKey() {
    sessionKey = generateSessionKey();
  }

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      loadFromSettings();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function confirm() {
    if (!rpId.trim()) {
      toastState.show("rpId is required.", "error");
      return;
    }
    saving = true;
    try {
      await globalState.saveSetup({
        rpId: rpId.trim(),
        rpName,
        displayName,
        username,
        expectedOrigins: origins
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        webhookTermStarted: webhook.trim() || undefined,
        sessionEncryptionKey: sessionKey.trim() || undefined,
      });
      await globalState.reloadDashboard();
      toastState.show("Settings saved.", "info");
      onsaved?.();
    } catch (err) {
      toastState.show(`Failed to save: ${(err as Error).message}`, "error");
    } finally {
      saving = false;
    }
  }
</script>

<dialog class="modal" bind:this={dialog}>
  <div class="modal-box max-h-[90vh] max-w-2xl overflow-y-auto">
    <h3 class="text-lg font-bold">{content.title}</h3>
    {#if content.intro}
      <p class="mt-1 text-sm opacity-70">{content.intro}</p>
    {/if}
    <div class="divider"></div>
    <div class="space-y-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">
          rpId <span class="text-error">*</span>
        </legend>
        <input
          class="input input-bordered w-full"
          bind:value={rpId}
          placeholder="e.g. termcast.example.com"
          required
        />
        <p class="text-xs opacity-60">
          Must match the HTTPS host. This cannot be changed later except by resetting in the
          dashboard.
        </p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">rpName</legend>
        <input class="input input-bordered w-full" bind:value={rpName} />
      </fieldset>

      <div class="grid grid-cols-2 gap-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Display name</legend>
          <input class="input input-bordered w-full" bind:value={displayName} />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Username</legend>
          <input class="input input-bordered w-full" bind:value={username} />
        </fieldset>
      </div>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Expected origins (comma separated, optional)</legend>
        <input class="input input-bordered w-full" bind:value={origins} />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Webhook (term.started URL)</legend>
        <input
          class="input input-bordered w-full"
          bind:value={webhook}
          placeholder="https://hooks.example.com"
        />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Session encryption key</legend>
        <div class="join w-full">
          <input
            class="input input-bordered join-item w-full"
            bind:value={sessionKey}
            placeholder="Leave empty to keep the current key"
          />
          <button class="btn join-item" type="button" onclick={generateKey}>Generate</button>
        </div>
        <p class="text-xs opacity-60">
          Signs session cookies. Leave empty to keep the current key; generating a new one
          invalidates existing sessions and only takes effect when you confirm below.
        </p>
      </fieldset>

      <div class="flex justify-end">
        <button class="btn btn-primary" onclick={confirm} disabled={saving}>
          {saving ? "Saving..." : content.submitLabel}
        </button>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={() => (open = false)}>close</button>
  </form>
</dialog>
