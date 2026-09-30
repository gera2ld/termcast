import { nanoid } from "nanoid";
import { getContext, setContext } from "svelte";
import type { IToast } from "./types";

const stateKey = Symbol("ToastState");

const TOAST_TTL = 6000;

export class ToastState {
  static set() {
    return setContext(stateKey, new ToastState());
  }

  static get(): ToastState {
    return getContext<ToastState>(stateKey)!;
  }

  toasts = $state<IToast[]>([]);

  show(text: string, kind: IToast["kind"]) {
    const id = nanoid();
    this.toasts = [...this.toasts, { id, text, kind }];
    // Errors carry detail worth reading, so they stay until dismissed.
    if (kind === "info") setTimeout(() => this.dismiss(id), TOAST_TTL);
    return id;
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }
}
