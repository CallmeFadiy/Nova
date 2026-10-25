import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  DeleteTracksResult,
  DownloadProgress,
  DownloadResult,
  Folder,
  ImportPlaylist,
  LyricsFile,
  LyricsResult,
  MediaCandidate,
  Playlist,
  RecognitionInput,
  RecognitionLevel,
  RecognitionResult,
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
      groupKeyOverride: null,
      groupNameOverride: null,
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
      groupKeyOverride: null,
      groupNameOverride: null,
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
      groupKeyOverride: null,
      groupNameOverride: null,
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
      groupKeyOverride: null,
      groupNameOverride: null,
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

  async updateTrackMetadata(
    trackId: number,
    data: {
      title: string;
      artist: string;
      album?: string;
      albumArtist?: string;
    },
  ): Promise<Snapshot> {
    if (!isTauri) {
      const track = demo.tracks.find((item) => item.id === trackId);
      if (track) {
        track.title = data.title;
        track.artist = data.artist;
        track.album = data.album ?? track.album;
        track.albumArtist = data.albumArtist ?? track.albumArtist;
      }
      return clone(demo);
    }
    return call<Snapshot>("update_track_metadata", {
      trackId,
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      albumArtist: data.albumArtist ?? null,
    });
  },

  async deleteTrack(trackId: number, deleteFile: boolean): Promise<Snapshot> {
    if (!isTauri) {
      demo.tracks = demo.tracks.filter((track) => track.id !== trackId);
      for (const playlist of demo.playlists) {
        playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
      }
      return clone(demo);
    }
    return call<Snapshot>("delete_track", { trackId, deleteFile });
  },

  async deleteTracks(
    trackIds: number[],
    deleteFiles: boolean,
  ): Promise<DeleteTracksResult> {
    if (!isTauri) {
      const removed = demo.tracks.filter((track) =>
        trackIds.includes(track.id),
      ).length;
      demo.tracks = demo.tracks.filter(
        (track) => !trackIds.includes(track.id),
      );
      for (const playlist of demo.playlists) {
        playlist.trackIds = playlist.trackIds.filter(
          (id) => !trackIds.includes(id),
        );
      }
      return {
        deleted: removed,
        failed: [],
        snapshot: clone(demo),
      };
    }
    return call<DeleteTracksResult>("delete_tracks", {
      trackIds,
      deleteFiles,
    });
  },

  async mergeAlbums(trackIds: number[], name: string): Promise<Snapshot> {
    if (!isTauri) {
      const key = `merged:${Date.now()}`;
      for (const track of demo.tracks) {
        if (trackIds.includes(track.id)) {
          track.groupKeyOverride = key;
          track.groupNameOverride = name;
        }
      }
      return clone(demo);
    }
    return call<Snapshot>("merge_albums", { trackIds, name });
  },

  async setBackground(kind: "app" | "now", sourcePath: string): Promise<string> {
    if (!isTauri) return sourcePath;
    return call<string>("set_background", { kind, sourcePath });
  },

  async clearBackground(kind: "app" | "now"): Promise<void> {
    if (!isTauri) return;
    await call<void>("clear_background", { kind });
  },

  async searchMedia(query: string, limit = 20): Promise<MediaCandidate[]> {
    if (!isTauri) {
      await delay(500);
      const needle = query.trim().toLowerCase();
      const source = needle
        ? demo.tracks.filter(
            (track) =>
              track.title.toLowerCase().includes(needle) ||
              track.artist.toLowerCase().includes(needle) ||
              track.album.toLowerCase().includes(needle),
          )
        : demo.tracks;
      return (source.length > 0 ? source : demo.tracks)
        .slice(0, limit)
        .map((track) => ({
          id: `demo-${track.id}`,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          artworkUrl: null,
          source: "Демо",
          webpageUrl: track.path,
          previewUrl: null,
          downloadUrl: null,
          query: `${track.artist} ${track.title}`,
          quality: "MP3",
          bitrate: 320,
        }));
    }
    return call<MediaCandidate[]>("search_media", { query, limit });
  },

  async resolvePlaylist(
    url: string,
    ytdlpPath?: string,
  ): Promise<ImportPlaylist> {
    if (!isTauri) {
      await delay(900);
      return {
        title: "Демо-плейлист",
        source: "Демо",
        tracks: demo.tracks.slice(0, 3).map((track) => ({
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          sourceUrl: track.path,
          previewUrl: null,
          downloadUrl: null,
          query: `${track.artist} ${track.title}`,
        })),
      };
    }
    return call<ImportPlaylist>("resolve_playlist", {
      url,
      ytdlpPath: ytdlpPath ?? null,
    });
  },

  async downloadMedia(args: {
    id: string;
    url: string;
    query?: string;
    outputDir: string;
    ytdlpPath?: string;
  }): Promise<DownloadResult> {
    if (!isTauri) {
      await delay(1400);
      return {
        path: `${args.outputDir || "Downloads"}\\${args.query || "track"}.m4a`,
        title: args.query || "Новый трек",
        directory: args.outputDir || "Downloads",
      };
    }
    return call<DownloadResult>("download_media", {
      id: args.id,
      url: args.url,
      query: args.query ?? null,
      outputDir: args.outputDir,
      ytdlpPath: args.ytdlpPath ?? null,
    });
  },

  async downloadDirect(args: {
    id: string;
    url: string;
    outputDir: string;
    fileName?: string;
  }): Promise<DownloadResult> {
    if (!isTauri) {
      await delay(800);
      return {
        path: `${args.outputDir || "Downloads"}\\${args.fileName || "preview"}.m4a`,
        title: args.fileName || "Превью",
        directory: args.outputDir || "Downloads",
      };
    }
    return call<DownloadResult>("download_direct", {
      id: args.id,
      url: args.url,
      outputDir: args.outputDir,
      fileName: args.fileName ?? null,
    });
  },

  async recognizeAudd(
    apiToken: string,
    source: RecognitionInput = "microphone",
  ): Promise<RecognitionResult> {
    if (!isTauri) {
      await delay(1600);
      return {
        title: "Ван Хельсинг",
        artist: "Norma Tale",
        album: "Ван Хельсинг",
        artworkUrl: null,
        sourceUrl: null,
        query: "Norma Tale Ван Хельсинг",
        provider: "Демо",
      };
    }
    return call<RecognitionResult>("recognize_audd", { apiToken, source });
  },

  async recognizeShazam(
    source: RecognitionInput = "microphone",
  ): Promise<RecognitionResult> {
    if (!isTauri) {
      await delay(1600);
      return {
        title: "Ван Хельсинг",
        artist: "Norma Tale",
        album: "Ван Хельсинг",
        artworkUrl: null,
        sourceUrl: null,
        query: "Norma Tale Ван Хельсинг",
        provider: "Демо",
      };
    }
    return call<RecognitionResult>("recognize_shazam", { source });
  },

  async recognizeShazamFile(path: string): Promise<RecognitionResult> {
    if (!isTauri) {
      await delay(1600);
      return {
        title: "Ван Хельсинг",
        artist: "Norma Tale",
        album: "Ван Хельсинг",
        artworkUrl: null,
        sourceUrl: null,
        query: "Norma Tale Ван Хельсинг",
        provider: "Демо-файл",
      };
    }
    return call<RecognitionResult>("recognize_shazam_file", { path });
  },

  async getLyrics(trackId: number): Promise<LyricsResult> {
    if (!isTauri) {
      await delay(500);
      return {
        trackId,
        title: "Ван Хельсинг",
        artist: "Norma Tale",
        fileName: "Norma Tale - Ван Хельсинг.txt",
        path: "demo/lyrics/Norma Tale - Ван Хельсинг.txt",
        text:
          "Это демонстрационный текст.\n\nВ приложении Nova текст загружается с Genius и сохраняется в файл с именем трека в папке данных приложения.",
        sourceUrl: "https://genius.com/",
        cached: false,
      };
    }
    return call<LyricsResult>("get_lyrics", { trackId });
  },

  async listLyrics(): Promise<LyricsFile[]> {
    if (!isTauri) return [];
    return call<LyricsFile[]>("list_lyrics");
  },

  async deleteLyrics(fileName: string): Promise<void> {
    if (!isTauri) return;
    await call<void>("delete_lyrics", { fileName });
  },

  async clearLyrics(): Promise<number> {
    if (!isTauri) return 0;
    return call<number>("clear_lyrics");
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

export async function pickFolder(
  title = "Добавить папку с музыкой",
): Promise<string | null> {
  if (!isTauri) return null;
  const result = await open({
    directory: true,
    multiple: false,
    title,
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

export async function pickAudioFile(): Promise<string | null> {
  if (!isTauri) return null;
  const result = await open({
    directory: false,
    multiple: false,
    title: "Выбрать аудиофайл для распознавания",
    filters: [
      {
        name: "Аудио",
        extensions: ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "webm"],
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

export async function listenDownloadProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => undefined;
  return listen<DownloadProgress>("download-progress", (event) =>
    callback(event.payload),
  );
}

export async function listenRecognitionLevel(
  callback: (level: RecognitionLevel) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => undefined;
  return listen<RecognitionLevel>("recognition-level", (event) =>
    callback(event.payload),
  );
}

export type { Folder, Playlist, Snapshot, Track };

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaApi: typeof api }).__novaApi = api;
}
