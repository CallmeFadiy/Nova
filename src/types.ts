export interface Track {
  id: number;
  path: string;
  folderId: number | null;
  filename: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  durationMs: number;
  trackNo: number | null;
  year: number | null;
  genre: string | null;
  coverPath: string | null;
  customCoverPath: string | null;
  format: string;
  size: number;
  addedAt: number;
  favorite: boolean;
  hidden: boolean;
  missing: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  trackIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: number;
  path: string;
  recursive: boolean;
  addedAt: number;
  lastScanAt: number | null;
}

export interface Snapshot {
  tracks: Track[];
  playlists: Playlist[];
  folders: Folder[];
}

export interface ScanResult {
  added: number;
  updated: number;
  missing: number;
  total: number;
}

export interface ScanProgress {
  current: number;
  total: number;
  path: string;
}

export type RepeatMode = "off" | "one" | "all";

export type SortMode =
  | "az"
  | "za"
  | "artist"
  | "album"
  | "newest"
  | "duration";
