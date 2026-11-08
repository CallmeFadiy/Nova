import {
  ExternalLink,
  FileText,
  Loader2,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatOffset,
  hasTimestamps,
  parseLyrics,
  serializeLyrics,
  type TimedLyricLine,
} from "../lib/lyrics";
import { api, openExternal } from "../lib/tauri";
import { useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import type { LyricsResult } from "../types";
import { Modal } from "./Modal";

function offsetKey(fileName: string): string {
  return `nova.lyrics.offset.${fileName}`;
}

export function LyricsModal() {
  const trackId = useUiStore((state) => state.lyricsTrackId);
  const openLyrics = useUiStore((state) => state.openLyrics);
  const notify = useUiStore((state) => state.notify);
  const tracks = useLibraryStore((state) => state.tracks);
  const track = tracks.find((item) => item.id === trackId) ?? null;
  const currentId = usePlayerStore((state) => state.currentId);
  const positionMs = usePlayerStore((state) => state.positionMs);

  const [result, setResult] = useState<LyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [lines, setLines] = useState<TimedLyricLine[]>([]);
  const [offsetMs, setOffsetMs] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (trackId === null) {
      setResult(null);
      setError(null);
      setMode("view");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    void api
      .getLyrics(trackId)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    if (!result) {
      setLines([]);
      return;
    }
    setLines(parseLyrics(result.text));
    const saved = Number(
      window.localStorage.getItem(offsetKey(result.fileName)) ?? 0,
    );
    setOffsetMs(Number.isFinite(saved) ? saved : 0);
    setMode("view");
  }, [result?.fileName, result?.text]);

  const timed = hasTimestamps(lines);
  const trackIsCurrent = trackId !== null && currentId === trackId;

  const activeIndex = useMemo(() => {
    if (!trackIsCurrent) return -1;
    let active = -1;
    lines.forEach((line, index) => {
      if (
        line.timeMs !== null &&
        line.timeMs <= positionMs + offsetMs
      ) {
        active = index;
      }
    });
    return active;
  }, [lines, offsetMs, positionMs, trackIsCurrent]);

  useEffect(() => {
    if (mode !== "view" || !autoScroll || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIndex, autoScroll, mode]);

  const close = () => openLyrics(null);

  const changeOffset = (delta: number) => {
    if (!result) return;
    setOffsetMs((previous) => {
      const next = previous + delta;
      window.localStorage.setItem(offsetKey(result.fileName), String(next));
      return next;
    });
  };

  const stampLine = (index: number) => {
    if (!trackIsCurrent) {
      notify("Сначала включите этот трек", "info");
      return;
    }
    const time = Math.max(0, positionMs - offsetMs);
    setLines((previous) =>
      previous.map((line, lineIndex) =>
        lineIndex === index ? { ...line, timeMs: time } : line,
      ),
    );
  };

  const clearLineTime = (index: number) => {
    setLines((previous) =>
      previous.map((line, lineIndex) =>
        lineIndex === index ? { ...line, timeMs: null } : line,
      ),
    );
  };

  const updateLineText = (index: number, text: string) => {
    setLines((previous) =>
      previous.map((line, lineIndex) =>
        lineIndex === index ? { ...line, text } : line,
      ),
    );
  };

  const cancelEditing = () => {
    if (result) setLines(parseLyrics(result.text));
    setMode("view");
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const text = serializeLyrics(lines);
      await api.saveLyrics(result.fileName, text);
      setResult({ ...result, text, cached: true });
      setMode("view");
      notify("Текст синхронизирован", "success");
    } catch (reason) {
      notify(
        reason instanceof Error ? reason.message : "Не удалось сохранить текст",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const playTrack = () => {
    if (!track) return;
    usePlayerStore.getState().playTrackById(track.id, true);
  };

  return (
    <Modal
      open={trackId !== null}
      onClose={close}
      title="Текст песни"
      subtitle={
        result
          ? `${result.artist} – ${result.title}`
          : track
            ? `${track.artist} – ${track.title}`
            : undefined
      }
      size="lg"
    >
      <div className="lyrics-modal">
        {loading ? (
          <div className="lyrics-loading">
            <Loader2 size={18} className="spin" />
            <span>Ищу текст…</span>
          </div>
        ) : error ? (
          <div className="lyrics-empty">
            <FileText size={20} />
            <strong>Текст не найден</strong>
            <p>{error}</p>
            <p className="lyrics-hint">
              Проверьте подключение к интернету. Можно открыть текст на Genius и
              сохранить его вручную в файл с именем трека в папке данных
              приложения.
            </p>
          </div>
        ) : result ? (
          <>
            <div className="lyrics-toolbar">
              <span>
                <FileText size={14} />
                {result.cached
                  ? "Из кэша"
                  : result.sourceUrl?.includes("lrclib")
                    ? "Загружено с LRCLIB"
                    : "Загружено с Genius"}
              </span>
              <span className="lyrics-path" title={result.path}>
                {result.fileName}
              </span>
              {timed ? (
                <div className="lyrics-offset">
                  <button
                    className="icon-button tiny"
                    onClick={() => changeOffset(-500)}
                    title="Сдвинуть раньше на 0,5 с"
                  >
                    <Minus size={12} />
                  </button>
                  <span>{formatOffset(offsetMs)}</span>
                  <button
                    className="icon-button tiny"
                    onClick={() => changeOffset(500)}
                    title="Сдвинуть позже на 0,5 с"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              ) : null}
              {mode === "view" ? (
                <>
                  {timed ? (
                    <label className="lyrics-autoscroll">
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(event) => setAutoScroll(event.target.checked)}
                      />
                      Автоскролл
                    </label>
                  ) : null}
                  <button
                    className="ghost-button"
                    onClick={() => setMode("edit")}
                  >
                    <Pencil size={13} />
                    {timed ? "Править" : "Синхронизировать"}
                  </button>
                  {result.sourceUrl ? (
                    <button
                      className="ghost-button"
                      onClick={() => void openExternal(result.sourceUrl ?? "")}
                    >
                      <ExternalLink size={13} />
                      {result.sourceUrl?.includes("lrclib") ? "LRCLIB" : "Genius"}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button className="ghost-button" onClick={cancelEditing}>
                    <X size={13} />
                    Отмена
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void save()}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Save size={13} />
                    )}
                    Сохранить
                  </button>
                </>
              )}
            </div>

            {mode === "view" ? (
              timed ? (
                <div className="lyrics-synced">
                  {lines.map((line, index) => (
                    <div
                      key={line.id}
                      ref={index === activeIndex ? activeRef : null}
                      className={`lyrics-line${
                        index === activeIndex ? " is-active" : ""
                      }`}
                    >
                      {line.text || "\u00a0"}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="lyrics-text">{result.text}</pre>
              )
            ) : (
              <div className="lyrics-editor">
                <div className="lyrics-editor-hint">
                  {trackIsCurrent ? (
                    <span>
                      Играет сейчас: {Math.floor(positionMs / 1000)} с. Нажмите
                      «Время», чтобы привязать строку к текущей позиции.
                    </span>
                  ) : (
                    <>
                      <span>Трек не играет – время привязать не получится.</span>
                      <button className="text-button" onClick={playTrack}>
                        <Play size={12} />
                        Включить трек
                      </button>
                    </>
                  )}
                </div>
                <div className="lyrics-editor-list">
                  {lines.map((line, index) => (
                    <div className="lyrics-editor-row" key={line.id}>
                      <button
                        className="lyrics-time-button"
                        onClick={() => stampLine(index)}
                        title="Поставить текущее время"
                      >
                        {line.timeMs === null ? (
                          <ClockPlaceholder />
                        ) : (
                          formatEditorTime(line.timeMs)
                        )}
                      </button>
                      <input
                        className="lyrics-line-input"
                        value={line.text}
                        onChange={(event) =>
                          updateLineText(index, event.target.value)
                        }
                        placeholder="Строка текста"
                      />
                      {line.timeMs !== null ? (
                        <button
                          className="icon-button tiny"
                          onClick={() => clearLineTime(index)}
                          title="Убрать время"
                          aria-label="Убрать время"
                        >
                          <RotateCcw size={12} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function ClockPlaceholder() {
  return <span className="lyrics-time-empty">–</span>;
}

function formatEditorTime(timeMs: number): string {
  const total = Math.max(0, Math.floor(timeMs));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(centiseconds).padStart(2, "0")}`;
}
