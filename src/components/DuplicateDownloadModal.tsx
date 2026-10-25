import { AlertTriangle, Download, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface DuplicateDownloadModalProps {
  open: boolean;
  title: string;
  description: string;
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
  onSkip: () => void;
  onReplace: () => void;
  onKeepBoth: () => void;
}

export function DuplicateDownloadModal({
  open,
  title,
  description,
  anchor,
  onClose,
  onSkip,
  onReplace,
  onKeepBoth,
}: DuplicateDownloadModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const width = Math.min(420, window.innerWidth - 32);
  const left = anchor
    ? Math.max(16, Math.min(anchor.x - width + 28, window.innerWidth - width - 16))
    : Math.max(16, (window.innerWidth - width) / 2);
  const top = anchor
    ? Math.max(16, Math.min(anchor.y + 12, window.innerHeight - 330))
    : Math.max(16, window.innerHeight / 2 - 180);

  return createPortal(
    <div
      className="conflict-popover"
      role="dialog"
      aria-modal="false"
      aria-label="Трек уже есть"
      style={{ left, top, width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="conflict-popover-head">
        <div>
          <span className="eyebrow">Трек уже есть</span>
          <strong>{title}</strong>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="duplicate-warning">
        <AlertTriangle size={17} />
        <p>{description}</p>
      </div>
      <div className="duplicate-actions">
        <button className="secondary-button" onClick={onSkip}>
          <X size={14} />
          Не скачивать
        </button>
        <button className="primary-button" onClick={onReplace}>
          <RefreshCw size={14} />
          Скачать и заменить
        </button>
        <button className="ghost-button" onClick={onKeepBoth}>
          <Download size={14} />
          Скачать всё равно
        </button>
      </div>
      <p className="modal-note">
        «Скачать и заменить» скачает новую копию, а старый файл удалит.
        «Скачать всё равно» оставит обе версии.
      </p>
    </div>,
    document.body,
  );
}
