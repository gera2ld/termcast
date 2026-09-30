import { createNanoEvents, type Emitter } from "nanoevents";
import type { RealtimeEvents } from "@termcast/shared";

export const bus: Emitter<RealtimeEvents> = createNanoEvents<RealtimeEvents>();
