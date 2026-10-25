import { useEffect, useState, type CSSProperties } from "react";
import { ListPlus, Trash2, X } from "lucide-react";
import { pluralRu } from "../lib/format";
import { useConfirmStore } from "../store/confirm";
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
  const deleteTracks = useLibraryStore((state) => state.deleteTracks);
  const openTrackActions = useUiStore((state) => state.openTrackActions);
  const openAddToPlaylist = useUiStore((state) => state.openAddToPlaylist);
  const confirm = useConfirmStore((state) => state.confirm);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  useEffect(() => {
    const available = new Set(tracks.map((track) => track.id));
    setSelected((previous) => {
      const next = new Set(
        [...previous].filter((id) => available.has(id)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [tracks]);

  const handleActivate = (
    track: Track,
    index: number,
    event: {
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
    },
  ) => {
    if (event.shiftKey) {
      const anchor = anchorIndex ?? index;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      setSelected((previous) => {
        const next = new Set(previous);
        for (let row = start; row <= end; row += 1) {
          const item = tracks[row];
          if (item) next.add(item.id);
        }
        return next;
      });
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(track.id)) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      setAnchorIndex(index);
      return;
    }
    setSelected(new Set([track.id]));
    setAnchorIndex(index);
    setContext(
      tracks.map((item) => item.id),
      track.id,
      label,
    );
  };

  const removeSelected = async () => {
    if (selected.size === 0) return;
    const confirmed = await confirm({
      title: "Удалить выбранные треки?",
      message: `Удалить ${selected.size} ${pluralRu(selected.size, [
        "трек",
        "трека",
        "треков",
      ])} из Nova и с диска? Это действие нельзя отменить.`,
      confirmLabel: "Удалить треки и файлы",
      tone: "danger",
    });
    if (!confirmed) return;
    const ids = [...selected];
    if (currentId !== null && ids.includes(currentId)) {
      usePlayerStore.getState().clearQueue();
    }
    await deleteTracks(ids, true);
    setSelected(new Set());
    setAnchorIndex(null);
  };

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

  return (
    <>
      {selected.size > 0 ? (
        <div className="selection-bar">
          <span>
            Выбрано <strong>{selected.size}</strong>
          </span>
          <div className="selection-actions">
            <button
              className="secondary-button"
              onClick={() => openAddToPlaylist([...selected])}
            >
              <ListPlus size={14} />
              В плейлист
            </button>
            <button
              className="ghost-button danger"
              onClick={() => void removeSelected()}
            >
              <Trash2 size={14} />
              Удалить
            </button>
            <button
              className="icon-button"
              onClick={() => {
                setSelected(new Set());
                setAnchorIndex(null);
              }}
              aria-label="Снять выделение"
              title="Снять выделение"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
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
            selected={selected.has(track.id)}
            onActivate={(event) =>
              handleActivate(track, index, event)
            }
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
    </>
  );
}
