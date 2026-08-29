import { createNanoEvents, type Emitter } from "nanoevents";
import type { RealtimeEvents } from "@termcast/shared";

/**
 * Internal, in-process event bus. State mutations emit here; `realtime.ts` subscribes once and
 * fans the changes out to every connected dashboard socket. Keeping this separate from the socket
 * layer means emit sites (router, tab registry, pty) never import the transport.
 */
export const bus: Emitter<RealtimeEvents> = createNanoEvents<RealtimeEvents>();
