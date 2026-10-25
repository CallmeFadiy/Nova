import {
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  ScrollText,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CSSProperties } from "react";
import { formatDuration } from "../lib/format";
import { useLibraryStore } from "../store/library";
import { useCurrentTrack, usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import { Cover } from "./Cover";

export function PlayerBar() {
  const current = useCurrentTrack();
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const next = usePlayerStore((state) => state.next);
  const prev = usePlayerStore((state) => state.prev);
  const seek = usePlayerStore((state) => state.seek);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const setNowPlayingOpen = useUiStore((state) => state.setNowPlayingOpen);
  const openLyrics = useUiStore((state) => state.openLyrics);
  const queueOpen = useUiStore((state) => state.queueOpen);
  const setQueueOpen = useUiStore((state) => state.setQueueOpen);
  const setEqualizerOpen = useUiStore((state) => state.setEqualizerOpen);

  const duration = durationMs || current?.durationMs || 0;
  const progress = duration > 0 ? (positionMs / duration) * 100 : 0;

  return (
    <footer className="player-bar">
      <div className="player-track">
        <button
          className="player-cover-button"
          onClick={() => current && setNowPlayingOpen(true)}
          aria-label="Открыть сейчас играет"
        >
          <Cover track={current} className="player-cover" />
        </button>
        <div className="player-track-text">
          <strong>{current?.title ?? "Ничего не играет"}</strong>
          <span>
            {current
              ? `${current.artist} · ${current.album}`
              : "Выберите трек в библиотеке"}
          </span>
        </div>
        {current ? (
          <button
            className={`icon-button heart-button${current.favorite ? " is-favorite" : ""}`}
            onClick={() => void toggleFavorite(current.id)}
            aria-label={
              current.favorite ? "Убрать из избранного" : "Добавить в избранное"
            }
          >
            <Heart
              size={15}
              fill={current.favorite ? "currentColor" : "none"}
            />
          </button>
        ) : null}
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button
            className={`icon-button control-small${shuffle ? " is-active" : ""}`}
            onClick={toggleShuffle}
            title="Перемешать"
            aria-label="Перемешать"
          >
            <Shuffle size={15} />
          </button>
          <button
            className="icon-button control"
            onClick={prev}
            title="Предыдущий трек"
            aria-label="Предыдущий трек"
          >
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button
            className="play-button"
            onClick={togglePlay}
            title={isPlaying ? "Пауза" : "Играть"}
            aria-label={isPlaying ? "Пауза" : "Играть"}
          >
            {isPlaying ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" className="play-icon" />
            )}
          </button>
          <button
            className="icon-button control"
            onClick={() => next(false)}
            title="Следующий трек"
            aria-label="Следующий трек"
          >
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button
            className={`icon-button control-small${repeat !== "off" ? " is-active" : ""}`}
            onClick={cycleRepeat}
            title={
              repeat === "one"
                ? "Повтор одного трека"
                : repeat === "all"
                  ? "Повтор очереди"
                  : "Повтор выключен"
            }
            aria-label="Режим повтора"
          >
            {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
        </div>

        <div className="player-seek">
          <span>{formatDuration(positionMs)}</span>
          <input
            className="range seek-range"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(positionMs, Math.max(1, duration))}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Позиция трека"
            style={{ "--range-progress": `${progress}%` } as CSSProperties}
          />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {current ? <span className="quality-badge">{current.format || "AUDIO"}</span> : null}
        <div className="volume">
          <button
            className="icon-button"
            onClick={toggleMute}
            aria-label={muted ? "Включить звук" : "Выключить звук"}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            className="range volume-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Громкость"
            style={
              {
                "--range-progress": `${(muted ? 0 : volume) * 100}%`,
              } as CSSProperties
            }
          />
          <span className="volume-value">
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => current && openLyrics(current.id)}
          disabled={!current}
          title="Текст песни"
          aria-label="Текст песни"
        >
          <ScrollText size={16} />
        </button>
        <button
          className="icon-button"
          onClick={() => setEqualizerOpen(true)}
          title="Эквалайзер"
          aria-label="Эквалайзер"
        >
          <SlidersHorizontal size={16} />
        </button>
        <button
          className={`icon-button${queueOpen ? " is-active" : ""}`}
          onClick={() => setQueueOpen(!queueOpen)}
          title="Очередь"
          aria-label="Очередь"
        >
          <ListMusic size={16} />
        </button>
      </div>
    </footer>
  );
}
