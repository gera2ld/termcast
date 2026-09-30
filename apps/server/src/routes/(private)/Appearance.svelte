<script lang="ts">
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { ToggleGroup, ToggleGroupItem } from "$lib/components/ui/toggle-group";
  import { GlobalState } from "$lib/global.svelte";
  import { toast } from "svelte-sonner";
  import type { TerminalTheme } from "@termcast/shared";

  const globalState = GlobalState.get();

  const theme = $derived(globalState.settings?.terminalTheme ?? "auto");

  const options: { value: TerminalTheme; label: string; hint: string }[] = [
    { value: "auto", label: "Auto", hint: "Follow system" },
    { value: "light", label: "Light", hint: "Tokyo Night Light" },
    { value: "dark", label: "Dark", hint: "Tokyo Night Storm" },
  ];

  let saving = $state(false);

  async function select(value: string) {
    if (!value || value === theme || saving) return;
    saving = true;
    try {
      await globalState.updateSettings({ terminalTheme: value as TerminalTheme });
      toast.info("Terminal theme saved.");
    } catch (err) {
      toast.error(`Failed to save terminal theme: ${(err as Error).message}`);
    } finally {
      saving = false;
    }
  }
</script>

<Card>
  <CardHeader>
    <CardTitle>Appearance</CardTitle>
    <CardDescription>
      Terminal theme. Applies to the dashboard and shared session views.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <ToggleGroup
      type="single"
      variant="outline"
      value={theme}
      onValueChange={select}
      class="mt-2"
      aria-label="Terminal theme"
    >
      {#each options as option (option.value)}
        <ToggleGroupItem value={option.value} title={option.hint} disabled={saving}>
          {option.label}
        </ToggleGroupItem>
      {/each}
    </ToggleGroup>
  </CardContent>
</Card>
