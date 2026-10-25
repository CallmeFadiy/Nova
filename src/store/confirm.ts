import { create } from "zustand";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface ConfirmState {
  request: ConfirmOptions | null;
  resolver: ((result: boolean) => void) | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  settle: (result: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  resolver: null,

  confirm: (options) => {
    get().resolver?.(false);
    return new Promise<boolean>((resolve) => {
      set({ request: options, resolver: resolve });
    });
  },

  settle: (result) => {
    const resolver = get().resolver;
    set({ request: null, resolver: null });
    resolver?.(result);
  },
}));
