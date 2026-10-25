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
  groupKeyOverride: string | null;
  groupNameOverride: string | null;
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

export type RecognitionInput = "microphone" | "system";

export type NotificationSound = "off" | "soft" | "glass" | "low" | "pop";

export type Theme = "nocturne" | "ice" | "fire" | "ash" | "cyberpunk";

export interface RecognitionLevel {
  level: number;
  peak: number;
  source: string;
}

export type RepeatMode = "off" | "one" | "all";

export type SortMode =
  | "az"
  | "za"
  | "artist"
  | "album"
  | "newest"
  | "duration";

export interface MediaCandidate {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  artworkUrl: string | null;
  source: string;
  webpageUrl: string;
  previewUrl: string | null;
  downloadUrl: string | null;
  query: string;
  quality: string;
  bitrate: number;
}

export interface ImportTrack {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  sourceUrl: string;
  previewUrl: string | null;
  downloadUrl: string | null;
  query: string;
}

export interface ImportPlaylist {
  title: string;
  source: string;
  tracks: ImportTrack[];
}

export interface DownloadProgress {
  id: string;
  percent: number;
  line: string;
  status: "downloading" | "done" | "error" | "starting";
  path: string | null;
  error: string | null;
}

export interface DownloadResult {
  path: string;
  title: string;
  directory: string;
}

export interface DeleteTracksResult {
  deleted: number;
  failed: string[];
  snapshot: Snapshot;
}

export interface TrackHash {
  trackId: number;
  hash: string;
}

export interface RecognitionResult {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  sourceUrl: string | null;
  query: string;
  provider: string;
}

export interface LyricsResult {
  trackId: number;
  title: string;
  artist: string;
  fileName: string;
  path: string;
  text: string;
  sourceUrl: string | null;
  cached: boolean;
}

export interface LyricsFile {
  fileName: string;
  title: string;
  path: string;
  size: number;
  modified: number;
}
