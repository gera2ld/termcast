<script lang="ts">
  import { parseArgs } from "@termcast/shared";

  let {
    name,
    label: initialLabel = "",
    args: initialArgs = "",
    submitLabel,
    saving = false,
    onsubmit,
    oncancel,
  }: {
    name?: string;
    label?: string;
    args?: string;
    submitLabel: string;
    saving?: boolean;
    onsubmit?: (data: { label: string; args: string[] }) => void;
    oncancel?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let label = $state(initialLabel);
  // svelte-ignore state_referenced_locally
  let args = $state(initialArgs);

  function handleSubmit() {
    onsubmit?.({
      label: label || name || "",
      args: parseArgs(args),
    });
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
>
  <div class="grid grid-cols-2 gap-2">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Label</legend>
      <input
        class="input input-bordered input-sm block w-full"
        bind:value={label}
        placeholder="e.g. Run Bash"
      />
    </fieldset>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Command line</legend>
      <input
        class="input input-bordered input-sm block w-full font-mono"
        bind:value={args}
        placeholder={'ssh user@host -t "tmux attach"'}
        required
      />
    </fieldset>
  </div>
  <div class="mt-2 flex justify-end gap-2">
    <button class="btn btn-primary btn-sm" type="submit" disabled={saving}>
      {saving ? "Saving..." : submitLabel}
    </button>
    <button class="btn btn-sm" type="button" onclick={() => oncancel?.()}>Cancel</button>
  </div>
</form>
