import type { CSSProperties } from "react";
import { useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { Track } from "../types";
import { TrackRow } from "./TrackRow";

interface TrackTableProps {
  tracks: Track[];
  label: string;
  showAlbum?: boolean;
  showFolder?: boolean;
  emptyTitle?: string;
  emptyText?: string;
  onRemove?: (track: Track) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
}

export function TrackTable({
  tracks,
  label,
  showAlbum = true,
  showFolder = true,
  emptyTitle = "Здесь пока пусто",
  emptyText = "Добавьте треки из библиотеки.",
  onRemove,
  onMoveUp,
  onMoveDown,
}: TrackTableProps) {
  const currentId = usePlayerStore((state) => state.currentId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const openTrackActions = useUiStore((state) => state.openTrackActions);

  const columns = [
    "minmax(0, 2.4fr)",
    showAlbum ? "minmax(0, 1.3fr)" : null,
    showFolder ? "110px" : null,
    "80px",
    "62px",
    "140px",
  ]
    .filter(Boolean)
    .join(" ");

  if (tracks.length === 0) {
    return (
      <div className="empty-block">
        <h3 className="serif">{emptyTitle}</h3>
        <p>{emptyText}</p>
      </div>
    );
  }

  const playTrack = (track: Track) => {
    setContext(
      tracks.map((item) => item.id),
      track.id,
      label,
    );
  };

  return (
    <div
      className="track-table"
      style={{ "--track-cols": columns } as CSSProperties}
    >
      <div className="track-table-header">
        <span>Трек</span>
        {showAlbum ? <span>Альбом</span> : null}
        {showFolder ? <span>Папка</span> : null}
        <span>Время</span>
        <span>Формат</span>
        <span />
      </div>
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          active={track.id === currentId}
          isPlaying={isPlaying}
          onPlay={() => playTrack(track)}
          onToggleFavorite={() => void toggleFavorite(track.id)}
          onMenu={() => openTrackActions(track.id)}
          showAlbum={showAlbum}
          showFolder={showFolder}
          onRemove={onRemove ? () => onRemove(track) : undefined}
          onMoveUp={onMoveUp ? () => onMoveUp(index) : undefined}
          onMoveDown={onMoveDown ? () => onMoveDown(index) : undefined}
        />
      ))}
    </div>
  );
}
