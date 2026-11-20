import { Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { formatBytes } from "../lib/format";
import { useUpdateStore } from "../store/update";
import { Modal } from "./Modal";

export function UpdateModal() {
  const open = useUpdateStore((state) => state.open);
  const info = useUpdateStore((state) => state.info);
  const status = useUpdateStore((state) => state.status);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const close = useUpdateStore((state) => state.close);
  const downloadAndInstall = useUpdateStore(
    (state) => state.downloadAndInstall,
  );
  const install = useUpdateStore((state) => state.install);

  if (!info) return null;

  const percent =
    progress && progress.total > 0
      ? Math.min(100, (progress.downloaded / progress.total) * 100)
      : status === "downloading"
        ? 0
        : 100;
  const busy = status === "downloading" || status === "installing";

  return (
    <Modal
      open={open}
      onClose={close}
      title="Обновление Nova"
      subtitle={`Версия ${info.version} · ${formatBytes(info.size)}`}
      size="md"
    >
      <div className="update-modal">
        {status === "checking" ? (
          <div className="update-loading">
            <Loader2 size={17} className="spin" />
            Проверяю обновления…
          </div>
        ) : status === "downloading" ? (
          <div className="update-progress">
            <div className="update-progress-head">
              <span>Скачиваю обновление…</span>
              <strong>{Math.round(percent)}%</strong>
            </div>
            <div className="update-progress-track">
              <span style={{ width: `${percent}%` }} />
            </div>
            <small>{formatBytes(progress?.downloaded ?? 0)}</small>
          </div>
        ) : status === "installing" ? (
          <div className="update-loading">
            <Loader2 size={17} className="spin" />
            Открываю установщик Android…
          </div>
        ) : status === "permission" ? (
          <div className="update-permission">
            <ShieldCheck size={18} />
            <p>
              Android не разрешает Nova устанавливать APK. Разрешите установку
              из Nova в настройках и нажмите «Повторить установку».
            </p>
          </div>
        ) : error ? (
          <div className="update-error">
            <p>{error}</p>
          </div>
        ) : null}

        {info.notes ? (
          <div className="update-notes">
            <strong>Что нового</strong>
            <pre>{info.notes}</pre>
          </div>
        ) : null}

        {info.sha256 ? (
          <p className="update-hash">
            SHA-256: <code>{info.sha256}</code>
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="ghost-button" onClick={close} disabled={busy}>
            Позже
          </button>
          {status === "permission" ? (
            <button
              className="primary-button"
              onClick={() => void install()}
              disabled={busy}
            >
              <RefreshCw size={14} />
              Повторить установку
            </button>
          ) : status === "error" ? (
            <button
              className="primary-button"
              onClick={() => void downloadAndInstall()}
              disabled={busy}
            >
              <RefreshCw size={14} />
              Повторить
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={() => void downloadAndInstall()}
              disabled={busy}
            >
              <Download size={14} />
              Скачать и установить
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
