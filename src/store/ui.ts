import { create } from "zustand";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface UiState {
  toasts: Toast[];
  trackActionsTrackId: number | null;
  addToPlaylistTrackId: number | null;
  createPlaylistOpen: boolean;
  equalizerOpen: boolean;
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  mobileNavOpen: boolean;
  notify: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
  openTrackActions: (trackId: number | null) => void;
  openAddToPlaylist: (trackId: number | null) => void;
  setCreatePlaylistOpen: (open: boolean) => void;
  setEqualizerOpen: (open: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  trackActionsTrackId: null,
  addToPlaylistTrackId: null,
  createPlaylistOpen: false,
  equalizerOpen: false,
  nowPlayingOpen: false,
  queueOpen: true,
  mobileNavOpen: false,

  notify: (message, tone = "info") => {
    toastCounter += 1;
    const id = `toast-${Date.now()}-${toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, tone }],
    }));
    window.setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((toast) => toast.id !== id),
      }));
    }, 4200);
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),

  openTrackActions: (trackId) => set({ trackActionsTrackId: trackId }),
  openAddToPlaylist: (trackId) => set({ addToPlaylistTrackId: trackId }),
  setCreatePlaylistOpen: (open) => set({ createPlaylistOpen: open }),
  setEqualizerOpen: (open) => set({ equalizerOpen: open }),
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setQueueOpen: (open) => set({ queueOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
