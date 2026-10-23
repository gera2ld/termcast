<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "#lib/components/ui/card/index.js";

  let { onSetup }: { onSetup?: () => void } = $props();
</script>

<Card class="border-destructive/40">
  <CardHeader>
    <CardTitle class="text-destructive">Danger zone</CardTitle>
    <CardDescription>
      Resetting reconfigures TermCast from the setup screen. Your registered passkeys are bound to
      the current rpId and will need to be re-registered if you change it. Commands and other
      settings are kept.
    </CardDescription>
  </CardHeader>
  <CardContent class="flex justify-end">
    <Button
      variant="outline"
      class="border-destructive text-destructive hover:bg-destructive/10"
      onclick={() => onSetup?.()}
    >
      Reset rpId
    </Button>
  </CardContent>
</Card>
