<script lang="ts">
  import CopyLink from "#lib/components/CopyLink.svelte";
  import Pagination from "#lib/components/Pagination.svelte";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ButtonGroup from "#lib/components/ui/button-group/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Select from "#lib/components/ui/select/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatTimeLeft } from "#lib/util.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { TabState } from "#lib/tabs.svelte.js";
  import type { IShareToken } from "#lib/types.js";
  import type { TabInfo } from "@termcast/shared";

  const globalState = GlobalState.get();
  const tabState = new TabState();

  let { tab }: { tab: TabInfo } = $props();

  const SHARE_PAGE_SIZE = 5;

  let busy = $state(false);
  let page = $state(0);
  let open = $state(false);
  let stopOpen = $state(false);
  let now = $state(Date.now());

  const ACCESS_OPTIONS = [
    { value: "read", label: "View only" },
    { value: "write", label: "Can type" },
  ];

  // Derived values
  const tokens = $derived(globalState.connections[tab.id]?.shareTokens ?? []);
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

  const variant = $derived(
    !tokens.length ? "outline" : canTypeCount > 1 ? "destructive" : "default",
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

  function revokeLink(item: IShareToken) {
    return run(() => tabState.revokeShareToken(item.token), "Failed to revoke link");
  }
</script>

<div class="flex shrink-0 items-center justify-end gap-2 py-1">
  <Button {variant} size="sm" onclick={openDialog} disabled={!tab.id}>
    {label}
  </Button>
</div>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Share this session</Dialog.Title>
      <Dialog.Description>
        Each link lets someone join this terminal live and see everything on screen. Links last an
        hour; whoever is using one is disconnected when it expires or is revoked. Each link admits
        one viewer at a time unless you raise its limit.
      </Dialog.Description>
    </Dialog.Header>

    {#if tokens.length}
      <div class="mt-4 max-h-80 overflow-auto rounded-lg border">
        <Table.Root class="min-w-200">
          <Table.Header>
            <Table.Row>
              <Table.Head>Link</Table.Head>
              <Table.Head class="w-36">Access</Table.Head>
              <Table.Head class="w-28">Connections</Table.Head>
              <Table.Head class="w-44"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each visible as item (item.token)}
              <Table.Row class={item.allowWrite ? "bg-destructive/10" : ""}>
                <Table.Cell>
                  <CopyLink value={globalState.shareUrl(item.token)} />
                  <div class="text-sm opacity-50">
                    Expires in {formatTimeLeft(item.expireAt, now)}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Select.Root
                    type="single"
                    items={ACCESS_OPTIONS}
                    value={item.allowWrite ? "write" : "read"}
                    disabled={busy}
                    onValueChange={(value) =>
                      run(
                        () => tabState.updateShareToken(item.token, value === "write"),
                        "Failed to change access",
                      )}
                  >
                    <Select.Trigger size="sm" class={item.allowWrite ? "text-destructive" : ""}>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {#each ACCESS_OPTIONS as option (option.value)}
                        <Select.Item value={option.value} label={option.label}>
                          {option.label}
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </Table.Cell>
                <Table.Cell>
                  <div class="flex items-center gap-1 text-sm">
                    <span class="opacity-70">{item.connections}</span>
                    <span class="opacity-40">/</span>
                    <Input
                      type="number"
                      min="1"
                      class="w-14"
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
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <ButtonGroup.Root>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onclick={() =>
                        run(() => tabState.renewShareToken(item.token), "Failed to renew link")}
                    >
                      Renew
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="text-destructive"
                      disabled={busy}
                      onclick={() => revokeLink(item)}
                    >
                      Revoke
                    </Button>
                  </ButtonGroup.Root>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>

      <Pagination {page} {pageCount} onchange={(next) => (page = next)} />
    {:else}
      <p class="text-muted-foreground mt-4 text-sm">
        Not shared. Create a link to let someone join.
      </p>
    {/if}

    <Dialog.Footer>
      {#if tokens.length}
        <AlertDialog.Root bind:open={stopOpen}>
          <AlertDialog.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="sm"
                class="text-destructive mr-auto"
                disabled={busy}
              >
                Stop sharing
              </Button>
            {/snippet}
          </AlertDialog.Trigger>
          <AlertDialog.Content>
            <AlertDialog.Header>
              <AlertDialog.Title>Stop sharing this session?</AlertDialog.Title>
              <AlertDialog.Description>
                Everyone currently watching will be disconnected and every share link will stop
                working.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                onclick={() =>
                  run(() => tabState.revokeShareTokens(tab.id!), "Failed to stop sharing")}
              >
                Stop sharing
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
      {/if}
      <Button
        size="sm"
        disabled={busy}
        onclick={() => run(() => tabState.createShareToken(tab.id!), "Failed to create a link")}
      >
        Add link
      </Button>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} variant="outline" size="sm">Close</Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
