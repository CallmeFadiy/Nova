import { AlertTriangle, Download, RefreshCw, X } from "lucide-react";
import { Modal } from "./Modal";

interface DuplicateDownloadModalProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onSkip: () => void;
  onReplace: () => void;
  onKeepBoth: () => void;
}

export function DuplicateDownloadModal({
  open,
  title,
  description,
  onClose,
  onSkip,
  onReplace,
  onKeepBoth,
}: DuplicateDownloadModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Трек уже есть"
      subtitle={title}
      size="sm"
    >
      <div className="duplicate-modal">
        <div className="duplicate-warning">
          <AlertTriangle size={18} />
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
          «Скачать всё равно» оставит обе версии в библиотеке.
        </p>
      </div>
    </Modal>
  );
}
