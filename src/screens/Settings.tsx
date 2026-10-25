import {
  Download,
  EyeOff,
  FolderPlus,
  Image,
  Info,
  Mic,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { api, backgroundUrl, pickFolder, pickImage } from "../lib/tauri";
import { formatBytes, formatDate, trackCountLabel } from "../lib/format";
import { useLibraryStore, visibleTracks } from "../store/library";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";

export function Settings() {
  const tracks = useLibraryStore((state) => state.tracks);
  const folders = useLibraryStore((state) => state.folders);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const removeFolder = useLibraryStore((state) => state.removeFolder);
  const restoreTrack = useLibraryStore((state) => state.restoreTrack);
  const notify = useUiStore((state) => state.notify);
  const setEqualizerOpen = useUiStore((state) => state.setEqualizerOpen);

  const appBackground = useSettingsStore((state) => state.appBackground);
  const nowBackground = useSettingsStore((state) => state.nowBackground);
  const backgroundDim = useSettingsStore((state) => state.backgroundDim);
  const setAppBackground = useSettingsStore((state) => state.setAppBackground);
  const setNowBackground = useSettingsStore((state) => state.setNowBackground);
  const setBackgroundDim = useSettingsStore((state) => state.setBackgroundDim);
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const setDownloadDir = useSettingsStore((state) => state.setDownloadDir);
  const ytdlpPath = useSettingsStore((state) => state.ytdlpPath);
  const setYtdlpPath = useSettingsStore((state) => state.setYtdlpPath);
  const shazamProvider = useSettingsStore((state) => state.shazamProvider);
  const setShazamProvider = useSettingsStore((state) => state.setShazamProvider);
  const shazamKey = useSettingsStore((state) => state.shazamKey);
  const setShazamKey = useSettingsStore((state) => state.setShazamKey);
  const autoplayOnStart = useSettingsStore((state) => state.autoplayOnStart);
  const setAutoplayOnStart = useSettingsStore((state) => state.setAutoplayOnStart);
  const autoScan = useSettingsStore((state) => state.autoScan);
  const setAutoScan = useSettingsStore((state) => state.setAutoScan);

  const visible = visibleTracks(tracks);
  const hidden = tracks.filter((track) => track.hidden);
  const totalSize = visible.reduce((sum, track) => sum + track.size, 0);

  const handleAddFolder = async () => {
    const path = await pickFolder();
    if (!path) {
      notify("Выбор папки доступен в приложении Nova", "info");
      return;
    }
    await addFolder(path);
  };

  const chooseBackground = async (kind: "app" | "now") => {
    const path = await pickImage();
    if (!path) {
      notify("Выбор изображения доступен в приложении Nova", "info");
      return;
    }
    const stored = await api.setBackground(kind, path);
    if (kind === "app") setAppBackground(stored);
    else setNowBackground(stored);
    notify("Фон обновлён", "success");
  };

  const resetBackground = async (kind: "app" | "now") => {
    await api.clearBackground(kind);
    if (kind === "app") setAppBackground(null);
    else setNowBackground(null);
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <p className="page-date">Nova · локальная музыка</p>
          <h1 className="serif">Настройки</h1>
          <p className="page-sub">Папки, оформление, звук и источники</p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Папки с музыкой</h2>
          <button className="primary-button" onClick={() => void handleAddFolder()}>
            <FolderPlus size={15} />
            Добавить папку
          </button>
        </div>
        <p className="settings-hint">
          Файлы читаются на месте и не копируются. Удаление папки из Nova не
          удаляет музыку с диска.
        </p>
        <div className="settings-list">
          {folders.map((folder) => {
            const count = visible.filter(
              (track) => track.folderId === folder.id,
            ).length;
            return (
              <div className="settings-row" key={folder.id}>
                <div className="settings-row-main">
                  <strong>{folder.path.split(/[\\/]/).pop()}</strong>
                  <span>{folder.path}</span>
                </div>
                <div className="settings-row-meta">
                  {trackCountLabel(count)}
                  <span>
                    {folder.lastScanAt
                      ? `Скан ${formatDate(folder.lastScanAt)}`
                      : "Не сканировалась"}
                  </span>
                </div>
                <div className="settings-row-actions">
                  <button
                    className="icon-button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Убрать папку из библиотеки? Файлы останутся на диске.",
                        )
                      ) {
                        void removeFolder(folder.id);
                      }
                    }}
                    aria-label="Убрать папку"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          {folders.length === 0 ? (
            <div className="settings-empty">
              Папок пока нет. Добавьте Music или любую другую папку.
            </div>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Оформление</h2>
        </div>
        <div className="settings-grid two">
          <div className="bg-card">
            <div className="bg-preview">
              {appBackground ? (
                <img src={backgroundUrl(appBackground) ?? ""} alt="" />
              ) : (
                <div className="bg-placeholder">
                  <Image size={20} />
                  <span>Фон приложения</span>
                </div>
              )}
            </div>
            <div className="bg-card-foot">
              <div>
                <strong>Фон приложения</strong>
                <span>За главным экраном и библиотекой</span>
              </div>
              <div className="bg-actions">
                <button
                  className="ghost-button"
                  onClick={() => void chooseBackground("app")}
                >
                  <Image size={14} />
                  Выбрать
                </button>
                {appBackground ? (
                  <button
                    className="icon-button"
                    onClick={() => void resetBackground("app")}
                    aria-label="Сбросить фон"
                  >
                    <RotateCcw size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-card">
            <div className="bg-preview">
              {nowBackground ? (
                <img src={backgroundUrl(nowBackground) ?? ""} alt="" />
              ) : (
                <div className="bg-placeholder">
                  <Image size={20} />
                  <span>Фон «Сейчас играет»</span>
                </div>
              )}
            </div>
            <div className="bg-card-foot">
              <div>
                <strong>Фон «Сейчас играет»</strong>
                <span>Большой экран текущего трека</span>
              </div>
              <div className="bg-actions">
                <button
                  className="ghost-button"
                  onClick={() => void chooseBackground("now")}
                >
                  <Image size={14} />
                  Выбрать
                </button>
                {nowBackground ? (
                  <button
                    className="icon-button"
                    onClick={() => void resetBackground("now")}
                    aria-label="Сбросить фон"
                  >
                    <RotateCcw size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-row slider-row">
          <div className="settings-row-main">
            <strong>Затемнение фона</strong>
            <span>Чтобы текст и обложка оставались читаемыми</span>
          </div>
          <input
            className="range settings-range"
            type="range"
            min={0}
            max={80}
            value={backgroundDim}
            onChange={(event) => setBackgroundDim(Number(event.target.value))}
          />
          <span className="settings-value">{backgroundDim}%</span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Воспроизведение</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <strong>Автоматически сканировать при запуске</strong>
            <span>Новые файлы появятся без ручного сканирования</span>
          </div>
          <button
            className={`toggle-button${autoScan ? " is-on" : ""}`}
            onClick={() => setAutoScan(!autoScan)}
          >
            {autoScan ? "Включено" : "Выключено"}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <strong>Автовоспроизведение при запуске</strong>
            <span>Продолжать последний трек сразу, а не по кнопке</span>
          </div>
          <button
            className={`toggle-button${autoplayOnStart ? " is-on" : ""}`}
            onClick={() => setAutoplayOnStart(!autoplayOnStart)}
          >
            {autoplayOnStart ? "Включено" : "Выключено"}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <strong>Эквалайзер</strong>
            <span>10 полос, встроенные и свои пресеты</span>
          </div>
          <button
            className="secondary-button"
            onClick={() => setEqualizerOpen(true)}
          >
            <SlidersHorizontal size={15} />
            Открыть
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <strong>Хранилище</strong>
            <span>
              {trackCountLabel(visible.length)} · {formatBytes(totalSize)}
            </span>
          </div>
          <span className="settings-value">локально</span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Загрузки и yt-dlp</h2>
          <span className="settings-badge">этап загрузок</span>
        </div>
        <p className="settings-hint">
          Скачивание работает только после подтверждения и только для
          контента, на который у вас есть права. Spotify и Apple Music
          используются для метаданных, без обхода DRM.
        </p>
        <div className="settings-field">
          <label>Папка загрузок</label>
          <input
            className="text-input"
            value={downloadDir}
            placeholder="По умолчанию: Downloads/Nova"
            onChange={(event) => setDownloadDir(event.target.value)}
          />
        </div>
        <div className="settings-field">
          <label>Путь к yt-dlp</label>
          <input
            className="text-input"
            value={ytdlpPath}
            placeholder="yt-dlp.exe или путь к нему"
            onChange={(event) => setYtdlpPath(event.target.value)}
          />
        </div>
        <div className="settings-inline">
          <Download size={15} />
          <span>
            Загрузчик подключается на следующем этапе. Настройки сохраняются
            локально.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Распознавание трека</h2>
          <span className="settings-badge">Shazam-совместимо</span>
        </div>
        <div className="settings-field">
          <label>Провайдер</label>
          <select
            className="select-input"
            value={shazamProvider}
            onChange={(event) =>
              setShazamProvider(
                event.target.value as typeof shazamProvider,
              )
            }
          >
            <option value="builtin">Встроенное распознавание</option>
            <option value="audd">AudD</option>
            <option value="acrcloud">ACRCloud</option>
          </select>
        </div>
        {shazamProvider !== "builtin" ? (
          <div className="settings-field">
            <label>API-ключ</label>
            <input
              className="text-input"
              type="password"
              value={shazamKey}
              placeholder="Ключ хранится только на этом устройстве"
              onChange={(event) => setShazamKey(event.target.value)}
            />
          </div>
        ) : null}
        <div className="settings-inline">
          <Mic size={15} />
          <span>
            Микрофон запрашивается только при нажатии «Распознать». Запись
            длится 8 секунд и не сохраняется.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Скрытые треки</h2>
          <span className="settings-badge">{hidden.length}</span>
        </div>
        <p className="settings-hint">
          Эти треки убраны из альбомов внутри Nova. Файлы на диске не тронуты.
        </p>
        {hidden.length === 0 ? (
          <div className="settings-empty">
            <EyeOff size={15} /> Скрытых треков нет.
          </div>
        ) : (
          <div className="settings-list">
            {hidden.map((track) => (
              <div className="settings-row" key={track.id}>
                <div className="settings-row-main">
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => void restoreTrack(track.id)}
                >
                  <Undo2 size={14} />
                  Восстановить
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section about-section">
        <img src="/icon.png" alt="" className="about-icon" />
        <div>
          <h2 className="serif">Nova</h2>
          <p>Локальный медиаплеер для Windows и Android.</p>
          <span>
            Версия 0.1.0 · Tauri 2 · музыка остаётся на устройстве
          </span>
        </div>
        <Info size={18} className="about-info" />
      </section>
    </div>
  );
}
