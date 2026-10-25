import { useEffect, useState, type CSSProperties } from "react";
import {
  Download,
  EyeOff,
  Bell,
  BellRing,
  Copy,
  FileText,
  FolderOpen,
  FolderPlus,
  Headphones,
  Image,
  Info,
  Mic,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { ScanButton } from "../components/ScanButton";
import { api, backgroundUrl, pickFolder, pickImage } from "../lib/tauri";
import {
  NOTIFICATION_SOUND_OPTIONS,
  playNotificationSound,
} from "../lib/notificationSound";
import { formatBytes, formatDate, trackCountLabel } from "../lib/format";
import { DuplicateTracksModal } from "../components/DuplicateTracksModal";
import { useConfirmStore } from "../store/confirm";
import {
  findDuplicateGroups,
  useLibraryStore,
  visibleTracks,
  type DuplicateTrackGroup,
} from "../store/library";
import { usePlayerStore } from "../store/player";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { LyricsFile, Theme } from "../types";

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
  const restoreTrack = useLibraryStore((state) => state.restoreTrack);
  const notify = useUiStore((state) => state.notify);
  const setEqualizerOpen = useUiStore((state) => state.setEqualizerOpen);
  const confirm = useConfirmStore((state) => state.confirm);

  const appBackground = useSettingsStore((state) => state.appBackground);
  const nowBackground = useSettingsStore((state) => state.nowBackground);
  const backgroundDim = useSettingsStore((state) => state.backgroundDim);
  const setAppBackground = useSettingsStore((state) => state.setAppBackground);
  const setNowBackground = useSettingsStore((state) => state.setNowBackground);
  const setBackgroundDim = useSettingsStore((state) => state.setBackgroundDim);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const setDownloadDir = useSettingsStore((state) => state.setDownloadDir);
  const ytdlpPath = useSettingsStore((state) => state.ytdlpPath);
  const setYtdlpPath = useSettingsStore((state) => state.setYtdlpPath);
  const shazamProvider = useSettingsStore((state) => state.shazamProvider);
  const setShazamProvider = useSettingsStore((state) => state.setShazamProvider);
  const shazamKey = useSettingsStore((state) => state.shazamKey);
  const setShazamKey = useSettingsStore((state) => state.setShazamKey);
  const recognitionSource = useSettingsStore(
    (state) => state.recognitionSource,
  );
  const setRecognitionSource = useSettingsStore(
    (state) => state.setRecognitionSource,
  );
  const autoplayOnStart = useSettingsStore((state) => state.autoplayOnStart);
  const setAutoplayOnStart = useSettingsStore((state) => state.setAutoplayOnStart);
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

  const [lyricsFiles, setLyricsFiles] = useState<LyricsFile[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(true);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateTrackGroup[]>(
    [],
  );
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateScanning, setDuplicateScanning] = useState(false);
  const deleteTracks = useLibraryStore((state) => state.deleteTracks);

  const visible = visibleTracks(tracks);
  const hidden = tracks.filter((track) => track.hidden);
  const totalSize = visible.reduce((sum, track) => sum + track.size, 0);

  const refreshLyrics = async () => {
    setLyricsLoading(true);
    try {
      setLyricsFiles(await api.listLyrics());
    } catch {
      setLyricsFiles([]);
    } finally {
      setLyricsLoading(false);
    }
  };

  useEffect(() => {
    void refreshLyrics();
  }, []);

  const chooseDownloadDir = async () => {
    const path = await pickFolder("Выбрать папку загрузок");
    if (!path) {
      notify("Выбор папки доступен в приложении Nova", "info");
      return;
    }
    setDownloadDir(path);
    notify("Папка загрузок обновлена", "success");
  };

  const removeLyricsFile = async (fileName: string) => {
    try {
      await api.deleteLyrics(fileName);
      await refreshLyrics();
      notify("Текст удалён из кэша", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось удалить текст",
        "error",
      );
    }
  };

  const checkDuplicates = async () => {
    if (duplicateScanning) return;
    const candidates = findDuplicateGroups(tracks);
    if (candidates.length === 0) {
      notify("Дубликаты не найдены", "success");
      return;
    }

    setDuplicateScanning(true);
    try {
      const hashes = await api.hashTracks(
        candidates.flatMap((group) => group.tracks.map((track) => track.id)),
      );
      const groups = findDuplicateGroups(tracks, hashes);
      if (groups.length === 0) {
        notify(
          "Совпадения по тегам оказались разными записями – дубликатов нет",
          "success",
        );
        return;
      }
      setDuplicateGroups(groups);
      setDuplicateOpen(true);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Не удалось проверить содержимое файлов",
        "error",
      );
    } finally {
      setDuplicateScanning(false);
    }
  };

  const removeDuplicates = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (
      usePlayerStore.getState().currentId !== null &&
      ids.includes(usePlayerStore.getState().currentId as number)
    ) {
      usePlayerStore.getState().clearQueue();
    }
    setDuplicateBusy(true);
    const result = await deleteTracks(ids, true);
    setDuplicateBusy(false);
    if (result) {
      setDuplicateOpen(false);
      setDuplicateGroups([]);
    }
  };

  const clearLyricsCache = async () => {
    if (
      !(await confirm({
        title: "Очистить тексты?",
        message:
          "Удалить все сохранённые тексты песен? Файлы музыки не затрагиваются.",
        confirmLabel: "Очистить",
        tone: "danger",
      }))
    ) {
      return;
    }
    try {
      const removed = await api.clearLyrics();
      await refreshLyrics();
      notify(`Удалено текстов: ${removed}`, "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось очистить кэш",
        "error",
      );
    }
  };

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
                <span className="theme-preview">
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
          <span className="settings-badge">
            <BellRing size={12} /> в приложении
          </span>
        </div>
        <p className="settings-hint">
          Уведомления появляются внутри Nova, в стиле приложения, а не как
          системные окна Windows. Выберите звук и послушайте каждый вариант.
        </p>
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
            <strong>Громкость звука</strong>
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
          контента, на который у вас есть права. Поиск идёт по zaycev.net,
          muzofond.fm и ru.drivemusic.me; yt-dlp используется как резервный
          загрузчик.
        </p>
        <div className="settings-field">
          <label>Папка загрузок</label>
          <div className="settings-field-row">
            <input
              className="text-input"
              value={downloadDir}
              placeholder="По умолчанию: данные приложения / downloads"
              onChange={(event) => setDownloadDir(event.target.value)}
            />
            <button
              className="secondary-button"
              onClick={() => void chooseDownloadDir()}
            >
              <FolderOpen size={15} />
              Выбрать
            </button>
          </div>
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
            yt-dlp всегда выбирает лучший доступный аудиопоток. Настройки
            сохраняются локально.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Тексты песен</h2>
          <div className="settings-section-actions">
            <span className="settings-badge">{lyricsFiles.length}</span>
            {lyricsFiles.length > 0 ? (
              <button
                className="ghost-button"
                onClick={() => void clearLyricsCache()}
              >
                <Trash2 size={14} />
                Очистить всё
              </button>
            ) : null}
          </div>
        </div>
        <p className="settings-hint">
          Текст ищется на genius.com по полному названию трека и исполнителя, а
          затем сохраняется в файл с именем трека в папке данных Nova. При
          следующем открытии используется кэш.
        </p>
        {lyricsLoading ? (
          <div className="settings-empty">Читаем кэш текстов…</div>
        ) : lyricsFiles.length === 0 ? (
          <div className="settings-empty">
            <FileText size={15} /> Сохранённых текстов пока нет.
          </div>
        ) : (
          <div className="settings-list">
            {lyricsFiles.map((file) => (
              <div className="settings-row" key={file.fileName}>
                <div className="settings-row-main">
                  <strong>{file.title}</strong>
                  <span title={file.path}>{file.fileName}</span>
                </div>
                <div className="settings-row-meta">
                  <span>{formatBytes(file.size)}</span>
                  <span>{file.modified ? formatDate(file.modified) : ""}</span>
                </div>
                <div className="settings-row-actions">
                  <button
                    className="icon-button"
                    onClick={() => void removeLyricsFile(file.fileName)}
                    aria-label="Удалить текст"
                    title="Удалить текст"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        <div className="settings-field">
          <label>Как Nova должна слышать</label>
          <div className="recognition-source-switch settings-source-switch">
            <button
              className={recognitionSource === "microphone" ? "active" : ""}
              onClick={() => setRecognitionSource("microphone")}
            >
              <Mic size={14} />
              Микрофон
            </button>
            <button
              className={recognitionSource === "system" ? "active" : ""}
              onClick={() => setRecognitionSource("system")}
            >
              <Headphones size={14} />
              Системные динамики
            </button>
          </div>
        </div>
        <div className="settings-inline">
          <Mic size={15} />
          <span>
            {recognitionSource === "system"
              ? "Nova захватывает звук текущего устройства вывода Windows через WASAPI loopback. Запись длится 12 секунд и не сохраняется."
              : "Микрофон запрашивается только при нажатии «Распознать». Запись длится 12 секунд и не сохраняется."}
          </span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2 className="serif">Дубликаты треков</h2>
          <button
            className="secondary-button"
            onClick={() => void checkDuplicates()}
            disabled={duplicateScanning}
          >
            <Copy size={15} />
            {duplicateScanning ? "Сверяю содержимое…" : "Проверить дубликаты"}
          </button>
        </div>
        <p className="settings-hint">
          Ручная проверка: Nova сначала ищет совпадения по исполнителю и
          названию, затем сверяет SHA-1 содержимого файлов. В одну группу
          попадают только реально одинаковые записи. Вы сами отмечаете, какие
          копии удалить, а какие оставить.
        </p>
        <div className="settings-inline">
          <Copy size={15} />
          <span>
            Проверка запускается только по кнопке. Обычное сканирование ничего
            не удаляет.
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

      <DuplicateTracksModal
        open={duplicateOpen}
        groups={duplicateGroups}
        busy={duplicateBusy}
        onClose={() => setDuplicateOpen(false)}
        onConfirm={(ids) => void removeDuplicates(ids)}
      />
    </div>
  );
}
