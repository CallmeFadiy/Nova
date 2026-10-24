import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  Folder,
  Playlist,
  ScanProgress,
  ScanResult,
  Snapshot,
  Track,
} from "../types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const now = Math.floor(Date.now() / 1000);

const demo: Snapshot = {
  folders: [
    {
      id: 1,
      path: "C:\\Users\\keytom\\Another\\GnH\\Music",
      recursive: true,
      addedAt: now - 86400,
      lastScanAt: now - 3600,
    },
  ],
  tracks: [
    {
      id: 1,
      path: "C:\\Users\\keytom\\Another\\GnH\\Music\\Norma Tale - Ван Хельсинг.mp3",
      folderId: 1,
      filename: "Norma Tale - Ван Хельсинг.mp3",
      title: "Ван Хельсинг",
      artist: "Norma Tale",
      album: "Ван Хельсинг",
      albumArtist: "Norma Tale",
      durationMs: 221000,
      trackNo: null,
      year: 2024,
      genre: null,
      coverPath: null,
      customCoverPath: null,
      format: "MP3",
      size: 6282487,
      addedAt: now - 1200,
      favorite: true,
      hidden: false,
      missing: false,
    },
    {
      id: 2,
      path: "C:\\Users\\keytom\\Another\\GnH\\Music\\Sacrothorn feat. Marie Steiner - Инкуб.mp3",
      folderId: 1,
      filename: "Sacrothorn feat. Marie Steiner - Инкуб.mp3",
      title: "Инкуб",
      artist: "Sacrothorn feat. Marie Steiner",
      album: "Инкуб",
      albumArtist: "Sacrothorn",
      durationMs: 158000,
      trackNo: null,
      year: 2024,
      genre: null,
      coverPath: null,
      customCoverPath: null,
      format: "MP3",
      size: 10256762,
      addedAt: now - 2400,
      favorite: false,
      hidden: false,
      missing: false,
    },
    {
      id: 3,
      path: "C:\\Users\\keytom\\Another\\GnH\\Music\\the_first_berserker_khazan_18. Bride of Despair I.mp3",
      folderId: 1,
      filename: "the_first_berserker_khazan_18. Bride of Despair I.mp3",
      title: "Bride of Despair I",
      artist: "the first berserker khazan",
      album: "Bride of Despair",
      albumArtist: "the first berserker khazan",
      durationMs: 257000,
      trackNo: null,
      year: 2024,
      genre: null,
      coverPath: null,
      customCoverPath: null,
      format: "MP3",
      size: 10011417,
      addedAt: now - 3600,
      favorite: true,
      hidden: false,
      missing: false,
    },
    {
      id: 4,
      path: "C:\\Users\\keytom\\Another\\GnH\\Music\\asper-x-kvadrat-dekarta-mp3.mp3",
      folderId: 1,
      filename: "asper-x-kvadrat-dekarta-mp3.mp3",
      title: "Декарта",
      artist: "asper x квадрат",
      album: "Декарта",
      albumArtist: "asper x квадрат",
      durationMs: 251000,
      trackNo: null,
      year: 2024,
      genre: null,
      coverPath: null,
      customCoverPath: null,
      format: "MP3",
      size: 8803058,
      addedAt: now - 4800,
      favorite: false,
      hidden: false,
      missing: false,
    },
  ],
  playlists: [
    {
      id: 1,
      name: "Ночная смена",
      trackIds: [1, 4, 3],
      createdAt: now - 86400,
      updatedAt: now - 3600,
    },
    {
      id: 2,
      name: "Для работы",
      trackIds: [2, 4],
      createdAt: now - 7200,
      updatedAt: now - 3600,
    },
  ],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function delay(ms = 140): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const api = {
  async bootstrap(): Promise<Snapshot> {
    if (!isTauri) {
      await delay(80);
      return clone(demo);
    }
    return call<Snapshot>("bootstrap");
  },

  async getSnapshot(): Promise<Snapshot> {
    if (!isTauri) return clone(demo);
    return call<Snapshot>("get_snapshot");
  },

  async scanLibrary(): Promise<ScanResult> {
    if (!isTauri) {
      await delay(650);
      return { added: 0, updated: 0, missing: 0, total: demo.tracks.length };
    }
    return call<ScanResult>("scan_library");
  },

  async addFolder(path: string): Promise<Snapshot> {
    if (!isTauri) {
      if (!demo.folders.some((folder) => folder.path === path)) {
        demo.folders.push({
          id: Math.max(0, ...demo.folders.map((folder) => folder.id)) + 1,
          path,
          recursive: true,
          addedAt: now,
          lastScanAt: null,
        });
      }
      return clone(demo);
    }
    return call<Snapshot>("add_folder", { path });
  },

  async removeFolder(id: number): Promise<Snapshot> {
    if (!isTauri) {
      demo.folders = demo.folders.filter((folder) => folder.id !== id);
      for (const track of demo.tracks) {
        if (track.folderId === id) track.folderId = null;
      }
      return clone(demo);
    }
    return call<Snapshot>("remove_folder", { id });
  },

  async createPlaylist(name: string): Promise<Snapshot> {
    if (!isTauri) {
      demo.playlists.push({
        id: Math.max(0, ...demo.playlists.map((playlist) => playlist.id)) + 1,
        name,
        trackIds: [],
        createdAt: now,
        updatedAt: now,
      });
      return clone(demo);
    }
    return call<Snapshot>("create_playlist", { name });
  },

  async renamePlaylist(id: number, name: string): Promise<Snapshot> {
    if (!isTauri) {
      const playlist = demo.playlists.find((item) => item.id === id);
      if (playlist) playlist.name = name;
      return clone(demo);
    }
    return call<Snapshot>("rename_playlist", { id, name });
  },

  async deletePlaylist(id: number): Promise<Snapshot> {
    if (!isTauri) {
      demo.playlists = demo.playlists.filter((playlist) => playlist.id !== id);
      return clone(demo);
    }
    return call<Snapshot>("delete_playlist", { id });
  },

  async addToPlaylist(playlistId: number, trackIds: number[]): Promise<Snapshot> {
    if (!isTauri) {
      const playlist = demo.playlists.find((item) => item.id === playlistId);
      if (playlist) {
        for (const id of trackIds) {
          if (!playlist.trackIds.includes(id)) playlist.trackIds.push(id);
        }
      }
      return clone(demo);
    }
    return call<Snapshot>("add_to_playlist", { playlistId, trackIds });
  },

  async removeFromPlaylist(playlistId: number, trackId: number): Promise<Snapshot> {
    if (!isTauri) {
      const playlist = demo.playlists.find((item) => item.id === playlistId);
      if (playlist) {
        playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
      }
      return clone(demo);
    }
    return call<Snapshot>("remove_from_playlist", { playlistId, trackId });
  },

  async reorderPlaylist(playlistId: number, trackIds: number[]): Promise<Snapshot> {
    if (!isTauri) {
      const playlist = demo.playlists.find((item) => item.id === playlistId);
      if (playlist) playlist.trackIds = [...trackIds];
      return clone(demo);
    }
    return call<Snapshot>("reorder_playlist", { playlistId, trackIds });
  },

  async toggleFavorite(trackId: number): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) track.favorite = !track.favorite;
      return clone(demo);
    }
    return call<Snapshot>("toggle_favorite", { trackId });
  },

  async hideTrack(trackId: number): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) track.hidden = true;
      return clone(demo);
    }
    return call<Snapshot>("hide_track", { trackId });
  },

  async restoreTrack(trackId: number): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) track.hidden = false;
      return clone(demo);
    }
    return call<Snapshot>("restore_track", { trackId });
  },

  async setTrackCover(trackId: number, sourcePath: string): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) track.customCoverPath = sourcePath;
      return clone(demo);
    }
    return call<Snapshot>("set_track_cover", { trackId, sourcePath });
  },

  async clearTrackCover(trackId: number): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) track.customCoverPath = null;
      return clone(demo);
    }
    return call<Snapshot>("clear_track_cover", { trackId });
  },

  async setBackground(kind: "app" | "now", sourcePath: string): Promise<string> {
    if (!isTauri) return sourcePath;
    return call<string>("set_background", { kind, sourcePath });
  },

  async clearBackground(kind: "app" | "now"): Promise<void> {
    if (!isTauri) return;
    await call<void>("clear_background", { kind });
  },
};

export function coverUrl(track: Track | null | undefined): string | null {
  if (!track) return null;
  const path = track.customCoverPath || track.coverPath;
  if (!path) return null;
  if (!isTauri) return path;
  return convertFileSrc(path);
}

export function audioUrl(track: Track): string {
  if (!isTauri) return "";
  return convertFileSrc(track.path);
}

export function backgroundUrl(path: string | null): string | null {
  if (!path) return null;
  if (!isTauri) return path;
  return convertFileSrc(path);
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const result = await open({
    directory: true,
    multiple: false,
    title: "Добавить папку с музыкой",
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function pickImage(): Promise<string | null> {
  if (!isTauri) return null;
  const result = await open({
    directory: false,
    multiple: false,
    title: "Выбрать изображение",
    filters: [
      {
        name: "Изображения",
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri) return;
  await revealItemInDir(path);
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}

export async function listenScanProgress(
  callback: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => undefined;
  return listen<ScanProgress>("scan-progress", (event) => callback(event.payload));
}

export type { Folder, Playlist, Snapshot, Track };
