import type { CSSProperties } from "react";
import {
  Bell,
  BellRing,
  FolderPlus,
  Image,
  Info,
  Play,
  RotateCcw,
  Sun,
  Trash2,
  Volume2,
} from "lucide-react";
import { ScanButton } from "../components/ScanButton";
import { errorText } from "../lib/errors";
import { api, backgroundUrl, pickFolder, pickImage } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import {
  NOTIFICATION_SOUND_OPTIONS,
  playNotificationSound,
} from "../lib/notificationSound";
import { formatBytes, formatDate, trackCountLabel } from "../lib/format";
import { useConfirmStore } from "../store/confirm";
import { useLibraryStore, visibleTracks } from "../store/library";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { Theme } from "../types";

const THEMES: Array<{
  id: Theme;
  name: string;
  description: string;
  colors: [string, string, string];
}> = [
  {
    id: "nocturne",
    name: "Nocturne",
    description: "Тёплое золото на глубоком графите",
    colors: ["#0b0b0d", "#d9a441", "#f1eee7"],
  },
  {
    id: "ice",
    name: "Лёд",
    description: "Холодный циан, синие тени и стекло",
    colors: ["#071018", "#66d9ff", "#e9f7ff"],
  },
  {
    id: "fire",
    name: "Огонь",
    description: "Раскалённый янтарь и тлеющий уголь",
    colors: ["#150806", "#ff7a3d", "#ffece4"],
  },
  {
    id: "ash",
    name: "Пепел",
    description: "Серый вулканический пепел и медь",
    colors: ["#0e1010", "#c9a37b", "#e7e3dc"],
  },
  {
    id: "cyberpunk",
    name: "Киберпанк",
    description: "Неоновая магента в фиолетовой ночи",
    colors: ["#090012", "#ff4fd8", "#f5e9ff"],
  },
];

export function Settings() {
  const tracks = useLibraryStore((state) => state.tracks);
  const folders = useLibraryStore((state) => state.folders);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const removeFolder = useLibraryStore((state) => state.removeFolder);
  const notify = useUiStore((state) => state.notify);
  const confirm = useConfirmStore((state) => state.confirm);

  const appBackground = useSettingsStore((state) => state.appBackground);
  const nowBackground = useSettingsStore((state) => state.nowBackground);
  const backgroundDim = useSettingsStore((state) => state.backgroundDim);
  const setAppBackground = useSettingsStore((state) => state.setAppBackground);
  const setNowBackground = useSettingsStore((state) => state.setNowBackground);
  const setBackgroundDim = useSettingsStore((state) => state.setBackgroundDim);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const autoplayOnStart = useSettingsStore((state) => state.autoplayOnStart);
  const setAutoplayOnStart = useSettingsStore(
    (state) => state.setAutoplayOnStart,
  );
  const autoScan = useSettingsStore((state) => state.autoScan);
  const setAutoScan = useSettingsStore((state) => state.setAutoScan);
  const notificationSound = useSettingsStore(
    (state) => state.notificationSound,
  );
  const setNotificationSound = useSettingsStore(
    (state) => state.setNotificationSound,
  );
  const notificationVolume = useSettingsStore(
    (state) => state.notificationVolume,
  );
  const setNotificationVolume = useSettingsStore(
    (state) => state.setNotificationVolume,
  );

  const visible = visibleTracks(tracks);
  const totalSize = visible.reduce((sum, track) => sum + track.size, 0);

  const handleAddFolder = async () => {
    try {
      const path = await pickFolder();
      if (!path) {
        notify(
          isAndroid
            ? "Выбор отменён"
            : "Выбор папки доступен в приложении Nova",
          "info",
        );
        return;
      }
      await addFolder(path);
    } catch (error) {
      notify(errorText(error), "error");
    }
  };

  const chooseBackground = async (kind: "app" | "now") => {
    try {
      const path = await pickImage();
      if (!path) {
        notify(
          isAndroid
            ? "Выбор отменён"
            : "Выбор изображения доступен в приложении Nova",
          "info",
        );
        return;
      }
      const stored = await api.setBackground(kind, path);
      if (kind === "app") setAppBackground(stored);
      else setNowBackground(stored);
      notify("Фон обновлён", "success");
    } catch (error) {
      notify(errorText(error), "error");
    }
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
          <p className="page-sub">Папки, оформление, звук и плеер</p>
        </div>
        <div className="head-actions">
          <ScanButton />
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
                      void confirm({
                        title: "Убрать папку?",
                        message:
                          "Убрать папку из библиотеки Nova? Файлы останутся на диске.",
                        confirmLabel: "Убрать папку",
                      }).then((confirmed) => {
                        if (confirmed) void removeFolder(folder.id);
                      });
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
            <strong>
              <Sun size={16} className="settings-slider-icon" />
              Затемнение фона
            </strong>
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
          <div className="settings-range-labels">
            <span>0%</span>
            <span>80%</span>
          </div>
        </div>
        <div className="theme-section">
          <div className="settings-row-main">
            <strong>Тема оформления</strong>
            <span>Выберите настроение интерфейса</span>
          </div>
          <div className="theme-grid">
            {THEMES.map((option) => (
              <button
                key={option.id}
                className={`theme-card${theme === option.id ? " is-active" : ""}`}
                onClick={() => setTheme(option.id)}
                style={
                  {
                    "--theme-card-bg": option.colors[0],
                    "--theme-card-accent": option.colors[1],
                    "--theme-card-ink": option.colors[2],
                  } as CSSProperties
                }
              >
                <span
                  className="theme-preview"
                  data-theme-preview={option.id}
                >
                  <i />
                  <b />
                  <em />
                </span>
                <span className="theme-card-text">
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Уведомления</h2>
        </div>
        <div className="notification-sounds">
          {NOTIFICATION_SOUND_OPTIONS.map((option) => (
            <div
              className={`notification-sound${
                notificationSound === option.id ? " is-selected" : ""
              }`}
              key={option.id}
            >
              <button
                className="notification-sound-main"
                onClick={() => setNotificationSound(option.id)}
              >
                <Bell size={15} />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
              <button
                className="icon-button"
                onClick={() =>
                  playNotificationSound(option.id, notificationVolume)
                }
                disabled={option.id === "off"}
                title="Послушать"
                aria-label="Послушать звук"
              >
                <Play size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="settings-row slider-row">
          <div className="settings-row-main">
            <strong>
              <Volume2 size={16} className="settings-slider-icon" />
              Громкость звука
            </strong>
            <span>Не влияет на громкость музыки</span>
          </div>
          <input
            className="range settings-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={notificationVolume}
            onChange={(event) =>
              setNotificationVolume(Number(event.target.value))
            }
          />
          <span className="settings-value">
            {Math.round(notificationVolume * 100)}%
          </span>
          <div className="settings-range-labels">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
        <div className="settings-inline">
          <BellRing size={15} />
          <button
            className="ghost-button"
            onClick={() =>
              notify("Nova: так выглядит уведомление в теме приложения", "success")
            }
          >
            Проверить уведомление
          </button>
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
            <strong>Хранилище</strong>
            <span>
              {trackCountLabel(visible.length)} · {formatBytes(totalSize)}
            </span>
          </div>
          <span className="settings-value">локально</span>
        </div>
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
