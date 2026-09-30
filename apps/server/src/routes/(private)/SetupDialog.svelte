<script lang="ts">
  import { generateSessionKey } from "@termcast/shared";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Field from "$lib/components/ui/field";
  import { Input } from "$lib/components/ui/input";
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Separator } from "$lib/components/ui/separator";
  import { Spinner } from "$lib/components/ui/spinner";
  import { GlobalState } from "$lib/global.svelte";
  import { toast } from "svelte-sonner";

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

  // Re-seed the form each time the dialog opens so it never shows a stale reset.
  $effect(() => {
    if (open) loadFromSettings();
  });

  async function confirm() {
    if (!rpId.trim()) {
      toast.error("rpId is required.");
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
      toast.info("Settings saved.");
      open = false;
      onsaved?.();
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] max-w-2xl overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{content.title}</Dialog.Title>
      {#if content.intro}
        <Dialog.Description>{content.intro}</Dialog.Description>
      {/if}
    </Dialog.Header>

    <Separator />

    <Field.Set>
      <Field.Group>
        <Field.Field>
          <Field.Label for="setup-rpId">
            rpId <span class="text-destructive">*</span>
          </Field.Label>
          <Input
            id="setup-rpId"
            bind:value={rpId}
            placeholder="e.g. termcast.example.com"
            required
          />
          <Field.Description>
            Must match the HTTPS host. This cannot be changed later except by resetting in the
            dashboard.
          </Field.Description>
        </Field.Field>

        <Field.Field>
          <Field.Label for="setup-rpName">rpName</Field.Label>
          <Input id="setup-rpName" bind:value={rpName} />
        </Field.Field>

        <div class="grid grid-cols-2 gap-4">
          <Field.Field>
            <Field.Label for="setup-displayName">Display name</Field.Label>
            <Input id="setup-displayName" bind:value={displayName} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="setup-username">Username</Field.Label>
            <Input id="setup-username" bind:value={username} />
          </Field.Field>
        </div>

        <Field.Field>
          <Field.Label for="setup-origins">Expected origins (comma separated, optional)</Field.Label
          >
          <Input id="setup-origins" bind:value={origins} />
        </Field.Field>

        <Field.Field>
          <Field.Label for="setup-webhook">Webhook (term.started URL)</Field.Label>
          <Input id="setup-webhook" bind:value={webhook} placeholder="https://hooks.example.com" />
        </Field.Field>

        <Field.Field>
          <Field.Label for="setup-sessionKey">Session encryption key</Field.Label>
          <InputGroup.Root>
            <InputGroup.Input
              id="setup-sessionKey"
              bind:value={sessionKey}
              placeholder="Leave empty to keep the current key"
            />
            <InputGroup.Button variant="outline" size="sm" onclick={generateKey}>
              Generate
            </InputGroup.Button>
          </InputGroup.Root>
          <Field.Description>
            Signs session cookies. Leave empty to keep the current key; generating a new one
            invalidates existing sessions and only takes effect when you confirm below.
          </Field.Description>
        </Field.Field>
      </Field.Group>

      <div class="mt-4 flex justify-end">
        <Button onclick={confirm} disabled={saving}>
          {#if saving}
            <Spinner />
            Saving...
          {:else}
            {content.submitLabel}
          {/if}
        </Button>
      </div>
    </Field.Set>
  </Dialog.Content>
</Dialog.Root>
