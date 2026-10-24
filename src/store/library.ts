import { create } from "zustand";
import { api } from "../lib/tauri";
import type { Folder, Playlist, ScanProgress, ScanResult, Snapshot, Track } from "../types";
import { useUiStore } from "./ui";

interface LibraryState {
  tracks: Track[];
  playlists: Playlist[];
  folders: Folder[];
  loading: boolean;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  lastScan: ScanResult | null;
  error: string | null;
  load: () => Promise<void>;
  scan: () => Promise<void>;
  setScanProgress: (progress: ScanProgress | null) => void;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (id: number) => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist | null>;
  renamePlaylist: (id: number, name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addToPlaylist: (playlistId: number, trackIds: number[]) => Promise<void>;
  removeFromPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  reorderPlaylist: (playlistId: number, trackIds: number[]) => Promise<void>;
  toggleFavorite: (trackId: number) => Promise<void>;
  hideTrack: (trackId: number) => Promise<void>;
  restoreTrack: (trackId: number) => Promise<void>;
  setTrackCover: (trackId: number, sourcePath: string) => Promise<void>;
  clearTrackCover: (trackId: number) => Promise<void>;
  clearError: () => void;
}

function applySnapshot(snapshot: Snapshot): Pick<LibraryState, "tracks" | "playlists" | "folders"> {
  return {
    tracks: snapshot.tracks,
    playlists: snapshot.playlists,
    folders: snapshot.folders,
  };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  playlists: [],
  folders: [],
  loading: true,
  scanning: false,
  scanProgress: null,
  lastScan: null,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await api.bootstrap();
      set({ ...applySnapshot(snapshot), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  scan: async () => {
    if (get().scanning) return;
    set({ scanning: true, error: null, scanProgress: null });
    try {
      const result = await api.scanLibrary();
      const snapshot = await api.getSnapshot();
      set({
        ...applySnapshot(snapshot),
        scanning: false,
        scanProgress: null,
        lastScan: result,
      });
      if (result.added > 0) {
        useUiStore.getState().notify(
          `Добавлено ${result.added} новых треков`,
          "success",
        );
      } else {
        useUiStore.getState().notify("Библиотека обновлена", "success");
      }
    } catch (error) {
      set({
        scanning: false,
        scanProgress: null,
        error: error instanceof Error ? error.message : String(error),
      });
      useUiStore.getState().notify("Не удалось просканировать папки", "error");
    }
  },

  setScanProgress: (progress) => set({ scanProgress: progress }),

  addFolder: async (path) => {
    try {
      const snapshot = await api.addFolder(path);
      set(applySnapshot(snapshot));
      await get().scan();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      useUiStore.getState().notify("Не удалось добавить папку", "error");
    }
  },

  removeFolder: async (id) => {
    try {
      const snapshot = await api.removeFolder(id);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Папка убрана из библиотеки", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createPlaylist: async (name) => {
    try {
      const snapshot = await api.createPlaylist(name);
      set(applySnapshot(snapshot));
      const playlist = snapshot.playlists[snapshot.playlists.length - 1] ?? null;
      useUiStore.getState().notify("Плейлист создан", "success");
      return playlist;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  renamePlaylist: async (id, name) => {
    try {
      const snapshot = await api.renamePlaylist(id, name);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  deletePlaylist: async (id) => {
    try {
      const snapshot = await api.deletePlaylist(id);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Плейлист удалён", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  addToPlaylist: async (playlistId, trackIds) => {
    try {
      const snapshot = await api.addToPlaylist(playlistId, trackIds);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Добавлено в плейлист", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    try {
      const snapshot = await api.removeFromPlaylist(playlistId, trackId);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  reorderPlaylist: async (playlistId, trackIds) => {
    try {
      const snapshot = await api.reorderPlaylist(playlistId, trackIds);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  toggleFavorite: async (trackId) => {
    try {
      const snapshot = await api.toggleFavorite(trackId);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  hideTrack: async (trackId) => {
    try {
      const snapshot = await api.hideTrack(trackId);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify(
        "Трек скрыт из альбома. Файл остался на устройстве",
        "success",
      );
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  restoreTrack: async (trackId) => {
    try {
      const snapshot = await api.restoreTrack(trackId);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Трек возвращён в библиотеку", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  setTrackCover: async (trackId, sourcePath) => {
    try {
      const snapshot = await api.setTrackCover(trackId, sourcePath);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Обложка обновлена", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  clearTrackCover: async (trackId) => {
    try {
      const snapshot = await api.clearTrackCover(trackId);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Возвращена исходная обложка", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  clearError: () => set({ error: null }),
}));

export function visibleTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => !track.hidden && !track.missing);
}

export function favoriteTracks(tracks: Track[]): Track[] {
  return tracks.filter(
    (track) => track.favorite && !track.hidden && !track.missing,
  );
}

export interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  year: number | null;
  coverPath: string | null;
  tracks: Track[];
  durationMs: number;
}

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>();  for (const track of visibleTracks(tracks)) {
    const key = `${track.albumArtist || track.artist}::${track.album}`;
    const existing = map.get(key);
    if (existing) {
      existing.tracks.push(track);
      existing.durationMs += track.durationMs;
      if (!existing.coverPath) {
        existing.coverPath = track.customCoverPath || track.coverPath;
      }
    } else {
      map.set(key, {
        key,
        name: track.album || "Без альбома",
        artist: track.albumArtist || track.artist,
        year: track.year,
        coverPath: track.customCoverPath || track.coverPath,
        tracks: [track],
        durationMs: track.durationMs,
      });
    }
  }
  return [...map.values()]
    .map((album) => ({
      ...album,
      tracks: [...album.tracks].sort((a, b) => {
        const trackA = a.trackNo ?? 0;
        const trackB = b.trackNo ?? 0;
        if (trackA !== trackB) return trackA - trackB;
        return a.title.localeCompare(b.title, "ru");
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaLibrary: typeof useLibraryStore }).__novaLibrary =
    useLibraryStore;
}
