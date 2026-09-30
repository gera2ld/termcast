<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import * as Field from "$lib/components/ui/field";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Switch } from "$lib/components/ui/switch";
  import { GlobalState } from "$lib/global.svelte";
  import { toast } from "svelte-sonner";
  import { DownloadIcon, InfoIcon } from "@lucide/svelte";

  const globalState = GlobalState.get();
  const tunnel = $derived(
    globalState.tunnel ?? {
      enabled: false,
      url: undefined,
      error: undefined,
      resolved: false,
      binaryPath: undefined,
    },
  );

  let downloading = $state(false);

  onMount(() => {
    void globalState.loadTunnel();
  });
</script>

<Card>
  <CardHeader>
    <CardTitle>Cloudflared Tunnel</CardTitle>
    <CardDescription>
      Share sessions publicly via a cloudflared quick tunnel. Enable this to get a public URL
      (trycloudflare.com) that anyone can use to join a shared session.
    </CardDescription>
  </CardHeader>
  <CardContent class="flex flex-col gap-4">
    {#if !tunnel.resolved}
      <Alert class="border-chart-3/40 text-chart-3">
        <InfoIcon />
        <AlertDescription>
          Cloudflared binary not found. Download it first to enable tunneling.
        </AlertDescription>
      </Alert>
    {/if}

    <div class="flex items-center gap-4">
      <Button
        variant="outline"
        disabled={downloading || tunnel.resolved}
        onclick={async () => {
          downloading = true;
          try {
            await globalState.resolveCloudflared();
            await globalState.loadTunnel();
            toast.info("Cloudflared downloaded successfully.");
          } catch (err) {
            toast.error(`Failed to download cloudflared: ${(err as Error).message}`);
          } finally {
            downloading = false;
          }
        }}
      >
        {#if downloading}
          <Spinner />
          Downloading...
        {:else}
          <DownloadIcon />
          Download cloudflared
        {/if}
      </Button>
      {#if tunnel.resolved}
        <span class="text-chart-1 text-sm">Binary ready</span>
      {:else}
        <span class="text-sm">Not installed</span>
      {/if}
    </div>

    {#if tunnel.binaryPath}
      <div class="text-muted-foreground text-sm">
        Path: <code class="text-xs">{tunnel.binaryPath}</code>
      </div>
    {/if}

    <Field.Field orientation="horizontal" class="w-fit gap-4">
      <Switch
        id="tunnel-enabled"
        checked={tunnel.enabled}
        disabled={!tunnel.resolved}
        onCheckedChange={(checked) =>
          checked ? globalState.enableTunnel() : globalState.disableTunnel()}
      />
      <Field.Label for="tunnel-enabled" class="font-normal">
        {tunnel.enabled ? "Enabled" : "Disabled"}
      </Field.Label>
    </Field.Field>

    {#if tunnel.url}
      <div class="text-sm">
        <span class="text-muted-foreground">Public URL:</span>
        <Button variant="link" size="sm" href={tunnel.url} target="_blank" class="h-auto p-0">
          {tunnel.url}
        </Button>
      </div>
    {/if}
    {#if tunnel.error}
      <div class="text-destructive text-sm">{tunnel.error}</div>
    {/if}
  </CardContent>
</Card>
