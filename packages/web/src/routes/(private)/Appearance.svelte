<script lang="ts">
  import { GlobalState } from "$lib/global.svelte";
  import { ToastState } from "$lib/toasts.svelte";
  import type { TerminalTheme } from "@termcast/shared";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  const theme = $derived(globalState.settings?.terminalTheme);

  const options: { value: TerminalTheme; label: string; hint: string }[] = [
    { value: "auto", label: "Auto", hint: "Follow system" },
    { value: "light", label: "Light", hint: "Tokyo Night Light" },
    { value: "dark", label: "Dark", hint: "Tokyo Night Storm" },
  ];

  let saving = $state(false);

  async function select(value: TerminalTheme) {
    if (value === theme || saving) return;
    saving = true;
    try {
      await globalState.updateSettings({ terminalTheme: value });
      toastState.show("Terminal theme saved.", "info");
    } catch (err) {
      toastState.show(`Failed to save terminal theme: ${(err as Error).message}`, "error");
    } finally {
      saving = false;
    }
  }
</script>

<div class="card bg-base-200 shadow-md">
  <div class="card-body">
    <h2 class="card-title">Appearance</h2>
    <p class="text-sm opacity-70">
      Terminal theme. Applies to the dashboard and shared session views.
    </p>

    <div class="join mt-2" role="group" aria-label="Terminal theme">
      {#each options as option (option.value)}
        <button
          type="button"
          class="btn join-item btn-sm {theme === option.value ? 'btn-active' : ''}"
          title={option.hint}
          aria-pressed={theme === option.value}
          disabled={saving}
          onclick={() => select(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
</div>
