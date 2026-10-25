import { ArrowDown, ArrowUp, Heart, MoreHorizontal } from "lucide-react";
import { formatDuration } from "../lib/format";
import type { Track } from "../types";
import { Cover } from "./Cover";

interface TrackRowProps {
  track: Track;
  index: number;
  active?: boolean;
  isPlaying?: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onMenu: () => void;
  showAlbum?: boolean;
  showFolder?: boolean;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 2] ?? "—";
}

export function TrackRow({
  track,
  index,
  active = false,
  isPlaying = false,
  onPlay,
  onToggleFavorite,
  onMenu,
  showAlbum = true,
  showFolder = true,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TrackRowProps) {
  return (
    <div
      className={`track-row${active ? " is-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
    >
      <div className="track-main">
        <span className="track-index">
          {active && isPlaying ? (
            <span className="playing-bars">
              <i />
              <i />
              <i />
            </span>
          ) : (
            String(index + 1).padStart(2, "0")
          )}
        </span>
        <Cover track={track} className="track-cover" />
        <div className="track-text">
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>
      </div>

      {showAlbum ? <div className="track-album">{track.album || "—"}</div> : null}
      {showFolder ? (
        <div className="track-folder">{folderName(track.path)}</div>
      ) : null}
      <div className="track-duration">{formatDuration(track.durationMs)}</div>
      <div className="track-format">
        <span>{track.format || "—"}</span>
      </div>

      <div className="track-actions">
        {onMoveUp ? (
          <button
            className="icon-button tiny"
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            aria-label="Выше"
          >
            <ArrowUp size={13} />
          </button>
        ) : null}
        {onMoveDown ? (
          <button
            className="icon-button tiny"
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            aria-label="Ниже"
          >
            <ArrowDown size={13} />
          </button>
        ) : null}
        <button
          className={`icon-button tiny${track.favorite ? " is-favorite" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={
            track.favorite ? "Убрать из избранного" : "Добавить в избранное"
          }
        >
          <Heart size={14} fill={track.favorite ? "currentColor" : "none"} />
        </button>
        {onRemove ? (
          <button
            className="text-button tiny"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            Убрать
          </button>
        ) : null}
        <button
          className="icon-button tiny"
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
          aria-label="Действия с треком"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
