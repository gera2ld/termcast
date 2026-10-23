<script lang="ts">
  import * as InputGroup from "#lib/components/ui/input-group/index.js";
  import { CopyIcon, CheckIcon } from "@lucide/svelte";
  import { toast } from "svelte-sonner";

  let { value, class: className = "" }: { value: string; class?: string } = $props();

  let copied = $state(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      toast.error("Could not copy the link, please select and copy it manually.");
    }
  }
</script>

<InputGroup.Root class={className}>
  <InputGroup.Input {value} readonly class="font-mono" onclick={(e) => e.currentTarget.select()} />
  <InputGroup.Button onclick={handleCopy} variant="outline" aria-label="Copy link">
    {#if copied}
      <CheckIcon />
      Copied
    {:else}
      <CopyIcon />
      Copy
    {/if}
  </InputGroup.Button>
</InputGroup.Root>
