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
  updateTrackMetadata: (
    trackId: number,
    data: {
      title: string;
      artist: string;
      album?: string;
      albumArtist?: string;
    },
  ) => Promise<void>;
  deleteTrack: (trackId: number, deleteFile: boolean) => Promise<void>;
  deleteTracks: (
    trackIds: number[],
    deleteFiles: boolean,
  ) => Promise<{ deleted: number; failed: string[] } | null>;
  mergeAlbums: (trackIds: number[], name: string) => Promise<void>;
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

  updateTrackMetadata: async (trackId, data) => {
    try {
      const snapshot = await api.updateTrackMetadata(trackId, data);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Название и автор обновлены", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      useUiStore.getState().notify("Не удалось изменить трек", "error");
    }
  },

  deleteTrack: async (trackId, deleteFile) => {
    try {
      const snapshot = await api.deleteTrack(trackId, deleteFile);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify(
        deleteFile
          ? "Трек удалён из Nova и с диска"
          : "Трек удалён из библиотеки Nova",
        "success",
      );
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      useUiStore.getState().notify("Не удалось удалить трек", "error");
    }
  },

  deleteTracks: async (trackIds, deleteFiles) => {
    try {
      const result = await api.deleteTracks(trackIds, deleteFiles);
      set(applySnapshot(result.snapshot));
      useUiStore.getState().notify(
        result.failed.length > 0
          ? `Удалено ${result.deleted}, не удалось ${result.failed.length}`
          : `Удалено треков: ${result.deleted}`,
        result.failed.length > 0 ? "error" : "success",
      );
      return { deleted: result.deleted, failed: result.failed };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      useUiStore.getState().notify("Не удалось удалить треки", "error");
      return null;
    }
  },

  mergeAlbums: async (trackIds, name) => {
    try {
      const snapshot = await api.mergeAlbums(trackIds, name);
      set(applySnapshot(snapshot));
      useUiStore.getState().notify("Альбомы объединены", "success");
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      useUiStore.getState().notify("Не удалось объединить альбомы", "error");
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

export interface DuplicateTrackGroup {
  key: string;
  title: string;
  artist: string;
  keep: Track;
  duplicates: Track[];
  tracks: Track[];
  contentHash: string;
  verified: boolean;
}

function buildDuplicateGroup(
  key: string,
  items: Track[],
  contentHash: string,
  verified: boolean,
): DuplicateTrackGroup {
  const ordered = [...items].sort(
    (a, b) =>
      b.size - a.size ||
      b.addedAt - a.addedAt ||
      a.path.localeCompare(b.path),
  );
  const keep = ordered[0];
  return {
    key,
    title: cleanTitle(keep.title),
    artist: cleanArtistName(keep.artist),
    keep,
    duplicates: ordered.slice(1),
    tracks: ordered,
    contentHash,
    verified,
  };
}

export function findDuplicateGroups(
  tracks: Track[],
  hashes?: Map<number, string>,
): DuplicateTrackGroup[] {
  const candidates = new Map<string, Track[]>();
  for (const track of tracks) {
    const artist = cleanArtistName(track.artist);
    const title = cleanTitle(track.title);
    if (!artist || !title) continue;
    const key = `${normalizeArtistKey(artist)}::${titleIdentity(
      track.title,
      track.artist,
    )}`;
    const existing = candidates.get(key);
    if (existing) existing.push(track);
    else candidates.set(key, [track]);
  }

  const groups: DuplicateTrackGroup[] = [];
  for (const [key, items] of candidates) {
    if (items.length < 2) continue;
    if (!hashes) {
      groups.push(buildDuplicateGroup(key, items, "", false));
      continue;
    }

    // A shared artist/title is only a hint. Split the candidate group by
    // file content so two different recordings with the same tags are never
    // offered for deletion as duplicates.
    const buckets = new Map<string, Track[]>();
    for (const track of items) {
      const hash = hashes.get(track.id) ?? `unreadable:${track.id}`;
      const existing = buckets.get(hash);
      if (existing) existing.push(track);
      else buckets.set(hash, [track]);
    }
    for (const [hash, bucket] of buckets) {
      if (bucket.length < 2) continue;
      const verified = !hash.startsWith("unreadable:");
      groups.push(buildDuplicateGroup(`${key}::${hash}`, bucket, hash, verified));
    }
  }

  return groups.sort(
    (a, b) =>
      a.artist.localeCompare(b.artist, "ru") ||
      a.title.localeCompare(b.title, "ru"),
  );
}

export interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  albums: string[];
  isCollaboration: boolean;
  year: number | null;
  coverPath: string | null;
  tracks: Track[];
  durationMs: number;
}

const SOURCE_SUFFIX =
  /\(\s*[^)]*(?:musmore|topde|sefon|muzish|drive\s*music|drivemusic|telegram|слив|zvuk|zaycev|mp3)[^)]*\)|\[\s*[^\]]*(?:musmore|topde|sefon|muzish|drive\s*music|drivemusic|telegram|слив|zvuk|zaycev|mp3)[^\]]*\]/gi;

const TRAILING_NUMBER = /\s*\(\d{1,2}\)\s*$/;

const TRANSLITERATION: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "x",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "i",
  є: "e",
  ґ: "g",
};

export function cleanArtistName(raw: string): string {
  let value = (raw || "")
    .normalize("NFKC")
    .replace(/_/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  for (let index = 0; index < 3; index += 1) {
    const next = value.replace(SOURCE_SUFFIX, " ").replace(/\s+/g, " ").trim();
    if (next === value) break;
    value = next;
  }
  value = value.replace(TRAILING_NUMBER, "").trim();

  // Some files carry "Artist - Title" in the artist tag. Keep only the artist
  // part; a real collaboration still survives because it is before the dash.
  const dash = value.split(/\s+-\s+/);
  if (dash.length > 1 && dash[0]?.trim()) {
    value = dash[0].trim();
  }
  return value.replace(/\s+/g, " ").trim();
}

export function cleanTitle(raw: string): string {
  let value = (raw || "")
    .normalize("NFKC")
    .replace(/_/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  for (let index = 0; index < 3; index += 1) {
    const next = value.replace(SOURCE_SUFFIX, " ").replace(/\s+/g, " ").trim();
    if (next === value) break;
    value = next;
  }
  return value.replace(TRAILING_NUMBER, "").replace(/\s+/g, " ").trim();
}

function titleIdentity(title: string, artist: string): string {
  let value = cleanTitle(title);
  const artistPrefix = `${cleanArtistName(artist).toLowerCase()} - `;
  if (value.toLowerCase().startsWith(artistPrefix)) {
    value = value.slice(artistPrefix.length);
  }
  value = value.replace(/\s*\(\d{4}\)\s*$/, "");
  return normalizeArtistKey(value);
}

export function findDuplicateTrack(
  tracks: Track[],
  artist: string,
  title: string,
): Track | null {
  const desiredArtist = normalizeArtistKey(cleanArtistName(artist));
  const desiredTitle = titleIdentity(title, artist);
  if (!desiredArtist || !desiredTitle) return null;
  return (
    tracks.find((track) => {
      if (track.missing) return false;
      return (
        normalizeArtistKey(cleanArtistName(track.artist)) === desiredArtist &&
        titleIdentity(track.title, track.artist) === desiredTitle
      );
    }) ?? null
  );
}

function looksLikeCollaboration(name: string): boolean {
  const padded = ` ${name.toLowerCase()} `;
  return (
    /\b(?:feat|ft|при участии|совместно|vs)\b/i.test(padded) ||
    /[&×]/.test(name) ||
    /,\s*\S/.test(name) ||
    /\s[xх]\s+\S/i.test(padded)
  );
}

export function isCollaboration(name: string): boolean {
  return looksLikeCollaboration(cleanArtistName(name));
}

export function normalizeArtistKey(name: string): string {
  const transliterated = Array.from(name.toLowerCase())
    .map((character) => TRANSLITERATION[character] ?? character)
    .join("");
  return transliterated.replace(/[^a-z0-9]+/g, "");
}

function displayPreference(name: string): number {
  let score = 0;
  if (/[a-z]/i.test(name) && /[а-яё]/i.test(name)) score += 2;
  if (name !== name.toUpperCase()) score += 1;
  if (!name.includes("_")) score += 1;
  return score;
}

interface AlbumAccumulator {
  key: string;
  counts: Map<string, number>;
  tracks: Track[];
  albums: Set<string>;
  isCollaboration: boolean;
  year: number | null;
  coverPath: string | null;
  durationMs: number;
}

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const groups = new Map<string, AlbumAccumulator>();

  for (const track of visibleTracks(tracks)) {
    const rawArtist =
      track.artist || track.albumArtist || "Неизвестный исполнитель";
    const cleanedArtist = cleanArtistName(rawArtist) || "Неизвестный исполнитель";
    const overrideKey = track.groupKeyOverride?.trim() || "";
    const overrideName = track.groupNameOverride?.trim() || "";
    const artist = overrideName || cleanedArtist;
    const collaboration = overrideKey ? false : looksLikeCollaboration(cleanedArtist);
    const normalized = normalizeArtistKey(cleanedArtist) || "unknown";
    const key =
      overrideKey || `${collaboration ? "collab" : "artist"}:${normalized}`;
    const existing = groups.get(key);

    if (existing) {
      existing.tracks.push(track);
      existing.durationMs += track.durationMs;
      existing.counts.set(artist, (existing.counts.get(artist) ?? 0) + 1);
      if (track.album) existing.albums.add(track.album);
      if (!existing.coverPath) {
        existing.coverPath = track.customCoverPath || track.coverPath;
      }
      if (existing.year === null && track.year) existing.year = track.year;
    } else {
      groups.set(key, {
        key,
        counts: new Map([[artist, 1]]),
        tracks: [track],
        albums: new Set(track.album ? [track.album] : []),
        isCollaboration: collaboration,
        year: track.year,
        coverPath: track.customCoverPath || track.coverPath,
        durationMs: track.durationMs,
      });
    }
  }

  return [...groups.values()]
    .map((group) => {
      const display =
        [...group.counts.entries()]
          .sort(
            (a, b) =>
              b[1] - a[1] ||
              displayPreference(b[0]) - displayPreference(a[0]) ||
              a[0].localeCompare(b[0], "ru"),
          )
          .map(([name]) => name)[0] ?? "Неизвестный исполнитель";
      return {
        key: group.key,
        name: display,
        artist: display,
        albums: [...group.albums],
        isCollaboration: group.isCollaboration,
        year: group.year,
        coverPath: group.coverPath,
        durationMs: group.durationMs,
        tracks: [...group.tracks].sort((a, b) => {
          const albumCompare = a.album.localeCompare(b.album, "ru");
          if (albumCompare !== 0) return albumCompare;
          const trackA = a.trackNo ?? 0;
          const trackB = b.trackNo ?? 0;
          if (trackA !== trackB) return trackA - trackB;
          return a.title.localeCompare(b.title, "ru");
        }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaLibrary: typeof useLibraryStore }).__novaLibrary =
    useLibraryStore;
}
