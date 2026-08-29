<script lang="ts">
  let { onSetup }: { onSetup?: () => void } = $props();
</script>

<div class="card border-error/40 bg-base-200 shadow-md">
  <div class="card-body">
    <h2 class="card-title text-error">Danger zone</h2>
    <p class="text-sm opacity-70">
      Resetting reconfigures TermCast from the setup screen. Your registered passkeys are bound to
      the current rpId and will need to be re-registered if you change it. Commands and other
      settings are kept.
    </p>
    <div class="flex justify-end">
      <button class="btn btn-error btn-outline" onclick={() => onSetup?.()}> Reset rpId </button>
    </div>
  </div>
</div>
