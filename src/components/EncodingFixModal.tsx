import { Languages, Wrench } from "lucide-react";
import { pluralRu } from "../lib/format";
import type { TagEncodingIssue } from "../types";
import { Modal } from "./Modal";

const FIELD_LABELS: Record<TagEncodingIssue["field"], string> = {
  title: "Название",
  artist: "Исполнитель",
  album: "Альбом",
  album_artist: "Album artist",
};

interface EncodingFixModalProps {
  open: boolean;
  issues: TagEncodingIssue[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function EncodingFixModal({
  open,
  issues,
  busy,
  onClose,
  onConfirm,
}: EncodingFixModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Кодировка тегов"
      subtitle={`${issues.length} ${pluralRu(issues.length, [
        "поле",
        "поля",
        "полей",
      ])} с признаками cp1251/UTF-8`}
      size="lg"
    >
      <div className="encoding-modal">
        <div className="duplicate-warning">
          <Languages size={18} />
          <p>
            Nova покажет, как будут выглядеть названия после исправления.
            Меняются только метаданные в базе – файлы на диске не
            перезаписываются. То же исправление применяется при следующих
            сканированиях.
          </p>
        </div>
        <div className="encoding-list">
          {issues.map((issue) => (
            <div
              className="encoding-row"
              key={`${issue.trackId}-${issue.field}`}
            >
              <div className="encoding-row-head">
                <span className="encoding-field">
                  {FIELD_LABELS[issue.field]}
                </span>
                <span className="encoding-path" title={issue.path}>
                  {issue.path}
                </span>
              </div>
              <div className="encoding-values">
                <span className="encoding-before">{issue.before}</span>
                <span className="encoding-arrow">→</span>
                <span className="encoding-after">{issue.after}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            disabled={busy || issues.length === 0}
          >
            <Wrench size={14} />
            {busy
              ? "Исправляю…"
              : `Исправить ${issues.length} ${pluralRu(issues.length, [
                  "поле",
                  "поля",
                  "полей",
                ])}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
