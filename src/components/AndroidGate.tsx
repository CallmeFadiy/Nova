import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import { useLibraryStore } from "../store/library";

type PermissionState = "checking" | "granted" | "denied";

interface Props {
  children: ReactNode;
}

const MUSIC_PATH = "/storage/emulated/0/Music";
let defaultFolderPromise: Promise<void> | null = null;
let notificationsRequested = false;

function ensureDefaultFolder(): Promise<void> {
  if (!defaultFolderPromise) {
    const { folders, addFolder } = useLibraryStore.getState();
    defaultFolderPromise = folders.some((folder) => folder.path === MUSIC_PATH)
      ? Promise.resolve()
      : addFolder(MUSIC_PATH);
  }
  return defaultFolderPromise;
}

export function AndroidGate({ children }: Props) {
  const [permission, setPermission] = useState<PermissionState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ensured = useRef(false);

  const check = async () => {
    if (!isAndroid) return;
    try {
      const state = await api.androidPermissionState();
      setPermission(state === "granted" ? "granted" : "denied");
      setError(null);
    } catch (reason) {
      setPermission("denied");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void check();
    if (!isAndroid) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (permission !== "granted" || ensured.current) return;
    ensured.current = true;
    void ensureDefaultFolder();
    if (!notificationsRequested) {
      notificationsRequested = true;
      void api.androidRequestNotifications();
    }
  }, [permission]);

  if (!isAndroid) return <>{children}</>;

  if (permission === "granted") return <>{children}</>;

  const requestAccess = async () => {
    setBusy(true);
    try {
      await api.androidOpenAllFilesSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="android-gate">
      <div className="android-gate-card">
        <div className="android-gate-icon">
          <ShieldAlert size={30} />
        </div>
        <p className="page-date">Доступ к библиотеке</p>
        <h1 className="serif">Разрешите доступ к музыке</h1>
        <p className="android-gate-copy">
          Nova читает файлы на устройстве и не загружает их в облако. Для
          сканирования, обложек и редактирования тегов нужен доступ ко всем
          файлам.
        </p>
        {error ? <p className="android-gate-error">{error}</p> : null}
        <div className="android-gate-actions">
          <button
            className="primary-button"
            onClick={() => void requestAccess()}
            disabled={busy}
          >
            <FolderOpen size={16} />
            {busy ? "Открываю настройки…" : "Разрешить доступ"}
          </button>
          <button
            className="secondary-button"
            onClick={() => void check()}
            disabled={busy}
          >
            <RefreshCw size={16} />
            Проверить снова
          </button>
          <Link className="ghost-button" to="/settings">
            Настройки
          </Link>
        </div>
        <p className="android-gate-hint">
          После включения «Все файлы» вернитесь в Nova — проверка произойдёт
          автоматически.
        </p>
      </div>
    </div>
  );
}
