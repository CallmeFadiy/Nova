import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Disc3,
  FolderPlus,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Cover } from "../components/Cover";
import { PlaylistMosaic } from "../components/PlaylistMosaic";
import { TrackTable } from "../components/TrackTable";
import {
  formatDate,
  formatMinutes,
  pluralRu,
  trackCountLabel,
} from "../lib/format";
import { pickFolder } from "../lib/tauri";
import {
  groupAlbums,
  useLibraryStore,
  visibleTracks,
} from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { SortMode, Track } from "../types";

type Tab = "tracks" | "albums" | "folders" | "playlists";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "az", label: "А – Я" },
  { value: "za", label: "Я – А" },
  { value: "artist", label: "По исполнителю" },
  { value: "album", label: "По альбому" },
  { value: "newest", label: "Сначала новые" },
  { value: "duration", label: "По длительности" },
];

function sortTracks(tracks: Track[], mode: SortMode): Track[] {
  const copy = [...tracks];
  switch (mode) {
    case "az":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    case "za":
      return copy.sort((a, b) => b.title.localeCompare(a.title, "ru"));
    case "artist":
      return copy.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist, "ru") ||
          a.title.localeCompare(b.title, "ru"),
      );
    case "album":
      return copy.sort(
        (a, b) =>
          a.album.localeCompare(b.album, "ru") ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0),
      );
    case "newest":
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case "duration":
      return copy.sort((a, b) => b.durationMs - a.durationMs);
    default:
      return copy;
  }
}

export function Library({ initialTab = "tracks" }: { initialTab?: Tab }) {
  const tracks = useLibraryStore((state) => state.tracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const folders = useLibraryStore((state) => state.folders);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const removeFolder = useLibraryStore((state) => state.removeFolder);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const openCreatePlaylist = useUiStore((state) => state.setCreatePlaylistOpen);
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [albumKey, setAlbumKey] = useState<string | null>(null);

  const visible = visibleTracks(tracks);
  const albums = groupAlbums(tracks);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = query
      ? visible.filter(
          (track) =>
            track.title.toLowerCase().includes(query) ||
            track.artist.toLowerCase().includes(query) ||
            track.album.toLowerCase().includes(query),
        )
      : visible;
    return sortTracks(source, sort);
  }, [visible, search, sort]);

  const selectedAlbum = albums.find((album) => album.key === albumKey) ?? null;

  const handleAddFolder = async () => {
    const path = await pickFolder();
    if (!path) {
      notify("Выбор папки доступен в приложении Nova", "info");
      return;
    }
    await addFolder(path);
  };

  const playAlbum = (albumTracks: Track[], label: string, shuffled = false) => {
    if (albumTracks.length === 0) return;
    if (shuffled && !usePlayerStore.getState().shuffle) toggleShuffle();
    setContext(
      albumTracks.map((track) => track.id),
      albumTracks[0].id,
      label,
      true,
    );
  };

  if (selectedAlbum) {
    return (
      <div className="page">
        <button className="back-button" onClick={() => setAlbumKey(null)}>
          <ChevronLeft size={16} />
          Все альбомы
        </button>

        <header className="album-detail-head">
          <Cover track={selectedAlbum.tracks[0]} className="album-detail-cover" />
          <div className="album-detail-text">
            <span className="eyebrow">Альбом</span>
            <h1 className="serif">{selectedAlbum.name}</h1>
            <p className="album-detail-artist">{selectedAlbum.artist}</p>
            <p className="page-sub">
              {trackCountLabel(selectedAlbum.tracks.length)} ·{" "}
              {formatMinutes(selectedAlbum.durationMs)}
              {selectedAlbum.year ? ` · ${selectedAlbum.year}` : ""}
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() =>
                  playAlbum(
                    selectedAlbum.tracks,
                    `Альбом «${selectedAlbum.name}»`,
                  )
                }
              >
                <Play size={15} fill="currentColor" />
                Играть
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  playAlbum(
                    selectedAlbum.tracks,
                    `Альбом «${selectedAlbum.name}»`,
                    true,
                  )
                }
              >
                <Shuffle size={15} />
                Перемешать
              </button>
            </div>
          </div>
        </header>

        <TrackTable
          tracks={selectedAlbum.tracks}
          label={`Альбом «${selectedAlbum.name}»`}
          showAlbum={false}
          showFolder={false}
          emptyTitle="В альбоме нет треков"
        />
      </div>
    );
  }

  const tabTitle =
    tab === "albums"
      ? "Альбомы"
      : tab === "folders"
        ? "Папки"
        : tab === "playlists"
          ? "Плейлисты"
          : "Библиотека";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">
            {trackCountLabel(visible.length)} · {albums.length}{" "}
            {pluralRu(albums.length, ["альбом", "альбома", "альбомов"])} ·{" "}
            {folders.length}{" "}
            {pluralRu(folders.length, ["папка", "папки", "папок"])}
          </p>
          <h1 className="serif">{tabTitle}</h1>
          <p className="page-sub">
            Локальные файлы, плейлисты и избранное в одном месте
          </p>
        </div>
        <div className="head-actions">
          <button className="primary-button" onClick={() => void handleAddFolder()}>
            <FolderPlus size={15} />
            Добавить папку
          </button>
        </div>
      </header>

      <div className="library-tabs">
        {(
          [
            ["tracks", "Треки", visible.length],
            ["albums", "Альбомы", albums.length],
            ["folders", "Папки", folders.length],
            ["playlists", "Плейлисты", playlists.length],
          ] as Array<[Tab, string, number]>
        ).map(([value, label, count]) => (
          <button
            key={value}
            className={`library-tab${tab === value ? " active" : ""}`}
            onClick={() => setTab(value)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>

      {tab === "tracks" ? (
        <>
          <div className="library-toolbar">
            <div className="search-field">
              <Search size={15} />
              <input
                placeholder="Найти трек, исполнителя или альбом"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              className="select-input"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-block">
              <h3 className="serif">Ничего не найдено</h3>
              <p>Попробуйте другой запрос или просканируйте папки.</p>
            </div>
          ) : (
            <TrackTable
              tracks={filtered}
              label="Библиотека"
              emptyTitle="Библиотека пуста"
              emptyText="Добавьте папку с музыкой."
            />
          )}
        </>
      ) : null}

      {tab === "albums" ? (
        <div className="album-grid library-album-grid">
          {albums.map((album) => (
            <button
              className="album-card"
              key={album.key}
              onClick={() => setAlbumKey(album.key)}
            >
              <span className="album-card-art">
                <Cover
                  track={album.tracks[0]}
                  className="album-card-cover"
                  label={album.name}
                />
                <span className="album-play">
                  <Play size={14} fill="currentColor" />
                </span>
              </span>
              <strong>{album.name}</strong>
              <span>
                {album.artist} · {trackCountLabel(album.tracks.length)}
              </span>
            </button>
          ))}
          {albums.length === 0 ? (
            <div className="empty-block">
              <h3 className="serif">Альбомов пока нет</h3>
              <p>Они появятся, когда в библиотеке будут треки.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "folders" ? (
        <div className="folder-list">
          {folders.map((folder) => {
            const folderTracks = visible.filter(
              (track) => track.folderId === folder.id,
            );
            return (
              <div className="folder-row" key={folder.id}>
                <div className="folder-icon">
                  <Disc3 size={18} />
                </div>
                <div className="folder-text">
                  <strong>{folder.path.split(/[\\/]/).pop()}</strong>
                  <span>{folder.path}</span>
                </div>
                <div className="folder-meta">
                  {trackCountLabel(folderTracks.length)}
                  <span>
                    {folder.lastScanAt
                      ? `Скан ${formatDate(folder.lastScanAt)}`
                      : "Ещё не сканировалась"}
                  </span>
                </div>
                <div className="folder-actions">
                  <button
                    className="icon-button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Убрать папку из библиотеки? Файлы на диске останутся.",
                        )
                      ) {
                        void removeFolder(folder.id);
                      }
                    }}
                    aria-label="Убрать папку"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          <button className="folder-add-row" onClick={() => void handleAddFolder()}>
            <FolderPlus size={17} />
            Добавить ещё папку
          </button>
        </div>
      ) : null}

      {tab === "playlists" ? (
        <div className="playlist-grid library-playlist-grid">
          {playlists.map((playlist) => {
            const playlistTracks = playlist.trackIds
              .map((id) => tracks.find((track) => track.id === id))
              .filter((track): track is Track => Boolean(track));
            return (
              <button
                className="playlist-card"
                key={playlist.id}
                onClick={() => navigate(`/playlists/${playlist.id}`)}
              >
                <PlaylistMosaic tracks={playlistTracks} />
                <div className="playlist-card-text">
                  <strong>{playlist.name}</strong>
                  <span>
                    {trackCountLabel(playlistTracks.length)} ·{" "}
                    {formatMinutes(
                      playlistTracks.reduce(
                        (sum, track) => sum + track.durationMs,
                        0,
                      ),
                    )}
                  </span>
                </div>
              </button>
            );
          })}
          <button
            className="playlist-card add"
            onClick={() => openCreatePlaylist(true)}
          >
            <span className="playlist-add-icon">
              <Plus size={18} />
            </span>
            <div className="playlist-card-text">
              <strong>Новый плейлист</strong>
              <span>Собрать из разных папок</span>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  );
}
