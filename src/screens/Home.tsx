import {
  ArrowRight,
  FolderPlus,
  Pause,
  Play,
  Shuffle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Cover } from "../components/Cover";
import { ScanButton } from "../components/ScanButton";
import {
  formatDuration,
  pluralRu,
  trackCountLabel,
} from "../lib/format";
import { pickFolder } from "../lib/tauri";
import { groupAlbums, useLibraryStore, visibleTracks } from "../store/library";
import { useCurrentTrack, usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { Track } from "../types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export function Home() {
  const tracks = useLibraryStore((state) => state.tracks);
  const folders = useLibraryStore((state) => state.folders);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const current = useCurrentTrack();
  const notify = useUiStore((state) => state.notify);

  const visible = visibleTracks(tracks);
  const albums = groupAlbums(tracks);
  const recent = [...visible]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 4);
  const hero = current ?? recent[0] ?? null;
  const heroIsCurrent = Boolean(current && hero && current.id === hero.id);

  const playHero = () => {
    if (!hero) return;
    if (heroIsCurrent) {
      togglePlay();
      return;
    }
    setContext(
      visible.map((track) => track.id),
      hero.id,
      "Библиотека",
    );
  };

  const shuffleHero = () => {
    if (!hero) return;
    if (!shuffle) toggleShuffle();
    setContext(
      visible.map((track) => track.id),
      hero.id,
      "Библиотека",
    );
  };

  const playTrack = (track: Track) => {
    setContext(
      visible.map((item) => item.id),
      track.id,
      "Библиотека",
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
              {folders.length > 0 ? <ScanButton /> : null}
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
            {pluralRu(albums.length, ["альбом", "альбома", "альбомов"])}
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
          <ScanButton />
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
              <button
                className="play-hero"
                onClick={playHero}
                aria-label={
                  heroIsCurrent && isPlaying ? "Пауза" : "Играть"
                }
              >
                {heroIsCurrent && isPlaying ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button className="ghost-button" onClick={shuffleHero}>
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

    </div>
  );
}
