import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  Settings2,
  Volume2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDuration, pluralRu } from "../lib/format";
import { api, openExternal, pickFolder } from "../lib/tauri";
import { DuplicateDownloadModal } from "../components/DuplicateDownloadModal";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { findDuplicateTrack, useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
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
  const { items, setProgress } = useDownloadProgress();

  const [query, setQuery] = useState(seedQuery);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MediaCandidate[]>([]);
  const [link, setLink] = useState("");
  const [startingLink, setStartingLink] = useState(false);
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
      notify(
        error instanceof Error ? error.message : "Не удалось выполнить поиск",
        "error",
      );
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

  const chooseDownloadDir = async () => {
    const path = await pickFolder("Выбрать папку загрузок");
    if (!path) {
      notify("Выбор папки доступен в приложении Nova", "info");
      return;
    }
    setDownloadDir(path);
    notify("Папка загрузок обновлена", "success");
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
    setProgress({
      id,
      percent: 0,
      line: `Подготовка: ${candidate.artist} – ${candidate.title} (${candidate.quality})`,
      status: "starting",
      path: null,
      error: null,
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
        if (usePlayerStore.getState().currentId === replace.id) {
          usePlayerStore.getState().clearQueue();
        }
        await deleteTrack(replace.id, true);
      }
    } catch (error) {
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
        }
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
      notify(message, "error");
    }
  };

  const downloadLink = async () => {
    if (!link.trim()) return;
    setStartingLink(true);
    const id = `link-${Date.now()}`;
    setProgress({
      id,
      percent: 0,
      line: "Подготовка загрузки…",
      status: "starting",
      path: null,
      error: null,
    });
    try {
      const isDirectAudio = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)(\?|$)/i.test(
        link.trim(),
      );
      const isZaycevPage = /zaycev\.net\/pages\/[^/]+\/\d+\.shtml/i.test(
        link.trim(),
      );
      const result =
        isDirectAudio || isZaycevPage
          ? await api.downloadDirect({
              id,
              url: link.trim(),
              outputDir: downloadDir,
              fileName: isZaycevPage
                ? undefined
                : (link.split("/").pop()?.split("?")[0] ?? "track"),
            })
          : await api.downloadMedia({
              id,
              url: link.trim(),
              outputDir: downloadDir,
              ytdlpPath,
            });
      await finishDownload(id, result);
      setLink("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось скачать по ссылке";
      setProgress({
        id,
        percent: 0,
        line: message,
        status: "error",
        path: null,
        error: message,
      });
      notify(message, "error");
    } finally {
      setStartingLink(false);
    }
  };

  const downloads = Object.values(items)
    .filter(
      (item) => item.status === "starting" || item.status === "downloading",
    )
    .sort((a, b) => a.id.localeCompare(b.id));

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
        <div className="section-head">
          <h3 className="serif">Текущие загрузки</h3>
          <span className="section-link">
            {downloads.length > 0
              ? `${downloads.length} ${pluralRu(downloads.length, [
                  "задача",
                  "задачи",
                  "задач",
                ])}`
              : "нет активных"}
          </span>
        </div>
        {downloads.length === 0 ? (
          <div className="downloads-empty small">
            <Download size={20} />
            <p>Сейчас ничего не скачивается.</p>
          </div>
        ) : (
          <div className="download-list">
            {downloads.map((item) => (
              <div className="download-row" key={item.id}>
                <div
                  className={`download-status download-status-${item.status}`}
                >
                  {item.status === "done" ? (
                    <Download size={14} />
                  ) : item.status === "error" ? (
                    <Pause size={14} />
                  ) : (
                    <Loader2 size={14} className="spin" />
                  )}
                </div>
                <div className="download-info">
                  <strong>{item.line || "Загрузка"}</strong>
                  <div className="download-bar">
                    <span style={{ width: `${Math.max(2, item.percent)}%` }} />
                  </div>
                  <small>
                    {item.status === "done"
                      ? item.path
                      : item.status === "error"
                        ? item.error
                        : `${Math.round(item.percent)}%`}
                  </small>
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
