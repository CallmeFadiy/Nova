import {
  ArrowRight,
  Disc3,
  FolderPlus,
  ListMusic,
  Play,
  ScanLine,
  Shuffle,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Cover } from "../components/Cover";
import { PlaylistMosaic } from "../components/PlaylistMosaic";
import {
  formatDuration,
  formatMinutes,
  pluralRu,
  trackCountLabel,
} from "../lib/format";
import { pickFolder } from "../lib/tauri";
import {
  favoriteTracks,
  groupAlbums,
  useLibraryStore,
  visibleTracks,
} from "../store/library";
import { useCurrentTrack, usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { Playlist, Track } from "../types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export function Home() {
  const tracks = useLibraryStore((state) => state.tracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const folders = useLibraryStore((state) => state.folders);
  const scanning = useLibraryStore((state) => state.scanning);
  const scan = useLibraryStore((state) => state.scan);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const current = useCurrentTrack();
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();

  const visible = visibleTracks(tracks);
  const favorites = favoriteTracks(tracks);
  const albums = groupAlbums(tracks);
  const recent = [...visible]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 4);
  const hero = current ?? recent[0] ?? null;
  const heroIsCurrent = Boolean(current && hero && current.id === hero.id);

  const playHero = () => {
    if (!hero) return;
    setContext(
      visible.map((track) => track.id),
      hero.id,
      heroIsCurrent ? "Продолжение" : "Библиотека",
    );
  };

  const playTrack = (track: Track) => {
    setContext(
      visible.map((item) => item.id),
      track.id,
      "Библиотека",
    );
  };

  const playPlaylist = (playlist: Playlist) => {
    if (playlist.trackIds.length === 0) {
      notify("В плейлисте пока нет треков", "info");
      return;
    }
    setContext(
      playlist.trackIds,
      playlist.trackIds[0],
      `Плейлист «${playlist.name}»`,
    );
  };

  const handleAddFolder = async () => {
    const path = await pickFolder();
    if (!path) {
      notify("Выбор папки доступен в приложении Nova", "info");
      return;
    }
    await addFolder(path);
  };

  if (visible.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="page-date">
              {new Date().toLocaleDateString("ru-RU", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h1 className="serif">{greeting()}</h1>
            <p className="page-sub">Локальная библиотека пока пуста</p>
          </div>
        </header>

        <section className="onboarding">
          <img src="/icon.png" alt="" className="onboarding-icon" />
          <div>
            <h2 className="serif">Добавьте папку с музыкой</h2>
            <p>
              Nova читает файлы на месте и не копирует их. Подойдут MP3, FLAC,
              WAV, OGG, M4A и AAC.
            </p>
            <div className="onboarding-actions">
              <button
                className="primary-button"
                onClick={() => void handleAddFolder()}
              >
                <FolderPlus size={16} />
                Добавить папку
              </button>
              <button
                className="secondary-button"
                onClick={() => void scan()}
                disabled={scanning || folders.length === 0}
              >
                <ScanLine size={16} />
                {scanning ? "Сканирование…" : "Сканировать"}
              </button>
            </div>
            {folders.length > 0 ? (
              <p className="onboarding-note">
                Папка уже добавлена, но треков в ней не найдено.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page home-page">
      <header className="page-head home-head">
        <div>
          <p className="page-date">
            {new Date().toLocaleDateString("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="serif">{greeting()}</h1>
          <p className="page-sub">
            {trackCountLabel(visible.length)} · {albums.length}{" "}
            {pluralRu(albums.length, ["альбом", "альбома", "альбомов"])} ·{" "}
            {playlists.length}{" "}
            {pluralRu(playlists.length, ["плейлист", "плейлиста", "плейлистов"])}
          </p>
        </div>
        <div className="head-actions">
          <button
            className={`icon-button${shuffle ? " is-active" : ""}`}
            onClick={toggleShuffle}
            title="Перемешать"
          >
            <Shuffle size={17} />
          </button>
          <button className="secondary-button" onClick={() => void scan()}>
            <ScanLine size={15} className={scanning ? "spin" : ""} />
            {scanning ? "Сканирование…" : "Сканировать"}
          </button>
        </div>
      </header>

      {hero ? (
        <section className="home-hero">
          <div className="home-hero-art">
            <Cover track={hero} className="hero-cover" />
          </div>
          <div className="home-hero-body">
            <span className="eyebrow">
              {heroIsCurrent ? (
                <>
                  <span className="playing-bars">
                    <i />
                    <i />
                    <i />
                  </span>
                  Продолжить слушать
                </>
              ) : (
                "Недавно добавлено"
              )}
            </span>
            <h2 className="serif">{hero.title}</h2>
            <p className="hero-artist">{hero.artist}</p>
            <p className="hero-album">
              {hero.album}
              {hero.year ? ` · ${hero.year}` : ""} ·{" "}
              {formatDuration(hero.durationMs)} · {hero.format || "audio"}
            </p>

            {heroIsCurrent ? (
              <div className="hero-progress">
                <span>{formatDuration(positionMs)}</span>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${
                        (positionMs / Math.max(1, hero.durationMs)) * 100
                      }%`,
                    }}
                  />
                </div>
                <span>{formatDuration(hero.durationMs)}</span>
              </div>
            ) : null}

            <div className="hero-actions">
              <button className="play-hero" onClick={playHero}>
                <Play size={18} fill="currentColor" />
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  if (!shuffle) toggleShuffle();
                  playHero();
                }}
              >
                <Shuffle size={14} />
                Перемешать
              </button>
              <Link to="/library" className="ghost-button">
                Вся библиотека
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="home-section">
        <div className="section-head">
          <h3 className="serif">Недавно добавленные</h3>
          <Link to="/library" className="section-link">
            Все треки <ArrowRight size={13} />
          </Link>
        </div>
        <div className="album-grid">
          {recent.map((track) => (
            <article className="album-card" key={track.id}>
              <button className="album-card-art" onClick={() => playTrack(track)}>
                <Cover track={track} className="album-card-cover" />
                <span className="album-play">
                  <Play size={14} fill="currentColor" />
                </span>
              </button>
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h3 className="serif">Плейлисты</h3>
          <Link to="/playlists" className="section-link">
            Все плейлисты <ArrowRight size={13} />
          </Link>
        </div>
        <div className="playlist-grid">
          {playlists.slice(0, 3).map((playlist) => {
            const playlistTracks = playlist.trackIds
              .map((id) => tracks.find((track) => track.id === id))
              .filter((track): track is Track => Boolean(track));
            return (
              <button
                className="playlist-card"
                key={playlist.id}
                onClick={() => playPlaylist(playlist)}
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
            onClick={() => useUiStore.getState().setCreatePlaylistOpen(true)}
          >
            <span className="playlist-add-icon">
              <ListMusic size={18} />
            </span>
            <div className="playlist-card-text">
              <strong>Новый плейлист</strong>
              <span>Собрать из разных папок</span>
            </div>
          </button>
        </div>
      </section>

      <section className="home-section sources-section">
        <div className="section-head">
          <h3 className="serif">Источники</h3>
          <Link to="/folders" className="section-link">
            Управлять <ArrowRight size={13} />
          </Link>
        </div>
        <div className="source-row">
          <div className="source-icon">
            <Disc3 size={17} />
          </div>
          <div className="source-text">
            <strong>{folders[0]?.path.split(/[\\/]/).pop() ?? "Папка"}</strong>
            <span>
              {trackCountLabel(visible.length)} · {formatMinutes(
                visible.reduce((sum, track) => sum + track.durationMs, 0),
              )} · {favorites.length} в избранном
            </span>
          </div>
          <button
            className="ghost-button"
            onClick={() => {
              if (folders[0]) navigate("/folders");
            }}
          >
            Открыть
          </button>
        </div>
      </section>
    </div>
  );
}
