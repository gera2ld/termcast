<script lang="ts">
  import CopyLink from "$lib/components/CopyLink.svelte";
  import Pagination from "$lib/components/Pagination.svelte";
  import { formatTimeLeft } from "$lib/util";
  import { GlobalState } from "$lib/global.svelte";
  import { TabState } from "$lib/tabs.svelte";
  import type { IShareToken } from "$lib/types";
  import type { TabInfo } from "@termcast/shared";

  const globalState = GlobalState.get();
  const tabState = new TabState();

  let { tab }: { tab: TabInfo } = $props();

  const SHARE_PAGE_SIZE = 5;

  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let busy = $state(false);
  let page = $state(0);
  let open = $state(false);
  let now = $state(Date.now());

  // Derived values
  const tokens = $derived(globalState.connections[tab.id]?.shareTokens ?? []);
  const writable = $derived(tokens.some((item) => item.allowWrite));
  const pageCount = $derived(Math.max(1, Math.ceil(tokens.length / SHARE_PAGE_SIZE)));
  const visible = $derived(tokens.slice(page * SHARE_PAGE_SIZE, (page + 1) * SHARE_PAGE_SIZE));
  const viewOnlyCount = $derived(
    tokens.reduce((sum, t) => sum + (t.allowWrite ? 0 : t.connections), 0),
  );
  const canTypeCount = $derived(
    tokens.reduce((sum, t) => sum + (t.allowWrite ? t.connections : 0), 0),
  );
  const totalConnections = $derived(viewOnlyCount + canTypeCount);

  const label = $derived(
    !tokens.length
      ? "Share"
      : totalConnections === 0
        ? "Sharing (no connection yet)"
        : viewOnlyCount === 0
          ? `Sharing (${canTypeCount} can type)`
          : canTypeCount === 0
            ? `Sharing (${viewOnlyCount} view only)`
            : `Sharing (${viewOnlyCount} view only, ${canTypeCount} can type)`,
  );

  const buttonClass = $derived(
    !tokens.length
      ? "btn btn-sm"
      : canTypeCount > 1
        ? "btn btn-sm btn-error"
        : "btn btn-sm btn-warning",
  );

  // Effects
  $effect(() => {
    if (page > 0 && page >= pageCount) page = pageCount - 1;
  });

  $effect(() => {
    if (!open) return;
    void globalState.loadTunnel();
  });

  // Actions
  function openDialog() {
    now = Date.now();
    open = true;
    dialog?.showModal();
  }

  function closeDialog() {
    open = false;
  }

  async function loadTokens() {
    if (!tab.id) return;
    try {
      const result = await tabState.listShareTokens(tab.id);
      const conn = globalState.connections[tab.id];
      if (conn) conn.shareTokens = result;
    } catch {
      // Ignore errors - WebSocket will update
    }
  }

  async function run(action: () => Promise<unknown>, failure: string) {
    busy = true;
    try {
      await action();
      await loadTokens();
    } catch (err) {
      console.error(`${failure}: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex shrink-0 items-center justify-end gap-2 py-1">
  <button class={buttonClass} onclick={openDialog} disabled={!tab.id}>
    {label}
  </button>
</div>

<dialog class="modal" bind:this={dialog} onclose={closeDialog}>
  <div class="modal-box max-w-3xl">
    <h3 class="text-lg font-medium">Share this session</h3>
    <p class="mt-2 text-sm">
      Each link lets someone join this terminal live and see everything on screen. Links last an
      hour; whoever is using one is disconnected when it expires or is revoked. Each link admits one
      viewer at a time unless you raise its limit.
    </p>

    {#if tokens.length}
      <div class="rounded-box border-base-300 mt-4 overflow-x-auto border">
        <table class="table-sm table min-w-200">
          <thead>
            <tr>
              <th>Link</th>
              <th class="w-36">Access</th>
              <th class="w-28">Connections</th>
              <th class="w-44"></th>
            </tr>
          </thead>
          <tbody>
            {#each visible as item (item.token)}
              <tr class={item.allowWrite ? "bg-error/10" : ""}>
                <td>
                  <CopyLink value={globalState.shareUrl(item.token)} />
                  <div class="text-sm opacity-50">
                    Expires in {formatTimeLeft(item.expireAt, now)}
                  </div>
                </td>
                <td>
                  <select
                    class="select select-bordered select-sm {item.allowWrite ? 'select-error' : ''}"
                    value={item.allowWrite ? "write" : "read"}
                    disabled={busy}
                    onchange={(e) =>
                      run(
                        () =>
                          tabState.updateShareToken(item.token, e.currentTarget.value === "write"),
                        "Failed to change access",
                      )}
                  >
                    <option value="read">View only</option>
                    <option value="write">Can type</option>
                  </select>
                </td>
                <td>
                  <label class="flex items-center gap-1 text-sm">
                    <span class="opacity-70">{item.connections}</span>
                    <span class="opacity-40">/</span>
                    <input
                      class="input input-bordered input-xs w-14"
                      type="number"
                      min="1"
                      value={item.maxConnections}
                      disabled={busy}
                      onchange={(e) =>
                        run(
                          () =>
                            tabState.updateShareToken(
                              item.token,
                              item.allowWrite,
                              Number(e.currentTarget.value),
                            ),
                          "Failed to set connection limit",
                        )}
                    />
                  </label>
                </td>
                <td>
                  <div class="flex items-center gap-1">
                    <button
                      class="btn btn-ghost btn-sm"
                      disabled={busy}
                      onclick={() =>
                        run(() => tabState.renewShareToken(item.token), "Failed to renew link")}
                    >
                      Renew
                    </button>
                    <button
                      class="btn btn-ghost btn-sm text-error"
                      disabled={busy}
                      onclick={() =>
                        run(() => tabState.revokeShareToken(item.token), "Failed to revoke link")}
                    >
                      Revoke
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <Pagination {page} {pageCount} onchange={(next) => (page = next)} />
    {:else}
      <p class="mt-4 text-sm opacity-70">Not shared. Create a link to let someone join.</p>
    {/if}

    <div class="modal-action">
      {#if tokens.length}
        <button
          class="btn btn-sm btn-error btn-outline mr-auto"
          disabled={busy}
          onclick={() => run(() => tabState.revokeShareTokens(tab.id!), "Failed to stop sharing")}
        >
          Stop sharing
        </button>
      {/if}
      <button
        class="btn btn-primary btn-sm"
        disabled={busy}
        onclick={() => run(() => tabState.createShareToken(tab.id!), "Failed to create a link")}
      >
        Add link
      </button>
      <form method="dialog">
        <button class="btn btn-sm">Close</button>
      </form>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
