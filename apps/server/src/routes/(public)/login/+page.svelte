<script lang="ts">
  import { goto } from "$app/navigation";
  import { Alert, AlertDescription } from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { GlobalState } from "#lib/global.svelte.js";
  import { orpc, setToken } from "#lib/orpc-client.js";
  import { handleAuthentication, loading } from "#lib/webauthn.js";
  import { ORPCError } from "@orpc/client";
  import { toast } from "svelte-sonner";
  import { CircleAlertIcon } from "@lucide/svelte";

  const globalState = GlobalState.get();

  let tokenOpen = $state(false);
  let tokenValue = $state("");
  let tokenLoading = $state(false);
  let authError = $state<string | null>(null);

  $effect(() => {
    if (globalState.user) {
      goto("/");
    }
  });

  async function handleLogIn() {
    authError = null;
    try {
      await handleAuthentication(false);
      globalState.reloadDashboard();
    } catch (err) {
      authError =
        err instanceof ORPCError
          ? err.message || "Sign-in failed"
          : (err as Error)?.message || "Sign-in failed";
    }
  }

  async function useToken() {
    const raw = tokenValue.trim();
    if (!raw || tokenLoading) return;
    // Accept either a bare token or a full sign-in link with ?grant=.
    let value = raw;
    try {
      const url = new URL(raw);
      const g = url.searchParams.get("grant");
      if (g) value = g;
    } catch {
      // Not a URL — treat the raw value as the token itself.
    }
    tokenLoading = true;
    try {
      const { token } = await orpc.auth.token({ grant: value });
      setToken(token);
      await globalState.reloadDashboard();
      tokenOpen = false;
    } catch (err) {
      const msg = err instanceof ORPCError ? "Invalid or expired token" : (err as Error).message;
      toast.error(`Sign-in failed: ${msg}`);
    } finally {
      tokenLoading = false;
    }
  }
</script>

<div class="mt-32 flex flex-col items-center gap-4 p-4">
  <div class="flex flex-col items-center gap-2">
    <Button disabled={$loading} onclick={handleLogIn}>
      {#if $loading}
        <Spinner />
        Verifying...
      {:else}
        Verify Passkey
      {/if}
    </Button>

    <Button variant="ghost" size="sm" onclick={() => (tokenOpen = true)}>
      Use a one-time token
    </Button>

    {#if authError}
      <Alert variant="destructive" class="max-w-sm">
        <CircleAlertIcon />
        <AlertDescription>{authError}</AlertDescription>
      </Alert>
    {/if}
  </div>
</div>

<Dialog.Root bind:open={tokenOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Sign in with a one-time token</Dialog.Title>
      <Dialog.Description>
        Run <code>termcast grant</code> on the server to get a one-time sign-in link or token. Paste it
        below.
      </Dialog.Description>
    </Dialog.Header>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        useToken();
      }}
    >
      <Field.Group>
        <Field.Field>
          <Field.Label for="login-token" class="sr-only">One-time token or sign-in link</Field.Label
          >
          <Input
            id="login-token"
            bind:value={tokenValue}
            placeholder="One-time token or sign-in link"
            required
          />
        </Field.Field>
        <div class="flex justify-end gap-2">
          <Button variant="outline" type="button" onclick={() => (tokenOpen = false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={tokenLoading}>
            {#if tokenLoading}
              <Spinner />
              Signing in...
            {:else}
              Sign in
            {/if}
          </Button>
        </div>
      </Field.Group>
    </form>
  </Dialog.Content>
</Dialog.Root>
