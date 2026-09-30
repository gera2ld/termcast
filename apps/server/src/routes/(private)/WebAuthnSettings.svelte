<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import * as Field from "$lib/components/ui/field";
  import { Input } from "$lib/components/ui/input";
  import { GlobalState } from "$lib/global.svelte";
  import { toast } from "svelte-sonner";
  import type { Settings } from "@termcast/shared";

  const globalState = GlobalState.get();

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
      toast.info("Settings saved.");
    } catch (err) {
      toast.error(`Failed to save settings: ${(err as Error).message}`);
    } finally {
      saving = false;
    }
  }
</script>

<Card>
  <CardHeader>
    <CardTitle>WebAuthn Settings</CardTitle>
  </CardHeader>
  <CardContent>
    <Field.Set>
      <Field.Group>
        <Field.Field>
          <Field.Label for="rpId">rpId</Field.Label>
          <Input id="rpId" value={globalState.settings?.rpId ?? ""} readonly />
          <Field.Description>Read-only here. To change it, use the danger zone.</Field.Description>
        </Field.Field>

        <Field.Field>
          <Field.Label for="rpName">rpName</Field.Label>
          <Input id="rpName" bind:value={form.rpName} />
        </Field.Field>

        <div class="grid grid-cols-2 gap-4">
          <Field.Field>
            <Field.Label for="displayName">Display name</Field.Label>
            <Input id="displayName" bind:value={form.displayName} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="username">Username</Field.Label>
            <Input id="username" bind:value={form.username} />
          </Field.Field>
        </div>

        <Field.Field>
          <Field.Label for="origins">Expected origins (comma separated)</Field.Label>
          <Input id="origins" bind:value={form.origins} />
        </Field.Field>

        <Field.Field>
          <Field.Label for="webhook">Webhook (term.started URL)</Field.Label>
          <Input id="webhook" bind:value={form.webhook} placeholder="https://hooks.example.com" />
        </Field.Field>
      </Field.Group>

      <div class="mt-4 flex justify-end">
        <Button onclick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Field.Set>
  </CardContent>
</Card>
