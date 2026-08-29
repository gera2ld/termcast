<script lang="ts">
  import { GlobalState } from "$lib/global.svelte";
  import Commands from "./Commands.svelte";
  import DangerZone from "./DangerZone.svelte";
  import Devices from "./Devices.svelte";
  import Settings from "./Settings.svelte";
  import SetupDialog from "./SetupDialog.svelte";

  const globalState = GlobalState.get();
  const needsSetup = $derived(globalState.user?.needsSetup);

  let setupOpen = $state(false);
  let setupMode = $state<"setup" | "reset">("setup");
</script>

{#if needsSetup}
  <div class="p-4">
    <div class="alert alert-warning flex items-center justify-between gap-2 text-sm">
      <span>TermCast isn't set up yet — configure your rpId to finish setup.</span>
      <button
        class="btn btn-sm btn-primary"
        onclick={() => {
          setupMode = "setup";
          setupOpen = true;
        }}
      >
        Set up
      </button>
    </div>
  </div>
{/if}

<div class="grid gap-8 p-4 lg:grid-cols-2">
  <section>
    <Commands />
  </section>
  {#if !needsSetup}
    <section>
      <Devices />
    </section>
    <section>
      <Settings />
    </section>
    <section>
      <DangerZone
        onSetup={() => {
          setupMode = "reset";
          setupOpen = true;
        }}
      />
    </section>
  {/if}
</div>

<SetupDialog bind:open={setupOpen} mode={setupMode} onsaved={() => (setupOpen = false)} />
