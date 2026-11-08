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
import { errorText } from "../lib/errors";
import { isDirectDownloadUrl } from "../lib/download";
import { pickBestCandidate } from "../lib/match";
import { api, openExternal } from "../lib/tauri";
import { DuplicateDownloadModal } from "../components/DuplicateDownloadModal";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { findDuplicateTrack, useLibraryStore } from "../store/library";
import { registerDownloadDone } from "../store/downloads";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type {
  DownloadProgress,
  DownloadTask,
  ImportPlaylist,
  ImportTrack,
  Track,
} from "../types";

type ConflictMode = "skip" | "replace" | "keep";

const SOURCES = [
  "Deezer",
  "YouTube",
  "Яндекс Музыка",
  "Прямые аудио-ссылки",
];

export function Import() {
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const ytdlpPath = useSettingsStore((state) => state.ytdlpPath);
  const tracks = useLibraryStore((state) => state.tracks);
  const deleteTrack = useLibraryStore((state) => state.deleteTrack);
  const notify = useUiStore((state) => state.notify);
  const { items, history, setProgress, enqueue, recordFailure } =
    useDownloadProgress();

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlist, setPlaylist] = useState<ImportPlaylist | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictAnchor, setConflictAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);

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
      notify(errorText(error), "error");
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

  /** Shared task fields for every source resolution. */
  const baseTask = (
    id: string,
    track: ImportTrack,
  ): Omit<DownloadTask, "kind" | "url" | "query" | "fileName"> => ({
    id,
    outputDir: downloadDir,
    expectedArtist: track.artist,
    expectedTitle: track.title,
    title: `${track.artist} – ${track.title}`,
  });

  const directTask = (
    id: string,
    track: ImportTrack,
    url: string,
    fileName?: string | null,
  ): DownloadTask => ({
    ...baseTask(id, track),
    kind: "direct",
    url,
    query: null,
    fileName:
      fileName === undefined
        ? `${track.artist} - ${track.title}`
        : fileName,
  });

  const ytdlpTask = (
    id: string,
    track: ImportTrack,
    url: string,
    query?: string | null,
  ): DownloadTask => ({
    ...baseTask(id, track),
    kind: "ytdlp",
    url,
    query: query ?? null,
    fileName: null,
  });

  const primaryTask = (id: string, track: ImportTrack): DownloadTask | null => {
    const target = track.downloadUrl || track.sourceUrl;
    if (!target) return null;
    if (isDirectDownloadUrl(target)) return directTask(id, track, target);
    const isYoutube = playlist?.source === "YouTube";
    return ytdlpTask(id, track, target, isYoutube ? null : track.query);
  };

  const providerTask = async (
    id: string,
    track: ImportTrack,
  ): Promise<DownloadTask | null> => {
    try {
      const found = await api.searchMedia(track.query, 8);
      const candidate = pickBestCandidate(
        {
          artist: track.artist,
          title: track.title,
          durationMs: track.durationMs,
        },
        found,
      );
      if (!candidate) return null;
      if (candidate.downloadUrl) {
        return directTask(id, track, candidate.downloadUrl);
      }
      if (candidate.webpageUrl) {
        return ytdlpTask(id, track, candidate.webpageUrl, candidate.query);
      }
    } catch {
      // Fall through to the original source.
    }
    return null;
  };

  /** Adds an optimistic queue row, persists the task and wires replacement. */
  const enqueueImportTask = async (
    index: number,
    id: string,
    track: ImportTrack,
    task: DownloadTask | null,
    existing: Track | undefined,
    mode: ConflictMode,
  ): Promise<boolean> => {
    const title = `${track.artist} – ${track.title}`;
    const retry = () => {
      void retryImportTrack(index, track, existing, mode);
    };

    if (!task) {
      const message = "Не удалось найти источник для скачивания";
      await recordFailure(id, title, message, retry);
      return false;
    }

    setProgress({
      id,
      percent: 0,
      line: `В очереди: ${title}`,
      status: "queued",
      path: null,
      error: null,
      order: Date.now(),
      title,
      kind: task.kind,
      cancellable: true,
      retry,
    });

    try {
      await enqueue(task);
      if (mode === "replace" && existing) {
        registerDownloadDone(id, () => {
          void deleteTrack(existing.id, true);
        });
      }
      return true;
    } catch (error) {
      const message = errorText(error);
      await recordFailure(id, title, message, retry);
      return false;
    }
  };

  const retryImportTrack = async (
    index: number,
    track: ImportTrack,
    existing: Track | undefined,
    mode: ConflictMode,
  ) => {
    const id = `import-${index}-${Date.now()}-retry`;
    setProgress({
      id,
      percent: 0,
      line: `Ищу источник: ${track.artist} – ${track.title}`,
      status: "starting",
      path: null,
      error: null,
      order: Date.now(),
      title: `${track.artist} – ${track.title}`,
    });

    // Retry follows the 2B-1 fallback chain: provider search, then a legal
    // preview, then the original playlist source.
    let task = await providerTask(id, track);
    if (!task && track.previewUrl) {
      task = directTask(
        id,
        track,
        track.previewUrl,
        `${track.artist} - ${track.title} (preview)`,
      );
    }
    if (!task) task = primaryTask(id, track);
    await enqueueImportTask(index, id, track, task, existing, mode);
  };

  const queueSelectedTrack = async (
    index: number,
    track: ImportTrack,
    duplicate: Track | undefined,
    mode: ConflictMode,
  ): Promise<boolean> => {
    const id = `import-${index}-${Date.now()}`;
    let task: DownloadTask | null = null;
    // Yandex pages often need the provider search first (same as 2B-1).
    if (playlist?.source === "Яндекс Музыка") {
      task = await providerTask(id, track);
    }
    if (!task) task = primaryTask(id, track);
    return enqueueImportTask(index, id, track, task, duplicate, mode);
  };

  const duplicateMap = (): Map<number, Track> => {
    const duplicates = new Map<number, Track>();
    if (!playlist) return duplicates;
    for (const index of selected) {
      const track = playlist.tracks[index];
      if (!track) continue;
      const existing = findDuplicateTrack(tracks, track.artist, track.title);
      if (existing) duplicates.set(index, existing);
    }
    return duplicates;
  };

  const requestDownloadSelected = (
    anchor: { x: number; y: number } | null = null,
  ) => {
    if (!playlist || selected.size === 0) return;
    const duplicates = duplicateMap();
    if (duplicates.size > 0) {
      setConflictCount(duplicates.size);
      setConflictAnchor(anchor);
      setConflictOpen(true);
      return;
    }
    void runDownloadSelected("keep");
  };

  const runDownloadSelected = async (mode: ConflictMode) => {
    if (!playlist || selected.size === 0) return;
    setDownloading(true);
    const duplicates = duplicateMap();
    let queued = 0;
    let skipped = 0;

    for (const index of [...selected].sort((a, b) => a - b)) {
      const track = playlist.tracks[index];
      if (!track) continue;
      if (mode === "skip" && duplicates.has(index)) {
        skipped += 1;
        continue;
      }
      if (await queueSelectedTrack(index, track, duplicates.get(index), mode)) {
        queued += 1;
      } else {
        skipped += 1;
      }
    }

    setDownloading(false);
    notify(
      queued > 0
        ? `Добавлено в очередь: ${queued} из ${selected.size}${
            skipped > 0 ? `, пропущено ${skipped}` : ""
          }`
        : "Ни один трек не удалось поставить в очередь",
      queued > 0 ? "success" : "error",
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
              onClick={(event) =>
                requestDownloadSelected({
                  x: event.clientX,
                  y: event.clientY,
                })
              }
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
            <strong>Сначала список – потом загрузка</strong>
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
            // Active rows live in `items`; finished rows are in the native
            // history. Prefer an active retry over an older terminal record.
            const progress = Object.values(items)
              .filter((item) => item.id.startsWith(`import-${index}-`))
              .reduce<DownloadProgress | undefined>(
                (newest, item) =>
                  !newest || (item.order ?? 0) >= (newest.order ?? 0)
                    ? item
                    : newest,
                undefined,
              );
            const finished = history
              .filter((entry) => entry.id.startsWith(`import-${index}-`))
              .sort((a, b) => b.finishedAt - a.finishedAt)[0];
            const shown = progress
              ? { status: progress.status, percent: progress.percent }
              : finished
                ? {
                    status: finished.status,
                    percent: finished.status === "done" ? 100 : 0,
                  }
                : undefined;
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
                <span className="import-track-album">{track.album || "–"}</span>
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
                  {shown ? (
                    shown.status === "done" ? (
                      <span className="status-done">Готово</span>
                    ) : shown.status === "error" ||
                      shown.status === "cancelled" ? (
                      <span className="status-error">
                        {shown.status === "cancelled" ? "Отменено" : "Ошибка"}
                      </span>
                    ) : shown.status === "queued" ? (
                      <span className="status-queued">В очереди</span>
                    ) : shown.status === "starting" ? (
                      <span className="status-queued">Подготовка</span>
                    ) : (
                      <span className="import-progress-status">
                        <span>
                          <Loader2 size={12} className="spin" />
                          {Math.round(shown.percent ?? 0)}%
                        </span>
                        <span className="import-mini-bar">
                          <i
                            style={{
                              width: `${Math.max(3, shown.percent ?? 0)}%`,
                            }}
                          />
                        </span>
                      </span>
                    )
                  ) : isSelected ? (
                    "Выбран"
                  ) : (
                    "–"
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
            onClick={(event) =>
              requestDownloadSelected({
                x: event.clientX,
                y: event.clientY,
              })
            }
            disabled={downloading || selectedCount === 0}
          >
            <Download size={15} />
            Скачать выбранные ({selectedCount})
          </button>
        </div>

        <DuplicateDownloadModal
          open={conflictOpen}
          title={`${conflictCount} ${trackCountLabel(conflictCount)} уже есть в библиотеке`}
          description="Среди выбранных треков есть уже знакомые песни. Можно пропустить их, заменить старые версии или скачать всё равно."
          anchor={conflictAnchor}
          onClose={() => setConflictOpen(false)}
          onSkip={() => {
            setConflictOpen(false);
            void runDownloadSelected("skip");
          }}
          onReplace={() => {
            setConflictOpen(false);
            void runDownloadSelected("replace");
          }}
          onKeepBoth={() => {
            setConflictOpen(false);
            void runDownloadSelected("keep");
          }}
        />
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
            Вставьте ссылку – Nova покажет список треков и спросит, что скачать
          </p>
        </div>
      </header>

      <div className="import-hero">
        <div className="import-input-row">
          <Link2 size={17} />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Deezer, YouTube или ссылка на плейлист Яндекс Музыки"
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
            Deezer, YouTube и публичные плейлисты Яндекс Музыки разбираются без
            ключей. Для одиночного видео YouTube достаточно ссылки youtu.be.
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
            Полный трек – через yt-dlp, превью – напрямую. Файлы попадают в
            папку загрузок и в библиотеку.
          </p>
        </article>
      </div>

      <div className="import-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Без обхода DRM</strong>
          <p>
            Яндекс Музыка используется только для списка треков. Аудио
            скачивается через yt-dlp или из источников, которые вы добавили
            сами, и только для контента, на который у вас есть права.
          </p>
        </div>
        <Check size={18} />
      </div>

      <div className="import-preview">
        <Music2 size={16} />
        <span>
          Хотите проверить без ссылки? Нажмите «Разобрать» с пустым полем – в
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
