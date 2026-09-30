<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import Pagination, { PAGE_SIZE } from "$lib/components/Pagination.svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { formatArgs, type Command } from "@termcast/shared";
  import { nanoid } from "nanoid";
  import { toast } from "svelte-sonner";
  import CommandForm from "./CommandForm.svelte";

  const globalState = GlobalState.get();

  let editing = $state<Command | undefined>(undefined);
  let deleting = $state<Command | undefined>(undefined);
  let showForm = $state(false);
  let saving = $state(false);
  let page = $state(0);

  const pageCount = $derived(Math.max(1, Math.ceil(globalState.commands.length / PAGE_SIZE)));
  const visible = $derived(globalState.commands.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  function changePage(next: number) {
    closeForm();
    page = next;
  }

  function startCreate() {
    editing = undefined;
    showForm = true;
  }

  function startEdit(command: Command) {
    editing = command;
    showForm = true;
  }

  function closeForm() {
    editing = undefined;
    showForm = false;
  }

  async function handleSave(data: { label: string; args: string[] }) {
    if (!data.args.length) {
      toast.error("Command line is required.");
      return;
    }
    saving = true;
    try {
      if (editing) {
        await globalState.updateCommand(editing.id, { label: data.label, args: data.args });
      } else {
        await globalState.createCommand({ id: nanoid(), label: data.label, args: data.args });
      }
      closeForm();
      toast.info("Command saved.");
    } catch (err) {
      toast.error(`Failed to save command: ${(err as Error).message}`);
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    const command = deleting;
    deleting = undefined;
    try {
      await globalState.deleteCommand(command.id);
      if (editing?.id === command.id) closeForm();
      toast.info("Command deleted.");
    } catch (err) {
      toast.error(`Failed to delete command: ${(err as Error).message}`);
    }
  }
</script>

<h2 class="mb-2 text-lg font-medium">My Commands</h2>

<div class="max-w-screen-lg overflow-x-auto rounded-lg border">
  <Table.Root class="min-w-150">
    <Table.Header>
      <Table.Row>
        <Table.Head class="w-40">Label</Table.Head>
        <Table.Head>Command</Table.Head>
        <Table.Head class="w-56">Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each visible as command}
        <Table.Row class={editing?.id === command.id ? "bg-muted" : ""}>
          <Table.Cell class="font-medium">{command.label}</Table.Cell>
          <Table.Cell><code class="text-sm">{formatArgs(command.args)}</code></Table.Cell>
          <Table.Cell>
            <div class="flex flex-wrap gap-2">
              <Button variant="link" size="sm" onclick={() => startEdit(command)}>Edit</Button>
              <Button
                variant="link"
                size="sm"
                class="text-destructive"
                onclick={() => (deleting = command)}
              >
                Delete
              </Button>
            </div>
          </Table.Cell>
        </Table.Row>
        {#if editing?.id === command.id}
          <Table.Row>
            <Table.Cell colspan={3} class="bg-muted">
              <CommandForm
                name={command.id}
                label={command.label}
                args={formatArgs(command.args)}
                submitLabel="Save"
                {saving}
                onsubmit={handleSave}
                oncancel={closeForm}
              />
            </Table.Cell>
          </Table.Row>
        {/if}
      {/each}
      {#if !showForm}
        <Table.Row>
          <Table.Cell colspan={3}>
            <Button size="sm" onclick={startCreate}>Add Command</Button>
          </Table.Cell>
        </Table.Row>
      {:else if !editing}
        <Table.Row>
          <Table.Cell colspan={3} class="bg-muted">
            <CommandForm submitLabel="Create" {saving} onsubmit={handleSave} oncancel={closeForm} />
          </Table.Cell>
        </Table.Row>
      {/if}
    </Table.Body>
  </Table.Root>
</div>

<Pagination {page} {pageCount} onchange={changePage} />

<AlertDialog.Root
  open={deleting !== undefined}
  onOpenChange={(next) => {
    if (!next) deleting = undefined;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete command?</AlertDialog.Title>
      <AlertDialog.Description>
        "{deleting?.label}" will be removed and any running session stays open.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={handleDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
