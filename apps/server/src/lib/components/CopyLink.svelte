<script lang="ts">
  import { ToastState } from "$lib/toasts.svelte";

  const toastState = ToastState.get();

  let { value, class: className = "" }: { value: string; class?: string } = $props();

  let copied = $state(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      toastState.show("Could not copy the link, please select and copy it manually.", "error");
    }
  }
</script>

<div class="flex items-center gap-2 {className}">
  <input
    class="input input-bordered input-sm w-full flex-1 font-mono"
    readonly
    {value}
    onclick={(e) => e.currentTarget.select()}
  />
  <button class="btn btn-sm shrink-0" onclick={handleCopy}>
    {copied ? "Copied" : "Copy"}
  </button>
</div>
