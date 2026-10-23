<script lang="ts">
  import { Alert, AlertDescription } from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { InfoIcon } from "@lucide/svelte";
  import Appearance from "./Appearance.svelte";
  import Commands from "./Commands.svelte";
  import DangerZone from "./DangerZone.svelte";
  import Devices from "./Devices.svelte";
  import SetupDialog from "./SetupDialog.svelte";
  import Tunnel from "./Tunnel.svelte";
  import WebAuthnSettings from "./WebAuthnSettings.svelte";

  const globalState = GlobalState.get();
  const needsSetup = $derived(globalState.user?.needsSetup);

  let setupOpen = $state(false);
  let setupMode = $state<"setup" | "reset">("setup");
</script>

{#if needsSetup}
  <div class="p-4">
    <Alert class="border-chart-3/40 text-chart-3">
      <InfoIcon />
      <AlertDescription class="flex flex-wrap items-center justify-between gap-2">
        TermCast isn't set up yet — configure your rpId to finish setup.
        <Button
          size="sm"
          onclick={() => {
            setupMode = "setup";
            setupOpen = true;
          }}
        >
          Set up
        </Button>
      </AlertDescription>
    </Alert>
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
    <section class="row-span-2">
      <WebAuthnSettings />
    </section>
    <section>
      <Appearance />
    </section>
    <section>
      <Tunnel />
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
