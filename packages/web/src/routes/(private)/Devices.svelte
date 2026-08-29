<script lang="ts">
  import CopyLink from "$lib/components/CopyLink.svelte";
  import Pagination, { PAGE_SIZE } from "$lib/components/Pagination.svelte";
  import { GlobalState } from "$lib/global.svelte";
  import { orpc } from "$lib/orpc-client";
  import { ToastState } from "$lib/toasts.svelte";
  import { handleRegister, loading, registerRequested } from "$lib/webauthn";
  import type { DeviceInfo } from "@termcast/shared";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  let editing = $state<DeviceInfo | undefined>(undefined);

  function fmt(value?: Date | string | null): string {
    return value ? new Date(value).toLocaleString() : "—";
  }
  let name = $state("");
  let registering = $state(false);
  let passkeyName = $state("");
  let page = $state(0);
  let linking = $state(false);
  let linkUrl = $state("");

  const pageCount = $derived(Math.max(1, Math.ceil(globalState.devices.length / PAGE_SIZE)));
  const visible = $derived(globalState.devices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  $effect(() => {
    if (!$registerRequested) return;
    registerRequested.set(false);
    openRegister();
  });

  // SvelteKit resets focus once a navigation completes, which can land after this form
  // is mounted. Its reset targets the element carrying `autofocus`, so setting the
  // attribute keeps focus here no matter which of the two happens last.
  function autofocus(node: HTMLInputElement) {
    node.autofocus = true;
    node.focus();
  }

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
    registering = true;
  }

  function closeForm() {
    editing = undefined;
    registering = false;
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
    toastState.show("Device renamed.", "info");
    closeForm();
  }

  async function handleLink() {
    linking = true;
    try {
      const { token } = await orpc.auth.link();
      linkUrl = `${window.location.origin}/?grant=${token}`;
    } catch (err) {
      toastState.show(`Failed to create a link: ${(err as Error).message}`, "error");
    } finally {
      linking = false;
    }
  }

  async function handleRegisterClick() {
    if (!passkeyName.trim() || $loading) return;
    closeForm();
    await handleRegister(passkeyName.trim());
    globalState.reloadDashboard();
    toastState.show("Device registered.", "info");
  }

  async function handleDelete(device: DeviceInfo) {
    if (!window.confirm(`Delete device "${device.name}"?`)) return;
    await orpc.devices.remove({ id: device.id });
    globalState.devices = globalState.devices.filter((item) => item.id !== device.id);
    toastState.show("Device deleted.", "info");
  }
</script>

<h2 class="mb-2 text-lg font-medium">My Devices</h2>

<div class="rounded-box border-base-300 max-w-screen-lg overflow-x-auto border">
  <table class="table min-w-150">
    <thead>
      <tr>
        <th>Device Name</th>
        <th>Created At</th>
        <th>Last Used At</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as device}
        <tr class={editing?.id === device.id ? "bg-base-200" : ""}>
          <td class="font-medium">{device.name}</td>
          <td>{fmt(device.createdAt)}</td>
          <td>{fmt(device.lastUsedAt)}</td>
          <td>
            <div class="flex flex-wrap gap-2">
              <button class="btn-link" onclick={() => openEdit(device)}>Edit name</button>
              {#if globalState.devices.length > 1}
                <button class="btn-link text-error" onclick={() => handleDelete(device)}>
                  Delete
                </button>
              {/if}
            </div>
          </td>
        </tr>
        {#if editing?.id === device.id}
          <tr>
            <td colspan="4">
              <form
                class="flex flex-wrap items-center gap-2"
                onsubmit={(e) => {
                  e.preventDefault();
                  handleSaveName();
                }}
              >
                <input
                  class="input input-bordered input-sm w-full max-w-xs flex-1"
                  bind:value={name}
                  placeholder="Device name"
                  required
                />
                <button class="btn btn-primary btn-sm" type="submit">Save</button>
                <button class="btn btn-sm" type="button" onclick={closeForm}>Cancel</button>
              </form>
            </td>
          </tr>
        {/if}
      {/each}
      {#if registering}
        <tr>
          <td colspan="4">
            <form
              class="flex flex-wrap items-center gap-2"
              onsubmit={(e) => {
                e.preventDefault();
                handleRegisterClick();
              }}
            >
              <input
                class="input input-bordered input-sm w-full max-w-xs flex-1"
                use:autofocus
                bind:value={passkeyName}
                placeholder="Passkey name"
                required
              />
              <button class="btn btn-primary btn-sm" type="submit" disabled={$loading}>
                {$loading ? "Registering..." : "Register"}
              </button>
              <button class="btn btn-sm" type="button" onclick={closeForm}>Cancel</button>
            </form>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="4">
            <div class="flex flex-wrap items-center gap-2">
              <button class="btn btn-primary btn-sm" onclick={openRegister} disabled={$loading}>
                {$loading ? "Registering..." : "Register device"}
              </button>
              {#if globalState.user?.hasRegistered}
                <button class="btn btn-sm" onclick={handleLink} disabled={linking}>
                  {linking ? "Creating link..." : "Link to another device"}
                </button>
              {/if}
            </div>
            {#if linkUrl}
              <p class="mt-2 text-sm">Open this link on the new device within 5 minutes.</p>
              <CopyLink value={linkUrl} class="mt-1" />
            {/if}
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<Pagination {page} {pageCount} onchange={changePage} />
