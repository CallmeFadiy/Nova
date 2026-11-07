import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "../lib/audio";
import { shuffleArray } from "../lib/format";
import { isAndroid } from "../lib/platform";
import { audioUrl } from "../lib/tauri";
import type { NativeAudioItem, RepeatMode, Track } from "../types";
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

function nativeQueue(
  order: number[],
  startId: number | null,
): { items: NativeAudioItem[]; startIndex: number } {
  const tracks = useLibraryStore.getState().tracks;
  const items = order
    .map((id) => tracks.find((track) => track.id === id))
    .filter((track): track is Track => Boolean(track))
    .map((track) => ({
      id: track.id,
      uri: track.path,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkPath: track.customCoverPath ?? track.coverPath,
      durationMs: track.durationMs,
    }));
  const found = items.findIndex((item) => item.id === startId);
  return { items, startIndex: found >= 0 ? found : 0 };
}

function syncNativeQueue(
  state: {
    order: number[];
    currentId: number | null;
    positionMs: number;
    isPlaying: boolean;
    repeat: RepeatMode;
  },
): void {
  if (!isAndroid) return;
  const native = nativeQueue(state.order, state.currentId);
  if (native.items.length === 0) return;
  void audioEngine.setQueue(
    native.items,
    native.startIndex,
    state.positionMs,
    state.isPlaying,
    state.repeat,
  );
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
  removeTracks: (trackIds: number[]) => void;
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
        const alphabetical = [...tracks].sort((a, b) =>
          a.title.localeCompare(b.title, "ru"),
        );
        let currentId = state.currentId;
        if (currentId === null || !tracks.some((track) => track.id === currentId)) {
          currentId = alphabetical[0]?.id ?? null;
        }

        let queue = state.queue.filter((id) => tracks.some((track) => track.id === id));
        if (queue.length === 0) queue = alphabetical.map((track) => track.id);

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
          syncNativeQueue({
            order,
            currentId,
            positionMs: saved,
            isPlaying: false,
            repeat: state.repeat,
          });
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
        const state = get();
        syncNativeQueue({
          order: state.order,
          currentId: trackId,
          positionMs,
          isPlaying: autoplay,
          repeat: state.repeat,
        });
        audioEngine.setVolume(state.volume);
        audioEngine.setMuted(state.muted);
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
          if (state.durationMs > 0 && state.positionMs >= state.durationMs - 200) {
            audioEngine.seek(0);
            set({ positionMs: 0 });
            persistPosition(0);
          }
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
        const state = get();
        syncNativeQueue({
          order: state.order,
          currentId: state.currentId,
          positionMs: state.positionMs,
          isPlaying: state.isPlaying,
          repeat: state.repeat,
        });
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
        const state = get();
        syncNativeQueue({
          order,
          currentId,
          positionMs: state.positionMs,
          isPlaying: state.isPlaying,
          repeat: state.repeat,
        });
      },

      cycleRepeat: () => {
        const current = get().repeat;
        const next: RepeatMode =
          current === "off" ? "all" : current === "all" ? "one" : "off";
        set({ repeat: next });
        audioEngine.setNativeRepeat(next);
      },

      playFromOrder: (index) => {
        const id = get().order[index];
        if (id !== undefined) get().playTrackById(id, true, 0);
      },

      removeTracks: (trackIds) => {
        const removed = new Set(trackIds);
        const state = get();
        if (!state.queue.some((id) => removed.has(id))) return;

        const queue = state.queue.filter((id) => !removed.has(id));
        if (queue.length === 0) {
          get().clearQueue();
          return;
        }

        const filteredOrder = state.order.filter((id) => queue.includes(id));
        const order = filteredOrder.length > 0 ? filteredOrder : [...queue];
        const currentRemoved =
          state.currentId !== null && removed.has(state.currentId);

        if (currentRemoved) {
          const currentIndex =
            state.currentId !== null
              ? state.order.indexOf(state.currentId)
              : -1;
          const nextId =
            state.order
              .slice(Math.max(0, currentIndex + 1))
              .find((id) => queue.includes(id)) ??
            order[0] ??
            queue[0] ??
            null;
          const nextTrack = findTrack(nextId);
          if (nextId === null || !nextTrack) {
            get().clearQueue();
            return;
          }

          set({
            queue,
            order,
            currentId: nextId,
            positionMs: 0,
            durationMs: nextTrack.durationMs,
            isPlaying: state.isPlaying,
          });
          persistPosition(0);
          syncNativeQueue({
            order,
            currentId: nextId,
            positionMs: 0,
            isPlaying: state.isPlaying,
            repeat: state.repeat,
          });
          audioEngine.setVolume(state.volume);
          audioEngine.setMuted(state.muted);
          void audioEngine.load(
            audioUrl(nextTrack),
            state.isPlaying,
            0,
            nextTrack.durationMs,
          );
          return;
        }

        set({ queue, order });
        const nextState = get();
        syncNativeQueue({
          order,
          currentId: nextState.currentId,
          positionMs: nextState.positionMs,
          isPlaying: nextState.isPlaying,
          repeat: nextState.repeat,
        });
      },

      clearQueue: () => {
        audioEngine.unload();
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

audioEngine.onNativeTrackChange = (index) => {
  const state = usePlayerStore.getState();
  const id = state.order[index];
  if (id === undefined) return;
  const track = findTrack(id);
  usePlayerStore.setState({
    currentId: id,
    positionMs: 0,
    durationMs: track?.durationMs ?? 0,
  });
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
