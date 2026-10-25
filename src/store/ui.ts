import { create } from "zustand";
import { playNotificationSound } from "../lib/notificationSound";
import { useSettingsStore } from "./settings";

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
  editTrackId: number | null;
  mergeAlbumSeed: { trackIds: number[]; name: string } | null;
  createPlaylistOpen: boolean;
  equalizerOpen: boolean;
  nowPlayingOpen: boolean;
  lyricsTrackId: number | null;
  queueOpen: boolean;
  mobileNavOpen: boolean;
  notify: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
  openTrackActions: (trackId: number | null) => void;
  openAddToPlaylist: (trackId: number | null) => void;
  openEditTrack: (trackId: number | null) => void;
  openMergeAlbums: (
    seed: { trackIds: number[]; name: string } | null,
  ) => void;
  setCreatePlaylistOpen: (open: boolean) => void;
  setEqualizerOpen: (open: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  openLyrics: (trackId: number | null) => void;
  setQueueOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  trackActionsTrackId: null,
  addToPlaylistTrackId: null,
  editTrackId: null,
  mergeAlbumSeed: null,
  createPlaylistOpen: false,
  equalizerOpen: false,
  nowPlayingOpen: false,
  lyricsTrackId: null,
  queueOpen: true,
  mobileNavOpen: false,

  notify: (message, tone = "info") => {
    toastCounter += 1;
    const id = `toast-${Date.now()}-${toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, tone }],
    }));
    const settings = useSettingsStore.getState();
    playNotificationSound(settings.notificationSound, settings.notificationVolume);
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
  openEditTrack: (trackId) => set({ editTrackId: trackId }),
  openMergeAlbums: (seed) => set({ mergeAlbumSeed: seed }),
  setCreatePlaylistOpen: (open) => set({ createPlaylistOpen: open }),
  setEqualizerOpen: (open) => set({ equalizerOpen: open }),
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  openLyrics: (trackId) => set({ lyricsTrackId: trackId }),
  setQueueOpen: (open) => set({ queueOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaUi: typeof useUiStore }).__novaUi =
    useUiStore;
}
