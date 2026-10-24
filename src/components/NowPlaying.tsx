import {
  ChevronDown,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { formatDuration } from "../lib/format";
import { backgroundUrl, coverUrl } from "../lib/tauri";
import { useLibraryStore } from "../store/library";
import { useCurrentTrack, usePlayerStore } from "../store/player";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import { Cover } from "./Cover";

export function NowPlaying() {
  const open = useUiStore((state) => state.nowPlayingOpen);
  const setOpen = useUiStore((state) => state.setNowPlayingOpen);
  const setEqualizerOpen = useUiStore((state) => state.setEqualizerOpen);
  const setQueueOpen = useUiStore((state) => state.setQueueOpen);
  const current = useCurrentTrack();
  const tracks = useLibraryStore((state) => state.tracks);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const nowBackground = useSettingsStore((state) => state.nowBackground);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const order = usePlayerStore((state) => state.order);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const next = usePlayerStore((state) => state.next);
  const prev = usePlayerStore((state) => state.prev);
  const seek = usePlayerStore((state) => state.seek);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const playFromOrder = usePlayerStore((state) => state.playFromOrder);

  if (!open) return null;

  const duration = durationMs || current?.durationMs || 0;
  const progress = duration > 0 ? (positionMs / duration) * 100 : 0;
  const background = backgroundUrl(nowBackground) ?? coverUrl(current);
  const nextTracks = order
    .slice(order.findIndex((id) => id === current?.id) + 1)
    .slice(0, 3)
    .map((id) => tracks.find((track) => track.id === id))
    .filter((track): track is NonNullable<typeof track> => Boolean(track));

  return (
    <div className={`now-playing${background ? " has-background" : ""}`}>
      {background ? (
        <div
          className="now-playing-background"
          style={{ backgroundImage: `url(${background})` }}
        />
      ) : null}
      <div className="now-playing-scrim" />

      <header className="now-playing-head">
        <span className="serif">Nova</span>
        <button className="icon-button" onClick={() => setOpen(false)}>
          <ChevronDown size={20} />
        </button>
      </header>

      {current ? (
        <div className="now-playing-body">
          <div className="now-playing-art">
            <Cover track={current} className="now-cover-big" />
          </div>

          <div className="now-playing-info">
            <div className="now-playing-meta">
              <span>Сейчас играет</span>
              <span>{current.format || "AUDIO"}</span>
            </div>
            <h1 className="serif">{current.title}</h1>
            <p className="now-artist">{current.artist}</p>
            <p className="now-album">
              {current.album}
              {current.year ? ` · ${current.year}` : ""}
            </p>

            <div className="now-progress">
              <span>{formatDuration(positionMs)}</span>
              <input
                className="range seek-range"
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={Math.min(positionMs, Math.max(1, duration))}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="Позиция"
                style={{ "--range-progress": `${progress}%` } as CSSProperties}
              />
              <span>{formatDuration(duration)}</span>
            </div>

            <div className="now-controls">
              <button
                className={`icon-button${shuffle ? " is-active" : ""}`}
                onClick={toggleShuffle}
                aria-label="Перемешать"
              >
                <Shuffle size={18} />
              </button>
              <button className="icon-button" onClick={prev} aria-label="Назад">
                <SkipBack size={22} fill="currentColor" />
              </button>
              <button className="now-play" onClick={togglePlay}>
                {isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" />
                )}
              </button>
              <button
                className="icon-button"
                onClick={() => next(false)}
                aria-label="Вперёд"
              >
                <SkipForward size={22} fill="currentColor" />
              </button>
              <button
                className={`icon-button${repeat !== "off" ? " is-active" : ""}`}
                onClick={cycleRepeat}
                aria-label="Повтор"
              >
                {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
              </button>
            </div>

            <div className="now-secondary">
              <button
                className={`icon-button${current.favorite ? " is-favorite" : ""}`}
                onClick={() => void toggleFavorite(current.id)}
                aria-label="Избранное"
              >
                <Heart
                  size={18}
                  fill={current.favorite ? "currentColor" : "none"}
                />
              </button>
              <div className="volume">
                <button className="icon-button" onClick={toggleMute}>
                  {muted || volume === 0 ? (
                    <VolumeX size={17} />
                  ) : (
                    <Volume2 size={17} />
                  )}
                </button>
                <input
                  className="range volume-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  style={
                    {
                      "--range-progress": `${(muted ? 0 : volume) * 100}%`,
                    } as CSSProperties
                  }
                />
              </div>
              <button
                className="icon-button"
                onClick={() => setEqualizerOpen(true)}
                aria-label="Эквалайзер"
              >
                <SlidersHorizontal size={18} />
              </button>
              <button
                className="icon-button"
                onClick={() => {
                  setQueueOpen(true);
                  setOpen(false);
                }}
                aria-label="Очередь"
              >
                <ListMusic size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="now-playing-empty">
          <X size={22} />
          <p>Ничего не играет</p>
        </div>
      )}

      {nextTracks.length > 0 ? (
        <footer className="now-next">
          <span>Далее</span>
          <div className="now-next-list">
            {nextTracks.map((track, index) => (
              <button
                key={track.id}
                className="now-next-item"
                onClick={() => playFromOrder(order.indexOf(track.id))}
              >
                <Cover track={track} className="now-next-cover" />
                <span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <em>{index + 1}</em>
              </button>
            ))}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
