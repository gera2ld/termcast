<script lang="ts">
  import Pagination, { PAGE_SIZE } from "$lib/components/Pagination.svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { orpc } from "$lib/orpc-client";
  import { ToastState } from "@/lib/toasts.svelte";
  import { formatArgs, type Command } from "@termcast/shared";
  import { nanoid } from "nanoid";
  import CommandForm from "./CommandForm.svelte";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  let editing = $state<Command | undefined>(undefined);
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
      toastState.show("Command line is required.", "error");
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
      toastState.show("Command saved.", "info");
    } catch (err) {
      toastState.show(`Failed to save command: ${(err as Error).message}`, "error");
    } finally {
      saving = false;
    }
  }

  async function handleDelete(command: Command) {
    if (!window.confirm(`Delete command "${command.label}"?`)) return;
    try {
      await globalState.deleteCommand(command.id);
      if (editing?.id === command.id) closeForm();
      toastState.show("Command deleted.", "info");
    } catch (err) {
      toastState.show(`Failed to delete command: ${(err as Error).message}`, "error");
    }
  }

  async function connectCommand(command: Command) {
    try {
      const { id } = await orpc.tabs.open({ commandId: command.id });
      globalState.openTab({ id, label: command.label });
    } catch (err) {
      toastState.show(`Failed to start command: ${(err as Error).message}`, "error");
    }
  }
</script>

<h2 class="mb-2 text-lg font-medium">My Commands</h2>

<div class="rounded-box border-base-300 max-w-screen-lg overflow-x-auto border">
  <table class="table min-w-150">
    <thead>
      <tr>
        <th class="w-40">Label</th>
        <th>Command</th>
        <th class="w-56">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as command}
        <tr class={editing?.id === command.id ? "bg-base-200" : ""}>
          <td class="font-medium">{command.label}</td>
          <td><code class="text-sm">{formatArgs(command.args)}</code></td>
          <td>
            <div class="flex flex-wrap gap-2">
              <button class="btn-link" onclick={() => connectCommand(command)}> Connect </button>
              <button class="btn-link" onclick={() => startEdit(command)}>Edit</button>
              <button class="btn-link text-error" onclick={() => handleDelete(command)}>
                Delete
              </button>
            </div>
          </td>
        </tr>
        {#if editing?.id === command.id}
          <tr>
            <td colspan="3" class="bg-base-200">
              <CommandForm
                name={command.id}
                label={command.label}
                args={formatArgs(command.args)}
                submitLabel="Save"
                {saving}
                onsubmit={(data) => handleSave(data)}
                oncancel={closeForm}
              />
            </td>
          </tr>
        {/if}
      {/each}
      {#if !showForm}
        <tr>
          <td colspan="3">
            <button class="btn btn-primary btn-sm" onclick={startCreate}>Add Command</button>
          </td>
        </tr>
      {:else if !editing}
        <tr>
          <td colspan="3" class="bg-base-200">
            <CommandForm
              submitLabel="Create"
              {saving}
              onsubmit={(data) => handleSave(data)}
              oncancel={closeForm}
            />
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<Pagination {page} {pageCount} onchange={changePage} />
