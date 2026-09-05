import type { Settings } from "./schemas";

// Editable settings - all fields are optional for partial updates
// These are the fields that can be updated via the API
export type EditableSettings = Partial<
  Pick<
    Settings,
    | "rpName"
    | "displayName"
    | "username"
    | "expectedOrigins"
    | "webhookTermStarted"
    | "terminalTheme"
  >
>;
