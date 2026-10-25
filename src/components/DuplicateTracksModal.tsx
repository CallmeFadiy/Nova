import { Copy, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, formatDuration, pluralRu } from "../lib/format";
import type { DuplicateTrackGroup } from "../store/library";
import { Modal } from "./Modal";

interface DuplicateTracksModalProps {
  open: boolean;
  groups: DuplicateTrackGroup[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (trackIds: number[]) => void;
}

export function DuplicateTracksModal({
  open,
  groups,
  busy,
  onClose,
  onConfirm,
}: DuplicateTracksModalProps) {
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setDeleteIds(
      new Set(
        groups.flatMap((group) =>
          group.tracks
            .filter((track) => track.id !== group.keep.id)
            .map((track) => track.id),
        ),
      ),
    );
  }, [open, groups]);

  const toggleDelete = (trackId: number) => {
    setDeleteIds((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const keepOnly = (group: DuplicateTrackGroup, trackId: number) => {
    setDeleteIds((previous) => {
      const next = new Set(previous);
      for (const track of group.tracks) {
        if (track.id === trackId) next.delete(track.id);
        else next.add(track.id);
      }
      return next;
    });
  };

  const skipGroup = (group: DuplicateTrackGroup) => {
    setDeleteIds((previous) => {
      const next = new Set(previous);
      for (const track of group.tracks) next.delete(track.id);
      return next;
    });
  };

  const allVerified = groups.every((group) => group.verified);
  const deleteCount = deleteIds.size;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Дубликаты треков"
      subtitle={`${groups.length} ${pluralRu(groups.length, [
        "группа",
        "группы",
        "групп",
      ])} · ${deleteCount} ${pluralRu(deleteCount, [
        "файл отмечен",
        "файла отмечено",
        "файлов отмечено",
      ])}`}
      size="lg"
    >
      <div className="duplicate-tracks-modal">
        <div className="duplicate-warning">
          {allVerified ? <ShieldCheck size={18} /> : <Copy size={18} />}
          <p>
            {allVerified
              ? "Содержимое файлов в каждой группе сверено по SHA-1 – это одинаковые записи. "
              : "Nova сверила исполнителя и название; содержимое недоступно для проверки. "}
            По умолчанию отмечены все копии, кроме файла лучшего качества. Снимите
            галочки с тех, что хотите сохранить, или нажмите «Не трогать» для
            группы. Последний оставленный файл удалить нельзя.
          </p>
        </div>

        <div className="duplicate-tracks-list">
          {groups.map((group) => {
            const groupDeleteCount = group.tracks.filter((track) =>
              deleteIds.has(track.id),
            ).length;
            const keptCount = group.tracks.length - groupDeleteCount;

            return (
              <div className="duplicate-track-group" key={group.key}>
                <div className="duplicate-track-title">
                  <div className="duplicate-track-heading">
                    <strong>{group.title}</strong>
                    <span>{group.artist}</span>
                  </div>
                  <div className="duplicate-group-actions">
                    {group.verified ? (
                      <span className="duplicate-verified">
                        <ShieldCheck size={11} />
                        SHA-1
                      </span>
                    ) : null}
                    <span className="duplicate-group-count">
                      {groupDeleteCount > 0
                        ? `${groupDeleteCount} к удалению`
                        : "не трогаем"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => skipGroup(group)}
                      disabled={groupDeleteCount === 0}
                    >
                      Не трогать
                    </button>
                  </div>
                </div>

                {group.tracks.map((track) => {
                  const marked = deleteIds.has(track.id);
                  const onlyKept = keptCount === 1 && !marked;

                  return (
                    <div
                      className={`duplicate-track-row ${
                        marked ? "is-marked" : "is-kept"
                      }`}
                      key={track.id}
                    >
                      <label className="duplicate-track-check">
                        <input
                          type="checkbox"
                          checked={marked}
                          disabled={onlyKept}
                          onChange={() => toggleDelete(track.id)}
                        />
                        <span>{marked ? "Удалить" : "Оставить"}</span>
                      </label>
                      <span className="duplicate-track-path" title={track.path}>
                        {track.path}
                      </span>
                      <span className="duplicate-track-size">
                        {formatBytes(track.size)} ·{" "}
                        {formatDuration(track.durationMs)}
                      </span>
                      <button
                        className="text-button duplicate-keep-button"
                        onClick={() => keepOnly(group, track.id)}
                        disabled={onlyKept}
                        title="Оставить этот файл, остальные копии удалить"
                      >
                        Только этот
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            className="danger-button"
            onClick={() => onConfirm([...deleteIds])}
            disabled={busy || deleteCount === 0}
          >
            <Trash2 size={14} />
            {busy
              ? "Удаляем…"
              : deleteCount === 0
                ? "Ничего не выбрано"
                : `Удалить ${deleteCount} ${pluralRu(deleteCount, [
                    "файл",
                    "файла",
                    "файлов",
                  ])}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
