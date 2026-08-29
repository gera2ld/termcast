<script lang="ts">
  import { goto } from "$app/navigation";
  import { orpc, setToken } from "$lib/orpc-client";
  import { ToastState } from "$lib/toasts.svelte";
  import { handleAuthentication, loading } from "$lib/webauthn";
  import { GlobalState } from "@/lib/global.svelte";
  import { ORPCError } from "@orpc/client";

  const globalState = GlobalState.get();
  const toastState = ToastState.get();

  let tokenOpen = $state(false);
  let tokenDialog: HTMLDialogElement | undefined = $state();
  let tokenValue = $state("");
  let tokenLoading = $state(false);

  $effect(() => {
    if (globalState.user) {
      goto("/");
    }
  });

  $effect(() => {
    if (tokenOpen && tokenDialog && !tokenDialog.open) tokenDialog.showModal();
    else if (!tokenOpen && tokenDialog?.open) tokenDialog.close();
  });

  async function handleLogIn() {
    await handleAuthentication(false);
    globalState.reloadDashboard();
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
      toastState.show(`Sign-in failed: ${msg}`, "error");
    } finally {
      tokenLoading = false;
    }
  }
</script>

<div class="mt-32 flex flex-col items-center gap-4 p-4">
  <div class="flex flex-col items-center gap-2">
    <button class="btn btn-primary" disabled={$loading} onclick={handleLogIn}>
      {#if $loading}
        <span class="loading loading-spinner loading-sm"></span>
        Verifying...
      {:else}
        Verify Passkey
      {/if}
    </button>

    <button class="btn btn-ghost btn-sm" onclick={() => (tokenOpen = true)}>
      Use a one-time token
    </button>
  </div>
</div>

<dialog class="modal" bind:this={tokenDialog}>
  <div class="modal-box">
    <h3 class="text-lg font-medium">Sign in with a one-time token</h3>
    <p class="mt-2 text-sm opacity-70">
      Run <code>termcast grant</code> on the server to get a one-time sign-in link or token. Paste it
      below.
    </p>
    <form
      class="mt-4 flex flex-col gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        useToken();
      }}
    >
      <input
        class="input input-bordered w-full"
        bind:value={tokenValue}
        placeholder="One-time token or sign-in link"
        required
      />
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost" type="button" onclick={() => (tokenOpen = false)}>
          Cancel
        </button>
        <button class="btn btn-primary" type="submit" disabled={tokenLoading}>
          {#if tokenLoading}
            <span class="loading loading-spinner loading-sm"></span>
            Signing in...
          {:else}
            Sign in
          {/if}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
