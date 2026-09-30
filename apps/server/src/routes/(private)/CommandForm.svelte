<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Field from "$lib/components/ui/field";
  import { Input } from "$lib/components/ui/input";
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
  <Field.Group>
    <div class="grid grid-cols-2 gap-2">
      <Field.Field>
        <Field.Label for="command-label">Label</Field.Label>
        <Input id="command-label" bind:value={label} placeholder="e.g. Run Bash" />
      </Field.Field>
      <Field.Field>
        <Field.Label for="command-args">Command line</Field.Label>
        <Input
          id="command-args"
          bind:value={args}
          class="font-mono"
          placeholder={'ssh user@host -t "tmux attach"'}
          required
        />
      </Field.Field>
    </div>
    <div class="flex justify-end gap-2">
      <Button size="sm" type="submit" disabled={saving}>
        {saving ? "Saving..." : submitLabel}
      </Button>
      <Button size="sm" variant="outline" type="button" onclick={() => oncancel?.()}>Cancel</Button>
    </div>
  </Field.Group>
</form>
