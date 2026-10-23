<script module lang="ts">
  export const PAGE_SIZE = 10;
</script>

<script lang="ts">
  import * as Pagination from "#lib/components/ui/pagination/index.js";

  let {
    page,
    pageCount,
    onchange,
  }: { page: number; pageCount: number; onchange: (page: number) => void } = $props();

  // bits-ui counts items and 1-indexes pages; this wrapper is 0-indexed.
  const count = $derived(pageCount * PAGE_SIZE);
</script>

{#if pageCount > 1}
  <Pagination.Root
    {count}
    perPage={PAGE_SIZE}
    page={page + 1}
    onPageChange={(next) => onchange(next - 1)}
    class="mt-2"
  >
    {#snippet children({ pages, currentPage })}
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous />
        </Pagination.Item>
        {#each pages as p (p.key)}
          <Pagination.Item>
            {#if p.type === "page"}
              <Pagination.Link page={p} isActive={p.value === currentPage} />
            {:else}
              <Pagination.Ellipsis />
            {/if}
          </Pagination.Item>
        {/each}
        <Pagination.Item>
          <Pagination.Next />
        </Pagination.Item>
      </Pagination.Content>
    {/snippet}
  </Pagination.Root>
{/if}
