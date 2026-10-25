import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Music2,
  Pause,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { formatDuration, trackCountLabel } from "../lib/format";
import { api, openExternal } from "../lib/tauri";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { useLibraryStore } from "../store/library";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { ImportPlaylist, ImportTrack } from "../types";

const SOURCES = [
  "Deezer",
  "YouTube",
  "Прямые аудио-ссылки",
  "Spotify",
  "Apple Music",
  "Яндекс Музыка",
  "VK Музыка",
];

export function Import() {
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const ytdlpPath = useSettingsStore((state) => state.ytdlpPath);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const scan = useLibraryStore((state) => state.scan);
  const notify = useUiStore((state) => state.notify);
  const { items, setProgress } = useDownloadProgress();

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlist, setPlaylist] = useState<ImportPlaylist | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      previewAudio?.pause();
    };
  }, [previewAudio]);

  const resolve = async (target?: string) => {
    const value = (target ?? url).trim();
    if (!value) return;
    setLoading(true);
    setPlaylist(null);
    try {
      const result = await api.resolvePlaylist(value, ytdlpPath);
      setPlaylist(result);
      setSelected(new Set(result.tracks.map((_, index) => index)));
      notify(
        `Найдено ${trackCountLabel(result.tracks.length)} в «${result.title}»`,
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось разобрать ссылку",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const toggle = (index: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const playPreview = (index: number, track: ImportTrack) => {
    if (!track.previewUrl) return;
    if (previewing === index) {
      previewAudio?.pause();
      setPreviewing(null);
      return;
    }
    previewAudio?.pause();
    const audio = new Audio(track.previewUrl);
    audio.volume = 0.8;
    void audio.play();
    audio.onended = () => setPreviewing(null);
    setPreviewAudio(audio);
    setPreviewing(index);
  };

  const downloadOne = async (index: number, track: ImportTrack) => {
    const id = `import-${index}-${Date.now()}`;
    setProgress({
      id,
      percent: 0,
      line: `Подготовка: ${track.artist} — ${track.title}`,
      status: "starting",
      path: null,
      error: null,
    });
    const isYoutube = playlist?.source === "YouTube";
    try {
      const result = await api.downloadMedia({
        id,
        url: track.downloadUrl || track.sourceUrl,
        query: isYoutube ? undefined : track.query,
        outputDir: downloadDir,
        ytdlpPath,
      });
      setProgress({
        id,
        percent: 100,
        line: `Готово: ${track.title}`,
        status: "done",
        path: result.path,
        error: null,
      });
      return result;
    } catch (error) {
      if (track.previewUrl) {
        setProgress({
          id,
          percent: 0,
          line: "Полный трек недоступен — качаю превью",
          status: "starting",
          path: null,
          error: null,
        });
        const result = await api.downloadDirect({
          id,
          url: track.previewUrl,
          outputDir: downloadDir,
          fileName: `${track.artist} - ${track.title} (preview)`,
        });
        setProgress({
          id,
          percent: 100,
          line: `Превью: ${track.title}`,
          status: "done",
          path: result.path,
          error: null,
        });
        return result;
      }
      const message =
        error instanceof Error ? error.message : "Ошибка загрузки";
      setProgress({
        id,
        percent: 0,
        line: message,
        status: "error",
        path: null,
        error: message,
      });
      return null;
    }
  };

  const downloadSelected = async () => {
    if (!playlist || selected.size === 0) return;
    setDownloading(true);
    let directory: string | null = null;
    let succeeded = 0;
    for (const index of [...selected].sort((a, b) => a - b)) {
      const track = playlist.tracks[index];
      if (!track) continue;
      const result = await downloadOne(index, track);
      if (result) {
        succeeded += 1;
        directory = result.directory;
      }
    }
    if (directory) {
      await addFolder(directory);
    } else {
      await scan();
    }
    setDownloading(false);
    notify(
      succeeded > 0
        ? `Загружено ${succeeded} из ${selected.size}`
        : "Ни один трек не удалось загрузить",
      succeeded > 0 ? "success" : "error",
    );
  };

  if (playlist) {
    const selectedCount = selected.size;
    return (
      <div className="page">
        <button className="back-button" onClick={() => setPlaylist(null)}>
          <ChevronLeft size={16} />
          Импорт
        </button>

        <header className="page-head import-result-head">
          <div>
            <p className="page-date">Источник: {playlist.source}</p>
            <h1 className="serif">{playlist.title}</h1>
            <p className="page-sub">
              {trackCountLabel(playlist.tracks.length)} · выбрано{" "}
              {selectedCount}
            </p>
          </div>
          <div className="head-actions">
            <button
              className="ghost-button"
              onClick={() =>
                setSelected(new Set(playlist.tracks.map((_, index) => index)))
              }
            >
              Выбрать все
            </button>
            <button className="ghost-button" onClick={() => setSelected(new Set())}>
              Снять все
            </button>
            <button
              className="primary-button"
              onClick={() => void downloadSelected()}
              disabled={downloading || selectedCount === 0}
            >
              {downloading ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Download size={15} />
              )}
              Скачать выбранные ({selectedCount})
            </button>
          </div>
        </header>

        <div className="import-confirm-note">
          <ShieldCheck size={17} />
          <div>
            <strong>Сначала список — потом загрузка</strong>
            <p>
              Снимите галочки с ненужных песен. Полный трек скачивается через
              yt-dlp; если источник недоступен, Nova сохранит легальное превью
              30 секунд.
            </p>
          </div>
        </div>

        <div className="import-track-list">
          <div className="import-track-head">
            <span />
            <span>Трек</span>
            <span>Альбом</span>
            <span>Время</span>
            <span>Источник</span>
            <span>Статус</span>
          </div>
          {playlist.tracks.map((track, index) => {
            const isSelected = selected.has(index);
            const progress = Object.values(items).find((item) =>
              item.id.startsWith(`import-${index}-`),
            );
            return (
              <div
                className={`import-track${isSelected ? " is-selected" : ""}`}
                key={`${track.title}-${index}`}
                onClick={() => toggle(index)}
              >
                <span className="import-check">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(index)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </span>
                <span className="import-track-main">
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <span className="import-track-album">{track.album || "—"}</span>
                <span className="import-track-duration">
                  {formatDuration(track.durationMs)}
                </span>
                <span className="import-source">
                  {track.previewUrl ? (
                    <button
                      className={`icon-button tiny${previewing === index ? " is-active" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        playPreview(index, track);
                      }}
                      aria-label="Прослушать превью"
                    >
                      {previewing === index ? (
                        <Pause size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                    </button>
                  ) : null}
                  <em>{playlist.source}</em>
                  <button
                    className="icon-button tiny"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openExternal(track.sourceUrl || track.downloadUrl || "");
                    }}
                    aria-label="Открыть источник"
                  >
                    <ExternalLink size={12} />
                  </button>
                </span>
                <span className="import-status">
                  {progress ? (
                    progress.status === "done" ? (
                      <span className="status-done">Готово</span>
                    ) : progress.status === "error" ? (
                      <span className="status-error">Ошибка</span>
                    ) : (
                      <span>
                        <Loader2 size={12} className="spin" />
                        {Math.round(progress.percent)}%
                      </span>
                    )
                  ) : isSelected ? (
                    "Выбран"
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="import-actions-foot">
          <span>
            {downloadDir
              ? `Папка: ${downloadDir}`
              : "Папка по умолчанию: данные приложения / downloads"}
          </span>
          <button
            className="primary-button"
            onClick={() => void downloadSelected()}
            disabled={downloading || selectedCount === 0}
          >
            <Download size={15} />
            Скачать выбранные ({selectedCount})
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Ссылки из других приложений</p>
          <h1 className="serif">Импорт плейлиста</h1>
          <p className="page-sub">
            Вставьте ссылку — Nova покажет список треков и спросит, что скачать
          </p>
        </div>
      </header>

      <div className="import-hero">
        <div className="import-input-row">
          <Link2 size={17} />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.deezer.com/playlist/… или https://youtube.com/playlist?list=…"
            onKeyDown={(event) => {
              if (event.key === "Enter") void resolve();
            }}
          />
          <button
            className="primary-button"
            onClick={() => void resolve()}
            disabled={loading || !url.trim()}
          >
            {loading ? <Loader2 size={15} className="spin" /> : null}
            Разобрать
          </button>
        </div>
        <div className="import-supported">
          {SOURCES.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </div>

      <div className="steps-grid">
        <article className="step-card">
          <span className="step-number">1</span>
          <h3 className="serif">Ссылка</h3>
          <p>
            Deezer и YouTube разбираются без ключей. Spotify, Apple, Яндекс и VK
            требуют API-ключей или авторизации.
          </p>
        </article>
        <article className="step-card">
          <span className="step-number">2</span>
          <h3 className="serif">Список</h3>
          <p>
            Nova покажет название, исполнителя и длительность. Галочками можно
            выбрать отдельные песни или весь список.
          </p>
        </article>
        <article className="step-card">
          <span className="step-number">3</span>
          <h3 className="serif">Загрузка</h3>
          <p>
            Полный трек — через yt-dlp, превью — напрямую. Файлы попадают в
            папку загрузок и в библиотеку.
          </p>
        </article>
      </div>

      <div className="import-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Без обхода DRM</strong>
          <p>
            Spotify, Apple Music, Яндекс и VK используются для метаданных и
            сопоставления. Аудио скачивается из источников, которые вы
            добавили сами, и только для контента, на который у вас есть права.
          </p>
        </div>
        <Check size={18} />
      </div>

      <div className="import-preview">
        <Music2 size={16} />
        <span>
          Хотите проверить без ссылки? Нажмите «Разобрать» с пустым полем — в
          демо-режиме появится пример списка.
        </span>
        <button
          className="ghost-button"
          onClick={() => {
            setUrl("demo://playlist");
            void resolve("demo://playlist");
          }}
        >
          Демо-список
        </button>
      </div>
    </div>
  );
}
