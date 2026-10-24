import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "../lib/audio";
import { shuffleArray } from "../lib/format";
import { audioUrl } from "../lib/tauri";
import type { RepeatMode, Track } from "../types";
import { useLibraryStore, visibleTracks } from "./library";

const POSITION_KEY = "nova.position";
let lastPositionSave = 0;

function persistPosition(positionMs: number): void {
  try {
    window.localStorage.setItem(POSITION_KEY, String(Math.max(0, Math.floor(positionMs))));
  } catch {
    // ignore storage errors
  }
}

function readPosition(): number {
  try {
    return Number(window.localStorage.getItem(POSITION_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function findTrack(id: number | null): Track | null {
  if (id === null) return null;
  return useLibraryStore.getState().tracks.find((track) => track.id === id) ?? null;
}

interface PlayerState {
  queue: number[];
  order: number[];
  currentId: number | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  sourceLabel: string;
  hydrate: () => void;
  setContext: (
    trackIds: number[],
    startId: number | null,
    label: string,
    autoplay?: boolean,
  ) => void;
  playTrackById: (trackId: number, autoplay?: boolean, positionMs?: number) => void;
  togglePlay: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (positionMs: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  reshuffle: () => void;
  cycleRepeat: () => void;
  playFromOrder: (index: number) => void;
  clearQueue: () => void;
  handleEnded: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      currentId: null,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      volume: 0.78,
      muted: false,
      shuffle: false,
      repeat: "off",
      sourceLabel: "Библиотека",

      hydrate: () => {
        const tracks = visibleTracks(useLibraryStore.getState().tracks);
        if (tracks.length === 0) {
          set({ currentId: null, queue: [], order: [], isPlaying: false });
          return;
        }

        const state = get();
        let currentId = state.currentId;
        if (currentId === null || !tracks.some((track) => track.id === currentId)) {
          const sorted = [...tracks].sort((a, b) => b.addedAt - a.addedAt);
          currentId = sorted[0]?.id ?? null;
        }

        let queue = state.queue.filter((id) => tracks.some((track) => track.id === id));
        if (queue.length === 0) queue = tracks.map((track) => track.id);

        let order = state.order.filter((id) => queue.includes(id));
        if (order.length === 0) order = [...queue];
        if (currentId !== null && !order.includes(currentId)) {
          order = [currentId, ...order];
        }

        const track = findTrack(currentId);
        const saved = Math.min(readPosition(), Math.max(0, (track?.durationMs ?? 0) - 500));
        set({
          queue,
          order,
          currentId,
          positionMs: saved,
          durationMs: track?.durationMs ?? 0,
          isPlaying: false,
        });
        if (currentId !== null) {
          void audioEngine.load(
            track ? audioUrl(track) : "",
            false,
            saved,
            track?.durationMs ?? 0,
          );
          audioEngine.setVolume(state.volume);
          audioEngine.setMuted(state.muted);
        }
      },

      setContext: (trackIds, startId, label, autoplay = true) => {
        const allTracks = useLibraryStore.getState().tracks;
        const unique = [...new Set(trackIds)].filter((id) =>
          allTracks.some((track) => track.id === id && !track.missing),
        );
        if (unique.length === 0) return;

        const start =
          startId !== null && unique.includes(startId) ? startId : unique[0];
        const order = get().shuffle
          ? [start, ...shuffleArray(unique.filter((id) => id !== start))]
          : [...unique];

        set({
          queue: unique,
          order,
          currentId: start,
          sourceLabel: label,
          positionMs: 0,
          durationMs: findTrack(start)?.durationMs ?? 0,
          isPlaying: false,
        });
        persistPosition(0);
        get().playTrackById(start, autoplay, 0);
      },

      playTrackById: (trackId, autoplay = true, positionMs = 0) => {
        const track = findTrack(trackId);
        if (!track) return;
        set({
          currentId: trackId,
          positionMs,
          durationMs: track.durationMs,
        });
        audioEngine.setVolume(get().volume);
        audioEngine.setMuted(get().muted);
        void audioEngine.load(
          audioUrl(track),
          autoplay,
          positionMs,
          track.durationMs,
        );
      },

      togglePlay: () => {
        const state = get();
        if (state.currentId === null) {
          const tracks = visibleTracks(useLibraryStore.getState().tracks);
          if (tracks.length === 0) return;
          const sorted = [...tracks].sort((a, b) => b.addedAt - a.addedAt);
          state.setContext(
            sorted.map((track) => track.id),
            sorted[0].id,
            "Библиотека",
            true,
          );
          return;
        }
        if (state.isPlaying) {
          audioEngine.pause();
          persistPosition(state.positionMs);
        } else {
          void audioEngine.play();
        }
      },

      next: (auto = false) => {
        const { order, currentId, repeat } = get();
        if (currentId === null || order.length === 0) return;
        if (repeat === "one" && auto) {
          get().seek(0);
          void audioEngine.play();
          return;
        }
        const index = order.indexOf(currentId);
        let nextIndex = index + 1;
        if (nextIndex >= order.length) {
          if (repeat === "all") {
            nextIndex = 0;
          } else if (auto) {
            audioEngine.pause();
            persistPosition(0);
            set({ positionMs: 0, isPlaying: false });
            return;
          } else {
            return;
          }
        }
        const nextId = order[nextIndex];
        if (nextId !== undefined) get().playTrackById(nextId, true, 0);
      },

      prev: () => {
        const { order, currentId, repeat, positionMs } = get();
        if (currentId === null || order.length === 0) return;
        if (positionMs > 3000) {
          get().seek(0);
          return;
        }
        const index = order.indexOf(currentId);
        let prevIndex = index - 1;
        if (prevIndex < 0) {
          if (repeat === "all") {
            prevIndex = order.length - 1;
          } else {
            get().seek(0);
            return;
          }
        }
        const prevId = order[prevIndex];
        if (prevId !== undefined) get().playTrackById(prevId, true, 0);
      },

      seek: (positionMs) => {
        const nextPosition = Math.max(0, positionMs);
        audioEngine.seek(nextPosition);
        set({ positionMs: nextPosition });
        persistPosition(nextPosition);
      },

      setVolume: (value) => {
        const volume = Math.max(0, Math.min(1, value));
        audioEngine.setVolume(volume);
        if (volume > 0 && get().muted) {
          audioEngine.setMuted(false);
          set({ volume, muted: false });
          return;
        }
        set({ volume });
      },

      toggleMute: () => {
        const muted = !get().muted;
        audioEngine.setMuted(muted);
        set({ muted });
      },

      toggleShuffle: () => {
        const { shuffle, currentId, queue } = get();
        if (!shuffle) {
          const others = currentId
            ? queue.filter((id) => id !== currentId)
            : [...queue];
          const order = currentId
            ? [currentId, ...shuffleArray(others)]
            : shuffleArray(queue);
          set({ shuffle: true, order });
        } else {
          set({ shuffle: false, order: [...queue] });
        }
      },

      reshuffle: () => {
        const { currentId, queue } = get();
        if (queue.length === 0) return;
        const others = currentId
          ? queue.filter((id) => id !== currentId)
          : [...queue];
        const order = currentId
          ? [currentId, ...shuffleArray(others)]
          : shuffleArray(queue);
        set({ shuffle: true, order });
      },

      cycleRepeat: () => {
        const current = get().repeat;
        const next: RepeatMode =
          current === "off" ? "all" : current === "all" ? "one" : "off";
        set({ repeat: next });
      },

      playFromOrder: (index) => {
        const id = get().order[index];
        if (id !== undefined) get().playTrackById(id, true, 0);
      },

      clearQueue: () => {
        audioEngine.pause();
        set({
          queue: [],
          order: [],
          currentId: null,
          isPlaying: false,
          positionMs: 0,
          durationMs: 0,
        });
      },

      handleEnded: () => {
        if (get().repeat === "one") {
          get().seek(0);
          void audioEngine.play();
          return;
        }
        get().next(true);
      },
    }),
    {
      name: "nova-player",
      partialize: (state) => ({
        queue: state.queue,
        order: state.order,
        currentId: state.currentId,
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        sourceLabel: state.sourceLabel,
      }),
    },
  ),
);

audioEngine.onTime = (positionMs, durationMs) => {
  const state = usePlayerStore.getState();
  usePlayerStore.setState({
    positionMs,
    durationMs: durationMs > 0 ? durationMs : state.durationMs,
  });
  if (Date.now() - lastPositionSave > 5000) {
    lastPositionSave = Date.now();
    persistPosition(positionMs);
  }
};

audioEngine.onEnded = () => {
  usePlayerStore.getState().handleEnded();
};

audioEngine.onPlayState = (isPlaying) => {
  usePlayerStore.setState({ isPlaying });
  if (!isPlaying) {
    persistPosition(usePlayerStore.getState().positionMs);
  }
};

export function useCurrentTrack(): Track | null {
  const currentId = usePlayerStore((state) => state.currentId);
  const tracks = useLibraryStore((state) => state.tracks);
  return tracks.find((track) => track.id === currentId) ?? null;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaPlayer: typeof usePlayerStore }).__novaPlayer =
    usePlayerStore;
}
