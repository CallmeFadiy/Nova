import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Volume2,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDuration } from "../lib/format";
import { errorText } from "../lib/errors";
import { isDirectDownloadUrl } from "../lib/download";
import {
  api,
  openExternal,
  pickFolder,
  revealInFolder,
} from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import { DuplicateDownloadModal } from "../components/DuplicateDownloadModal";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { findDuplicateTrack, useLibraryStore } from "../store/library";
import {
  clearDownloadCancelled,
  isDownloadCancelled,
  markDownloadCancelled,
} from "../store/downloads";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { DownloadResult, MediaCandidate, Track } from "../types";

export function Downloads() {
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const setDownloadDir = useSettingsStore((state) => state.setDownloadDir);
  const ytdlpPath = useSettingsStore((state) => state.ytdlpPath);
  const addFolder = useLibraryStore((state) => state.addFolder);
  const scan = useLibraryStore((state) => state.scan);
  const tracks = useLibraryStore((state) => state.tracks);
  const deleteTrack = useLibraryStore((state) => state.deleteTrack);
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const seedQuery = searchParams.get("q") ?? "";
  const {
    items,
    pending,
    paused,
    history,
    setProgress,
    pauseQueue,
    resumeQueue,
    cancelQueued,
    removeDownload,
    moveQueued,
    clearHistory,
  } = useDownloadProgress();

  const [query, setQuery] = useState(seedQuery);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MediaCandidate[]>([]);
  const [link, setLink] = useState("");
  const [startingLink, setStartingLink] = useState(false);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    candidate: MediaCandidate;
    existing: Track;
    anchor: { x: number; y: number } | null;
  } | null>(null);

  useEffect(() => {
    return () => {
      previewAudio?.pause();
    };
  }, [previewAudio]);

  const search = async (target?: string) => {
    const value = (target ?? query).trim();
    if (!value) return;
    setSearching(true);
    setResults([]);
    try {
      const found = await api.searchMedia(value, 20);
      setResults(found);
      if (found.length === 0) notify("Ничего не найдено", "info");
    } catch (error) {
      notify(errorText(error), "error");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!seedQuery) return;
    setQuery(seedQuery);
    void search(seedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery]);

  const playPreview = (candidate: MediaCandidate) => {
    if (!candidate.previewUrl) return;
    if (previewing === candidate.id) {
      previewAudio?.pause();
      setPreviewing(null);
      return;
    }
    previewAudio?.pause();
    const audio = new Audio(candidate.previewUrl);
    audio.volume = 0.8;
    void audio.play();
    audio.onended = () => setPreviewing(null);
    setPreviewAudio(audio);
    setPreviewing(candidate.id);
  };

  const finishDownload = async (id: string, result: DownloadResult) => {
    if (isDownloadCancelled(id)) return;
    setProgress({
      id,
      percent: 100,
      line: "Готово",
      status: "done",
      path: result.path,
      error: null,
    });
    if (result.directory) {
      await addFolder(result.directory);
    } else {
      await scan();
    }
    notify(`Скачано: ${result.title}`, "success");
  };

  const cancelDownload = async (id: string) => {
    // Mark before awaiting the command: the in-flight promise rejects while the
    // cancellation is still travelling through the plugin.
    markDownloadCancelled(id);
    try {
      const cancelled = await api.cancelDownload(id);
      if (!cancelled) {
        clearDownloadCancelled(id);
        notify("Эту загрузку нельзя отменить", "info");
        return;
      }
    } catch (error) {
      clearDownloadCancelled(id);
      notify(errorText(error), "error");
      return;
    }
    removeDownload(id);
    notify("Загрузка отменена", "info");
  };

  const chooseDownloadDir = async () => {
    try {
      const path = await pickFolder("Выбрать папку загрузок");
      if (!path) {
        notify(
          isAndroid
            ? "Выбор отменён"
            : "Выбор папки доступен в приложении Nova",
          "info",
        );
        return;
      }
      setDownloadDir(path);
      notify("Папка загрузок обновлена", "success");
    } catch (error) {
      notify(errorText(error), "error");
    }
  };

  const requestCandidate = (
    candidate: MediaCandidate,
    anchor: { x: number; y: number } | null = null,
  ) => {
    const existing = findDuplicateTrack(
      tracks,
      candidate.artist,
      candidate.title,
    );
    if (existing) {
      setConflict({ candidate, existing, anchor });
      return;
    }
    void startCandidate(candidate);
  };

  const startCandidate = async (
    candidate: MediaCandidate,
    replace?: Track | null,
  ) => {
    const id = `${candidate.id}-${Date.now()}`;
    clearDownloadCancelled(id);
    setProgress({
      id,
      percent: 0,
      line: `Подготовка: ${candidate.artist} – ${candidate.title} (${candidate.quality})`,
      status: "starting",
      path: null,
      error: null,
      order: Date.now(),
      title: `${candidate.artist} – ${candidate.title}`,
      // Direct downloads run in Rust and cannot be stopped by the plugin.
      cancellable: !candidate.downloadUrl,
    });
    try {
      const result = candidate.downloadUrl
        ? await api.downloadDirect({
            id,
            url: candidate.downloadUrl,
            outputDir: downloadDir,
            fileName: `${candidate.artist} - ${candidate.title}`,
            expectedArtist: candidate.artist,
            expectedTitle: candidate.title,
          })
        : await api.downloadMedia({
            id,
            url: candidate.webpageUrl || "",
            query: candidate.query,
            outputDir: downloadDir,
            ytdlpPath,
            expectedArtist: candidate.artist,
            expectedTitle: candidate.title,
          });
      await finishDownload(id, result);
      if (replace) {
        await deleteTrack(replace.id, true);
      }
    } catch (error) {
      if (isDownloadCancelled(id)) return;
      if (
        candidate.downloadUrl &&
        candidate.webpageUrl &&
        candidate.webpageUrl !== candidate.downloadUrl
      ) {
        try {
          setProgress({
            id,
            percent: 0,
            line: "Прямая ссылка не сработала – пробую yt-dlp…",
            status: "starting",
            path: null,
            error: null,
            cancellable: true,
          });
          const result = await api.downloadMedia({
            id,
            url: candidate.webpageUrl,
            query: candidate.query,
            outputDir: downloadDir,
            ytdlpPath,
            expectedArtist: candidate.artist,
            expectedTitle: candidate.title,
          });
          await finishDownload(id, result);
          return;
        } catch {
          // show the original direct-download error below
          if (isDownloadCancelled(id)) return;
        }
      }
      if (isDownloadCancelled(id)) return;
      const message = errorText(error);
      setProgress({
        id,
        percent: 0,
        line: message,
        status: "error",
        path: null,
        error: message,
        title: `${candidate.artist} – ${candidate.title}`,
        retry: () => {
          clearDownloadCancelled(id);
          void startCandidate(candidate, replace);
        },
      });
      notify(message, "error");
    }
  };

  const downloadLink = async () => {
    const target = link.trim();
    if (!target) return;
    setStartingLink(true);
    const id = `link-${Date.now()}`;
    clearDownloadCancelled(id);
    const direct = isDirectDownloadUrl(target);
    const isZaycevPage = /zaycev\.net\/pages\/[^/]+\/\d+\.shtml/i.test(
      target,
    );
    setProgress({
      id,
      percent: 0,
      line: "Подготовка загрузки…",
      status: "starting",
      path: null,
      error: null,
      order: Date.now(),
      title: target,
      // Direct links (audio file / Zaycev page) go through Rust and cannot be
      // cancelled; only the yt-dlp branch is stoppable.
      cancellable: !direct,
    });
    try {
      const result =
        direct || isZaycevPage
          ? await api.downloadDirect({
              id,
              url: target,
              outputDir: downloadDir,
              fileName: isZaycevPage
                ? undefined
                : (target.split("/").pop()?.split("?")[0] ?? "track"),
            })
          : await api.downloadMedia({
              id,
              url: target,
              outputDir: downloadDir,
              ytdlpPath,
            });
      await finishDownload(id, result);
      setLink("");
    } catch (error) {
      if (isDownloadCancelled(id)) return;
      const message = errorText(error);
      setProgress({
        id,
        percent: 0,
        line: message,
        status: "error",
        path: null,
        error: message,
        title: target,
        retry: () => {
          void downloadLink();
        },
      });
      notify(message, "error");
    } finally {
      setStartingLink(false);
    }
  };

  const statusRank: Record<string, number> = {
    downloading: 0,
    starting: 1,
    queued: 2,
    error: 3,
    done: 4,
  };
  const downloads = Object.values(items)
    .filter(
      (item) =>
        item.status === "queued" ||
        item.status === "starting" ||
        item.status === "downloading",
    )
    .sort(
      (a, b) =>
        (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Поиск, ссылки, yt-dlp</p>
          <h1 className="serif">Загрузки</h1>
          <p className="page-sub">
            Скачивание только после подтверждения. Прямые источники и yt-dlp,
            лучший доступный битрейт.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => navigate("/settings")}
        >
          <Settings2 size={15} />
          Настройки
        </button>
      </header>

      <div className="download-dir-row">
        <FolderOpen size={15} />
        <div>
          <strong>Папка загрузок</strong>
          <span>{downloadDir || "По умолчанию: данные приложения / downloads"}</span>
        </div>
        <button className="ghost-button" onClick={() => void chooseDownloadDir()}>
          Изменить
        </button>
      </div>

      <section className="download-link-card">
        <div className="download-link-head">
          <div>
            <h2 className="serif">Скачать по ссылке</h2>
            <p>Прямой аудиофайл или страница, которую понимает yt-dlp</p>
          </div>
        </div>
        <div className="download-link-row">
          <input
            className="text-input"
            placeholder="https://…"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void downloadLink();
            }}
          />
          <button
            className="primary-button"
            onClick={() => void downloadLink()}
            disabled={startingLink || !link.trim()}
          >
            {startingLink ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Download size={15} />
            )}
            Скачать
          </button>
        </div>
      </section>

      <section className="download-search-card">
        <div className="download-search-head">
          <div>
            <h2 className="serif">Найти и скачать</h2>
            <p>
              Название песни или исполнитель · zaycev.net · muzofond.fm ·
              ru.drivemusic.me
            </p>
          </div>
        </div>
        <div className="download-search-row">
          <Search size={16} />
          <input
            placeholder="Например, Norma Tale – Ван Хельсинг"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <button
            className="primary-button"
            onClick={() => void search()}
            disabled={searching || !query.trim()}
          >
            {searching ? <Loader2 size={15} className="spin" /> : null}
            Найти
          </button>
        </div>

        {results.length > 0 ? (
          <div className="media-results">
            {results.map((candidate) => (
              <article className="media-result" key={candidate.id}>
                <div className="media-art">
                  {candidate.artworkUrl ? (
                    <img src={candidate.artworkUrl} alt="" loading="lazy" />
                  ) : (
                    <Music2 size={20} />
                  )}
                </div>
                <div className="media-info">
                  <strong>{candidate.title}</strong>
                  <span>
                    {candidate.artist}
                    {candidate.album ? ` · ${candidate.album}` : ""}
                  </span>
                  <em>
                    {formatDuration(candidate.durationMs)} · {candidate.quality}{" "}
                    · {candidate.source}
                  </em>
                </div>
                <div className="media-actions">
                  {candidate.previewUrl ? (
                    <button
                      className={`icon-button${previewing === candidate.id ? " is-active" : ""}`}
                      onClick={() => playPreview(candidate)}
                      title="Прослушать превью"
                    >
                      {previewing === candidate.id ? (
                        <Pause size={15} />
                      ) : (
                        <Volume2 size={15} />
                      )}
                    </button>
                  ) : null}
                  {candidate.webpageUrl ? (
                    <button
                      className="icon-button"
                      onClick={() => void openExternal(candidate.webpageUrl)}
                      title="Открыть источник"
                    >
                      <ExternalLink size={14} />
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    onClick={(event) =>
                      requestCandidate(candidate, {
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }
                  >
                    <Download size={14} />
                    Скачать
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="download-search-empty">
            <Search size={18} />
            <span>
              Введите название или исполнителя. Nova найдёт варианты на трёх
              сайтах и поставит лучший доступный битрейт первым.
            </span>
          </div>
        )}
      </section>

      <section className="downloads-list-section">
        <div className="section-head downloads-section-head">
          <div className="downloads-tabs">
            <button
              className={tab === "active" ? "is-active" : ""}
              onClick={() => setTab("active")}
            >
              <Download size={13} />
              Текущие
              <span>{downloads.length}</span>
            </button>
            <button
              className={tab === "history" ? "is-active" : ""}
              onClick={() => setTab("history")}
            >
              <History size={13} />
              История
              <span>{history.length}</span>
            </button>
          </div>
          <div className="downloads-head-actions">
            {tab === "active" && pending.length > 0 ? (
              <button
                className="ghost-button"
                onClick={paused ? resumeQueue : pauseQueue}
                title={
                  paused
                    ? "Продолжить очередь"
                    : "Приостановить очередь после текущей загрузки"
                }
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
                {paused ? "Продолжить" : "Пауза очереди"}
              </button>
            ) : null}
            {tab === "history" && history.length > 0 ? (
              <button className="text-button" onClick={clearHistory}>
                Очистить
              </button>
            ) : null}
          </div>
        </div>

        {tab === "active" ? (
          downloads.length === 0 ? (
            <div className="downloads-empty small">
              <Download size={20} />
              <p>Сейчас ничего не скачивается.</p>
            </div>
          ) : (
            <div className="download-list">
              {downloads.map((item) => {
                const pendingIndex = pending.indexOf(item.id);
                return (
                  <div className="download-row" key={item.id}>
                    <div
                      className={`download-status download-status-${item.status}`}
                    >
                      {item.status === "queued" ? (
                        <Clock3 size={14} />
                      ) : (
                        <Loader2 size={14} className="spin" />
                      )}
                    </div>
                    <div className="download-info">
                      <strong>{item.line || "Загрузка"}</strong>
                      <div className="download-bar">
                        <span
                          style={{
                            width: `${
                              item.status === "queued"
                                ? 0
                                : Math.max(2, item.percent)
                            }%`,
                          }}
                        />
                      </div>
                      <small>
                        {item.status === "queued"
                          ? "ждёт очереди"
                          : item.status === "starting"
                            ? "поиск источника"
                            : `${Math.round(item.percent)}%`}
                      </small>
                    </div>
                    {item.status === "queued" && pendingIndex >= 0 ? (
                      <div className="download-row-actions">
                        <button
                          className="icon-button tiny"
                          onClick={() => moveQueued(item.id, -1)}
                          disabled={pendingIndex === 0}
                          title="Выше"
                          aria-label="Выше"
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          className="icon-button tiny"
                          onClick={() => moveQueued(item.id, 1)}
                          disabled={pendingIndex === pending.length - 1}
                          title="Ниже"
                          aria-label="Ниже"
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          className="icon-button tiny danger"
                          onClick={() => cancelQueued(item.id)}
                          title="Отменить"
                          aria-label="Отменить"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : isAndroid &&
                      item.cancellable &&
                      (item.status === "starting" ||
                        item.status === "downloading") ? (
                      <div className="download-row-actions">
                        <button
                          className="icon-button tiny danger"
                          onClick={() => void cancelDownload(item.id)}
                          title="Отменить загрузку"
                          aria-label="Отменить загрузку"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : history.length === 0 ? (
          <div className="downloads-empty small">
            <History size={20} />
            <p>История загрузок пуста.</p>
          </div>
        ) : (
          <div className="download-list">
            {history.map((entry) => (
              <div className="download-row" key={entry.id}>
                <div
                  className={`download-status download-status-${entry.status}`}
                >
                  {entry.status === "done" ? (
                    <Download size={14} />
                  ) : (
                    <Pause size={14} />
                  )}
                </div>
                <div className="download-info">
                  <strong>{entry.title}</strong>
                  <small>{entry.status === "done" ? entry.path : entry.error}</small>
                  <div className="download-history-meta">
                    <span>
                      {new Date(entry.finishedAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="download-row-actions">
                      {entry.path ? (
                        <button
                          className="text-button"
                          onClick={() => void revealInFolder(entry.path ?? "")}
                        >
                          <FolderOpen size={12} />
                          Открыть папку
                        </button>
                      ) : null}
                      {entry.retry ? (
                        <button
                          className="text-button"
                          onClick={() => entry.retry?.()}
                        >
                          <RefreshCw size={12} />
                          Повторить
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="downloads-info">
        <div>
          <strong>Качество</strong>
          <p>
            Если сайт предлагает несколько вариантов, Nova автоматически
            выбирает лучший доступный битрейт. yt-dlp также настроен на
            максимальное качество аудио.
          </p>
        </div>
        <div>
          <strong>Папка загрузок</strong>
          <p>{downloadDir || "По умолчанию: данные приложения / downloads"}</p>
        </div>
        <div>
          <strong>Без автоматики</strong>
          <p>
            Ничего не скачивается без нажатия. Файл попадает в библиотеку
            только после завершения.
          </p>
        </div>
      </div>

      {previewAudio ? (
        <button
          className="preview-stop"
          onClick={() => {
            previewAudio.pause();
            setPreviewAudio(null);
            setPreviewing(null);
          }}
        >
          <Play size={12} />
          Остановить превью
        </button>
      ) : null}

      <DuplicateDownloadModal
        open={Boolean(conflict)}
        title={
          conflict
            ? `${conflict.existing.artist} – ${conflict.existing.title}`
            : ""
        }
        description="Эта песня уже есть в вашей библиотеке. Что сделать с новой загрузкой?"
        anchor={conflict?.anchor ?? null}
        onClose={() => setConflict(null)}
        onSkip={() => setConflict(null)}
        onReplace={() => {
          if (!conflict) return;
          const current = conflict;
          setConflict(null);
          void startCandidate(current.candidate, current.existing);
        }}
        onKeepBoth={() => {
          if (!conflict) return;
          const current = conflict;
          setConflict(null);
          void startCandidate(current.candidate);
        }}
      />
    </div>
  );
}
