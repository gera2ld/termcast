<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { orpc } from "#lib/orpc-client.js";
  import { formatArgs, type Command } from "@termcast/shared";
  import { toast } from "svelte-sonner";
  import { PlusIcon } from "@lucide/svelte";

  const globalState = GlobalState.get();

  let busy = $state(false);

  async function start(command: Command) {
    if (busy) return;
    busy = true;
    try {
      const { id } = await orpc.tabs.open({ commandId: command.id });
      globalState.openTab({ id, label: command.label });
    } catch (err) {
      toast.error(`Failed to start command: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="icon-sm" aria-label="New session" disabled={busy}>
        <PlusIcon />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-64">
    {#each globalState.commands as command (command.id)}
      <DropdownMenu.Item onclick={() => start(command)} class="flex-col items-start gap-0.5">
        <span class="truncate">{command.label}</span>
        <span class="text-muted-foreground truncate text-xs">{formatArgs(command.args)}</span>
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item disabled>No commands yet</DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
