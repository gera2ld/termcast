<script module lang="ts">
  export const PAGE_SIZE = 10;
</script>

<script lang="ts">
  let {
    page,
    pageCount,
    onchange,
  }: { page: number; pageCount: number; onchange: (page: number) => void } = $props();
</script>

{#if pageCount > 1}
  <div class="join mt-2">
    <button
      class="join-item btn btn-sm"
      disabled={page === 0}
      onclick={() => onchange(page - 1)}
      aria-label="Previous page"
    >
      «
    </button>
    <span class="join-item btn btn-sm btn-disabled">Page {page + 1} of {pageCount}</span>
    <button
      class="join-item btn btn-sm"
      disabled={page >= pageCount - 1}
      onclick={() => onchange(page + 1)}
      aria-label="Next page"
    >
      »
    </button>
  </div>
{/if}
