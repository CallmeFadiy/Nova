import { useState } from "react";
import {
  ChevronLeft,
  Pencil,
  Play,
  Plus,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { PlaylistMosaic } from "../components/PlaylistMosaic";
import { TrackTable } from "../components/TrackTable";
import { formatMinutes, trackCountLabel } from "../lib/format";
import { useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { Track } from "../types";

export function PlaylistDetail() {
  const { id } = useParams();
  const playlistId = Number(id);
  const playlists = useLibraryStore((state) => state.playlists);
  const tracks = useLibraryStore((state) => state.tracks);
  const renamePlaylist = useLibraryStore((state) => state.renamePlaylist);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const removeFromPlaylist = useLibraryStore((state) => state.removeFromPlaylist);
  const reorderPlaylist = useLibraryStore((state) => state.reorderPlaylist);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  const playlist = playlists.find((item) => item.id === playlistId) ?? null;

  if (!playlist) {
    return (
      <div className="page">
        <button className="back-button" onClick={() => navigate("/playlists")}>
          <ChevronLeft size={16} />
          Плейлисты
        </button>
        <div className="empty-block">
          <h3 className="serif">Плейлист не найден</h3>
          <p>Возможно, он был удалён.</p>
        </div>
      </div>
    );
  }

  const playlistTracks = playlist.trackIds
    .map((trackId) => tracks.find((track) => track.id === trackId))
    .filter((track): track is Track => Boolean(track));

  const play = (shuffled = false) => {
    if (playlistTracks.length === 0) {
      notify("В плейлисте пока нет треков", "info");
      return;
    }
    if (shuffled && !usePlayerStore.getState().shuffle) toggleShuffle();
    setContext(
      playlistTracks.map((track) => track.id),
      playlistTracks[0].id,
      `Плейлист «${playlist.name}»`,
      true,
    );
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= playlist.trackIds.length) return;
    const ids = [...playlist.trackIds];
    const [item] = ids.splice(from, 1);
    ids.splice(to, 0, item);
    void reorderPlaylist(playlist.id, ids);
  };

  const submitRename = async () => {
    if (name.trim()) await renamePlaylist(playlist.id, name.trim());
    setRenaming(false);
    setName("");
  };

  return (
    <div className="page">
      <button className="back-button" onClick={() => navigate("/playlists")}>
        <ChevronLeft size={16} />
        Плейлисты
      </button>

      <header className="playlist-detail-head">
        <PlaylistMosaic
          tracks={playlistTracks}
          className="playlist-detail-mosaic"
          large
        />

        <div className="playlist-detail-text">
          <span className="eyebrow">Плейлист</span>
          {renaming ? (
            <div className="inline-rename">
              <input
                className="text-input"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitRename();
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
              <button className="primary-button" onClick={() => void submitRename()}>
                ОК
              </button>
            </div>
          ) : (
            <h1 className="serif">{playlist.name}</h1>
          )}
          <p className="page-sub">
            {trackCountLabel(playlistTracks.length)} ·{" "}
            {formatMinutes(
              playlistTracks.reduce((sum, track) => sum + track.durationMs, 0),
            )}
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => play()}>
              <Play size={15} fill="currentColor" />
              Играть
            </button>
            <button className="secondary-button" onClick={() => play(true)}>
              <Shuffle size={15} />
              Перемешать
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                setName(playlist.name);
                setRenaming(true);
              }}
            >
              <Pencil size={14} />
              Переименовать
            </button>
            <button
              className="ghost-button danger"
              onClick={() => {
                if (
                  window.confirm(
                    `Удалить плейлист «${playlist.name}»? Треки и файлы останутся.`,
                  )
                ) {
                  void deletePlaylist(playlist.id);
                  navigate("/playlists");
                }
              }}
            >
              <Trash2 size={14} />
              Удалить
            </button>
          </div>
        </div>
      </header>

      {playlistTracks.length === 0 ? (
        <div className="empty-block">
          <h3 className="serif">В плейлисте пока нет треков</h3>
          <p>Добавьте треки из библиотеки — из любых папок.</p>
          <button
            className="primary-button"
            onClick={() => navigate("/library")}
          >
            <Plus size={15} />
            Открыть библиотеку
          </button>
        </div>
      ) : (
        <TrackTable
          tracks={playlistTracks}
          label={`Плейлист «${playlist.name}»`}
          showAlbum
          showFolder={false}
          onRemove={(track) => void removeFromPlaylist(playlist.id, track.id)}
          onMoveUp={(index) => {
            const track = playlistTracks[index];
            if (!track) return;
            move(playlist.trackIds.indexOf(track.id), playlist.trackIds.indexOf(track.id) - 1);
          }}
          onMoveDown={(index) => {
            const track = playlistTracks[index];
            if (!track) return;
            move(playlist.trackIds.indexOf(track.id), playlist.trackIds.indexOf(track.id) + 1);
          }}
        />
      )}
    </div>
  );
}
