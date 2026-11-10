import { Copy, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, formatDuration, pluralRu } from "../lib/format";
import { useConfirmStore } from "../store/confirm";
import type { DuplicateTrackGroup } from "../store/library";
import { Modal } from "./Modal";

interface DuplicateTracksModalProps {
  open: boolean;
  groups: DuplicateTrackGroup[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (trackIds: number[]) => void;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function DuplicateTracksModal({
  open,
  groups,
  busy,
  onClose,
  onConfirm,
}: DuplicateTracksModalProps) {
  const confirm = useConfirmStore((state) => state.confirm);
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches,
  );

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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

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
  const keptCount = groups.reduce(
    (sum, group) =>
      sum + group.tracks.filter((track) => !deleteIds.has(track.id)).length,
    0,
  );

  const handleConfirm = async () => {
    if (busy || deleteCount === 0) return;
    const confirmed = await confirm({
      title: `Удалить ${deleteCount} ${pluralRu(deleteCount, [
        "файл",
        "файла",
        "файлов",
      ])} с диска?`,
      message:
        "Это действие нельзя отменить. В библиотеке останутся выбранные копии.",
      confirmLabel: "Да, удалить",
      tone: "danger",
    });
    if (confirmed) onConfirm([...deleteIds]);
  };

  const title = compact ? "Что оставить?" : "Дубликаты треков";
  const subtitle = compact
    ? `${groups.length} ${pluralRu(groups.length, [
        "группа",
        "группы",
        "групп",
      ])} · выберите по одному файлу`
    : `${groups.length} ${pluralRu(groups.length, [
        "группа",
        "группы",
        "групп",
      ])} · ${
        allVerified ? "содержимое сверено по SHA-1" : "совпадения по тегам"
      }`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      className={`duplicate-dialog${compact ? " is-compact" : ""}`}
    >
      {compact ? (
        <div className="duplicate-compact">
          <div className="dupe-note">
            <ShieldCheck size={15} />
            <span>
              Файлы в группах идентичны. Оставьте лучшую копию — остальные
              будут удалены.
            </span>
          </div>

          <div className="dupe-list">
            {groups.map((group) => {
              const groupDeleteCount = group.tracks.filter((track) =>
                deleteIds.has(track.id),
              ).length;
              const groupChecked = groupDeleteCount > 0;
              const keptInGroup = group.tracks.length - groupDeleteCount;

              return (
                <div className="dupe-group" key={group.key}>
                  <div className="dupe-head">
                    <div className="dupe-title">
                      <strong>{group.title}</strong>
                      <span>
                        {group.artist} · {group.tracks.length}{" "}
                        {pluralRu(group.tracks.length, [
                          "файл",
                          "файла",
                          "файлов",
                        ])}
                      </span>
                    </div>
                    <div className="dupe-head-right">
                      <span className="dupe-count">
                        {groupChecked
                          ? `${groupDeleteCount} к удалению`
                          : "не трогаем"}
                      </span>
                      <button
                        className="dupe-skip"
                        onClick={() => skipGroup(group)}
                        disabled={!groupChecked}
                      >
                        Не трогать
                      </button>
                    </div>
                  </div>

                  {group.tracks.map((track) => {
                    const marked = deleteIds.has(track.id);
                    const onlyKept = keptInGroup === 1 && !marked;
                    return (
                      <label
                        className={`dupe-file ${
                          marked ? "is-del" : "is-keep"
                        }`}
                        key={track.id}
                      >
                        <input
                          className="dupe-radio"
                          type="radio"
                          name={`duplicate-keep-${group.key}`}
                          checked={!marked && groupChecked}
                          disabled={onlyKept}
                          onChange={() => keepOnly(group, track.id)}
                        />
                        <span className="dupe-file-main">
                          <strong>{fileName(track.path)}</strong>
                          <span>
                            {formatBytes(track.size)} ·{" "}
                            {formatDuration(track.durationMs)}
                          </span>
                        </span>
                        <span className="dupe-state">
                          {groupChecked && marked ? "Будет удалён" : "Оставить"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="dupe-footer">
            <span className="dupe-summary">
              Оставить {keptCount} · удалить {deleteCount}
            </span>
            <div className="dupe-actions">
              <button className="ghost-button" onClick={onClose} disabled={busy}>
                Отмена
              </button>
              <button
                className="danger-button"
                onClick={() => void handleConfirm()}
                disabled={busy || deleteCount === 0}
              >
                <Trash2 size={14} />
                Проверить
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="duplicate-tracks-modal">
          <div className="duplicate-warning">
            {allVerified ? <ShieldCheck size={18} /> : <Copy size={18} />}
            <p>
              {allVerified
                ? "Содержимое файлов в каждой группе сверено по SHA-1 – это одинаковые записи. "
                : "Nova сверила исполнителя и название; содержимое недоступно для проверки. "}
              По умолчанию отмечены все копии, кроме файла лучшего качества.
              Снимите галочки с тех, что хотите сохранить, или нажмите «Не
              трогать» для группы. Последний оставленный файл удалить нельзя.
            </p>
          </div>

          <div className="duplicate-tracks-list">
            {groups.map((group) => {
              const groupDeleteCount = group.tracks.filter((track) =>
                deleteIds.has(track.id),
              ).length;
              const keptCountInGroup = group.tracks.length - groupDeleteCount;

              return (
                <div className="duplicate-track-group" key={group.key}>
                  <div className="duplicate-track-title">
                    <div className="duplicate-track-heading">
                      <strong>{group.title}</strong>
                      <span>{group.artist}</span>
                    </div>
                    <div className="duplicate-group-actions">
                      <span
                        className="duplicate-recommendation"
                        title="Рекомендуемый файл по битрейту и формату"
                      >
                        Рекомендуется: {group.recommendation}
                      </span>
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
                    const onlyKept = keptCountInGroup === 1 && !marked;

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
                        <span
                          className="duplicate-track-path"
                          title={track.path}
                        >
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
              onClick={() => void handleConfirm()}
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
      )}
    </Modal>
  );
}
