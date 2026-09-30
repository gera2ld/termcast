<script lang="ts">
  import CopyLink from "$lib/components/CopyLink.svelte";
  import Pagination, { PAGE_SIZE } from "$lib/components/Pagination.svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import * as Field from "$lib/components/ui/field";
  import { Input } from "$lib/components/ui/input";
  import * as Table from "$lib/components/ui/table";
  import { GlobalState } from "$lib/global.svelte";
  import { orpc } from "$lib/orpc-client";
  import { handleRegister, loading, registerRequested } from "$lib/webauthn";
  import { toast } from "svelte-sonner";
  import { CircleAlertIcon } from "@lucide/svelte";
  import type { DeviceInfo } from "@termcast/shared";

  const globalState = GlobalState.get();

  let editing = $state<DeviceInfo | undefined>(undefined);
  let deleting = $state<DeviceInfo | undefined>(undefined);

  function fmt(value?: Date | string | null): string {
    return value ? new Date(value).toLocaleString() : "—";
  }
  let name = $state("");
  let registerInput = $state<HTMLInputElement | null>(null);
  let registering = $state(false);
  let passkeyName = $state("");
  let page = $state(0);
  let linking = $state(false);
  let linkUrl = $state("");
  let registerError = $state<string | null>(null);

  const pageCount = $derived(Math.max(1, Math.ceil(globalState.devices.length / PAGE_SIZE)));
  const visible = $derived(globalState.devices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  $effect(() => {
    if (!$registerRequested) return;
    registerRequested.set(false);
    openRegister();
  });

  // SvelteKit resets focus once a navigation completes, which can land after this form
  // is mounted. Its reset targets the element carrying `autofocus`, so the attribute keeps
  // focus here no matter which of the two happens last.
  $effect(() => {
    registerInput?.focus();
  });

  function changePage(next: number) {
    closeForm();
    page = next;
  }

  function openEdit(device: DeviceInfo) {
    registering = false;
    editing = device;
    name = device.name;
  }

  function openRegister() {
    editing = undefined;
    passkeyName = "";
    registerError = null;
    registering = true;
  }

  function closeForm() {
    editing = undefined;
    registering = false;
    registerError = null;
  }

  async function handleSaveName() {
    if (!editing) return;
    const newName = name.trim();
    if (!newName || newName === editing.name) {
      closeForm();
      return;
    }
    await orpc.devices.rename({ id: editing.id, name: newName });
    editing.name = newName;
    globalState.reloadDashboard();
    toast.info("Device renamed.");
    closeForm();
  }

  async function handleLink() {
    linking = true;
    try {
      const { token } = await orpc.auth.link();
      linkUrl = `${window.location.origin}/?grant=${token}`;
    } catch (err) {
      toast.error(`Failed to create a link: ${(err as Error).message}`);
    } finally {
      linking = false;
    }
  }

  async function handleRegisterClick() {
    if (!passkeyName.trim() || $loading) return;
    registerError = null;
    closeForm();
    try {
      await handleRegister(passkeyName.trim());
      globalState.reloadDashboard();
      toast.info("Device registered.");
    } catch (err) {
      registerError = err instanceof Error ? err.message : "Registration failed";
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    const device = deleting;
    deleting = undefined;
    await orpc.devices.remove({ id: device.id });
    globalState.devices = globalState.devices.filter((item) => item.id !== device.id);
    toast.info("Device deleted.");
  }
</script>

<h2 class="mb-2 text-lg font-medium">My Devices</h2>

<div class="max-w-screen-lg overflow-x-auto rounded-lg border">
  <Table.Root class="min-w-150">
    <Table.Header>
      <Table.Row>
        <Table.Head>Device Name</Table.Head>
        <Table.Head>Created At</Table.Head>
        <Table.Head>Last Used At</Table.Head>
        <Table.Head>Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each visible as device}
        <Table.Row class={editing?.id === device.id ? "bg-muted" : ""}>
          <Table.Cell class="font-medium">{device.name}</Table.Cell>
          <Table.Cell>{fmt(device.createdAt)}</Table.Cell>
          <Table.Cell>{fmt(device.lastUsedAt)}</Table.Cell>
          <Table.Cell>
            <div class="flex flex-wrap gap-2">
              <Button variant="link" size="sm" onclick={() => openEdit(device)}>Edit name</Button>
              {#if globalState.devices.length > 1}
                <Button
                  variant="link"
                  size="sm"
                  class="text-destructive"
                  onclick={() => (deleting = device)}
                >
                  Delete
                </Button>
              {/if}
            </div>
          </Table.Cell>
        </Table.Row>
        {#if editing?.id === device.id}
          <Table.Row>
            <Table.Cell colspan={4}>
              <form
                class="flex flex-wrap items-end gap-2"
                onsubmit={(e) => {
                  e.preventDefault();
                  handleSaveName();
                }}
              >
                <Field.Field class="w-full max-w-xs flex-1">
                  <Field.Label for="rename-device" class="sr-only">Device name</Field.Label>
                  <Input id="rename-device" bind:value={name} placeholder="Device name" required />
                </Field.Field>
                <Button size="sm" type="submit">Save</Button>
                <Button size="sm" variant="outline" type="button" onclick={closeForm}>
                  Cancel
                </Button>
              </form>
            </Table.Cell>
          </Table.Row>
        {/if}
      {/each}
      {#if registering}
        <Table.Row>
          <Table.Cell colspan={4}>
            <form
              class="flex flex-wrap items-end gap-2"
              onsubmit={(e) => {
                e.preventDefault();
                handleRegisterClick();
              }}
            >
              <Field.Field class="w-full max-w-xs flex-1">
                <Field.Label for="register-device" class="sr-only">Passkey name</Field.Label>
                <Input
                  id="register-device"
                  bind:ref={registerInput}
                  autofocus
                  bind:value={passkeyName}
                  placeholder="Passkey name"
                  required
                />
              </Field.Field>
              <Button size="sm" type="submit" disabled={$loading}>
                {$loading ? "Registering..." : "Register"}
              </Button>
              <Button size="sm" variant="outline" type="button" onclick={closeForm}>Cancel</Button>
            </form>
          </Table.Cell>
        </Table.Row>
      {:else}
        <Table.Row>
          <Table.Cell colspan={4}>
            <div class="flex flex-wrap items-center gap-2">
              <Button size="sm" onclick={openRegister} disabled={$loading}>
                {$loading ? "Registering..." : "Register device"}
              </Button>
              {#if globalState.user?.hasRegistered}
                <Button size="sm" variant="outline" onclick={handleLink} disabled={linking}>
                  {linking ? "Creating link..." : "Link to another device"}
                </Button>
              {/if}
            </div>
            {#if registerError}
              <Alert variant="destructive" class="mt-2 max-w-md">
                <CircleAlertIcon />
                <AlertDescription>{registerError}</AlertDescription>
              </Alert>
            {/if}
            {#if linkUrl}
              <p class="mt-2 text-sm">Open this link on the new device within 5 minutes.</p>
              <CopyLink value={linkUrl} class="mt-1" />
            {/if}
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
      <AlertDialog.Title>Delete device?</AlertDialog.Title>
      <AlertDialog.Description>
        "{deleting?.name}" will no longer be able to sign in with its passkey.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={handleDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
