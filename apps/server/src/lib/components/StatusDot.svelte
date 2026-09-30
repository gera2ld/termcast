<script lang="ts">
  import { statusInfo } from "$lib/util";
  import type { TtyStatus } from "$lib/types";

  let { status, wsConnected = true }: { status: TtyStatus; wsConnected?: boolean } = $props();

  const info = $derived(statusInfo[status]);
</script>

<span
  class={`inline-block h-2.5 w-2.5 rounded-full ${info.dot} ${!wsConnected ? "opacity-30" : ""}`}
  title={info.label}
  aria-label={info.label}
  role="status"
></span>
