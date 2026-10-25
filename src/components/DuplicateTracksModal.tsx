import { Copy, Trash2 } from "lucide-react";
import { formatBytes, pluralRu } from "../lib/format";
import type { DuplicateTrackGroup } from "../store/library";
import { Modal } from "./Modal";

interface DuplicateTracksModalProps {
  open: boolean;
  groups: DuplicateTrackGroup[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DuplicateTracksModal({
  open,
  groups,
  busy,
  onClose,
  onConfirm,
}: DuplicateTracksModalProps) {
  const duplicateCount = groups.reduce(
    (sum, group) => sum + group.duplicates.length,
    0,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Найдены дубликаты"
      subtitle={`${groups.length} ${pluralRu(groups.length, [
        "группа",
        "группы",
        "групп",
      ])} · ${duplicateCount} ${pluralRu(duplicateCount, [
        "лишний файл",
        "лишних файла",
        "лишних файлов",
      ])}`}
      size="md"
    >
      <div className="duplicate-tracks-modal">
        <div className="duplicate-warning">
          <Copy size={18} />
          <p>
            В каждой группе останется файл лучшего качества. Остальные копии
            будут удалены из Nova и с диска. Отменить это действие нельзя.
          </p>
        </div>
        <div className="duplicate-tracks-list">
          {groups.map((group) => (
            <div className="duplicate-track-group" key={group.key}>
              <div className="duplicate-track-title">
                <strong>{group.title}</strong>
                <span>{group.artist}</span>
              </div>
              {group.tracks.map((track) => {
                const keep = track.id === group.keep.id;
                return (
                  <div
                    className={`duplicate-track-row${keep ? " is-kept" : ""}`}
                    key={track.id}
                  >
                    <span className="duplicate-track-mark">
                      {keep ? "Оставить" : "Удалить"}
                    </span>
                    <span className="duplicate-track-path" title={track.path}>
                      {track.path}
                    </span>
                    <span className="duplicate-track-size">
                      {formatBytes(track.size)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            className="danger-button"
            onClick={onConfirm}
            disabled={busy || duplicateCount === 0}
          >
            <Trash2 size={14} />
            {busy ? "Удаляем…" : "Оставить по одной копии"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
