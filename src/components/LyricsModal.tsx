import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, openExternal } from "../lib/tauri";
import { useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import type { LyricsResult } from "../types";
import { Modal } from "./Modal";

export function LyricsModal() {
  const trackId = useUiStore((state) => state.lyricsTrackId);
  const openLyrics = useUiStore((state) => state.openLyrics);
  const tracks = useLibraryStore((state) => state.tracks);
  const track = tracks.find((item) => item.id === trackId) ?? null;

  const [result, setResult] = useState<LyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (trackId === null) {
      setResult(null);
      setError(null);
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

  const close = () => openLyrics(null);

  return (
    <Modal
      open={trackId !== null}
      onClose={close}
      title="Текст песни"
      subtitle={
        result
          ? `${result.artist} — ${result.title}`
          : track
            ? `${track.artist} — ${track.title}`
            : undefined
      }
      size="lg"
    >
      <div className="lyrics-modal">
        {loading ? (
          <div className="lyrics-loading">
            <Loader2 size={18} className="spin" />
            <span>Ищем текст на Genius…</span>
          </div>
        ) : error ? (
          <div className="lyrics-empty">
            <FileText size={20} />
            <strong>Текст не найден</strong>
            <p>{error}</p>
            <p className="lyrics-hint">
              Проверьте название и исполнителя трека. После успешного поиска
              текст сохранится в файл и будет открываться мгновенно.
            </p>
          </div>
        ) : result ? (
          <>
            <div className="lyrics-toolbar">
              <span>
                <FileText size={14} />
                {result.cached ? "Из кэша" : "Загружено с Genius"}
              </span>
              <span className="lyrics-path" title={result.path}>
                {result.fileName}
              </span>
              {result.sourceUrl ? (
                <button
                  className="ghost-button"
                  onClick={() => void openExternal(result.sourceUrl ?? "")}
                >
                  <ExternalLink size={13} />
                  Genius
                </button>
              ) : null}
            </div>
            <pre className="lyrics-text">{result.text}</pre>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
