import { useEffect, useState, type CSSProperties } from "react";
import {
  ExternalLink,
  FileAudio,
  Headphones,
  Loader2,
  Mic,
  Music2,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  api,
  listenRecognitionLevel,
  openExternal,
  pickAudioFile,
} from "../lib/tauri";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { RecognitionResult } from "../types";

const WAVE_BARS = 18;

export function Shazam() {
  const provider = useSettingsStore((state) => state.shazamProvider);
  const shazamKey = useSettingsStore((state) => state.shazamKey);
  const recognitionSource = useSettingsStore(
    (state) => state.recognitionSource,
  );
  const setRecognitionSource = useSettingsStore(
    (state) => state.setRecognitionSource,
  );
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();

  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [manual, setManual] = useState("");
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  useEffect(() => {
    if (!listening) {
      setLevel(0);
      setPeak(0);
      return;
    }
    let unlisten: (() => void) | undefined;
    void listenRecognitionLevel((payload) => {
      setLevel(payload.level);
      setPeak(payload.peak);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, [listening]);

  const sourceLabel =
    recognitionSource === "system" ? "Системные динамики" : "Микрофон";
  const hearsAudio = level > 0.45;

  const providerLabel =
    provider === "builtin"
      ? "Встроенное распознавание"
      : provider === "audd"
        ? "AudD"
        : "ACRCloud";

  const recognize = async () => {
    if (provider === "acrcloud") {
      notify(
        "ACRCloud требует host, access key и secret. Пока подключён AudD — выберите его в настройках.",
        "info",
      );
      return;
    }
    if (provider === "audd" && !shazamKey.trim()) {
      notify("Добавьте API-ключ AudD в настройках", "info");
      return;
    }
    setListening(true);
    setResult(null);
    try {
      const recognized =
        provider === "builtin"
          ? await api.recognizeShazam(recognitionSource)
          : await api.recognizeAudd(shazamKey, recognitionSource);
      setResult(recognized);
      notify(`Распознано: ${recognized.artist} — ${recognized.title}`, "success");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : `Не удалось распознать трек: ${String(error)}`,
        "error",
      );
    } finally {
      setListening(false);
    }
  };

  const findAndDownload = (query: string) => {
    if (!query.trim()) return;
    navigate(`/downloads?q=${encodeURIComponent(query.trim())}`);
  };

  const recognizeFile = async () => {
    const path = await pickAudioFile();
    if (!path) {
      notify("Выбор файла доступен в приложении Nova", "info");
      return;
    }
    setListening(true);
    setResult(null);
    try {
      const recognized = await api.recognizeShazamFile(path);
      setResult(recognized);
      notify(`Распознано: ${recognized.artist} — ${recognized.title}`, "success");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : `Не удалось распознать файл: ${String(error)}`,
        "error",
      );
    } finally {
      setListening(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Что это играет?</p>
          <h1 className="serif">Распознать трек</h1>
          <p className="page-sub">
            Нажмите — Nova запишет 12 секунд и предложит найти песню
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => navigate("/settings")}
        >
          <Settings2 size={15} />
          {providerLabel}
        </button>
      </header>

      <div className="shazam-stage">
        <div className="recognition-source-switch">
          <button
            className={recognitionSource === "microphone" ? "active" : ""}
            onClick={() => setRecognitionSource("microphone")}
            disabled={listening}
          >
            <Mic size={14} />
            Микрофон
          </button>
          <button
            className={recognitionSource === "system" ? "active" : ""}
            onClick={() => setRecognitionSource("system")}
            disabled={listening}
          >
            <Headphones size={14} />
            Системные динамики
          </button>
        </div>

        <button
          className={`shazam-button${listening ? " is-listening" : ""}${
            listening && hearsAudio ? " is-hearing" : ""
          }`}
          onClick={() => void recognize()}
          disabled={listening}
          aria-label="Слушать 12 секунд"
          style={{ "--recognition-level": level } as CSSProperties}
        >
          <span className="shazam-ring" />
          {listening ? (
            <Loader2 size={32} className="spin" />
          ) : recognitionSource === "system" ? (
            <Headphones size={34} />
          ) : (
            <Mic size={34} />
          )}
        </button>

        <div
          className={`recognition-wave${listening ? " is-active" : ""}`}
          aria-hidden="true"
        >
          {Array.from({ length: WAVE_BARS }).map((_, index) => {
            const wave =
              0.35 +
              0.65 *
                Math.abs(
                  Math.sin((index + 1) * 0.9 + level * 10 + peak * 4),
                );
            const height = 5 + Math.round(level * 42 * wave);
            return (
              <span
                key={index}
                style={{
                  height: `${listening ? Math.max(5, height) : 5}px`,
                  opacity: listening ? 0.35 + level * 0.65 : 0.22,
                }}
              />
            );
          })}
        </div>

        <h2 className="serif">
          {listening
            ? hearsAudio
              ? "Слышу звук"
              : "Слушаю…"
            : "Нажмите, чтобы слушать"}
        </h2>
        <p>
          {provider === "builtin"
            ? `Встроенное распознавание Shazam: 12 секунд записи через ${sourceLabel.toLowerCase()}, без ключа.`
            : provider === "acrcloud"
              ? "ACRCloud требует три параметра. Используйте AudD или ручной поиск."
              : shazamKey
                ? `Запись через ${sourceLabel.toLowerCase()} не сохраняется.`
                : "Добавьте ключ AudD в настройках — и распознавание заработает."}
        </p>
        <div className="shazam-providers">
          <span>Провайдер: {providerLabel}</span>
          <span>Источник: {sourceLabel}</span>
          <span>12 секунд · без сохранения</span>
        </div>
        <button
          className="primary-button shazam-listen-button"
          onClick={() => void recognize()}
          disabled={listening}
        >
          {listening ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Headphones size={15} />
          )}
          {listening ? "Слушаю…" : "Слушать 12 секунд"}
        </button>
        <button
          className="ghost-button shazam-file-button"
          onClick={() => void recognizeFile()}
          disabled={listening}
        >
          <FileAudio size={14} />
          Распознать из файла
        </button>
      </div>

      {result ? (
        <div className="recognition-result">
          <div className="recognition-art">
            {result.artworkUrl ? (
              <img src={result.artworkUrl} alt="" />
            ) : (
              <Music2 size={28} />
            )}
          </div>
          <div className="recognition-info">
            <span className="eyebrow">Распознано · {result.provider}</span>
            <h2 className="serif">{result.title}</h2>
            <p>
              {result.artist}
              {result.album ? ` · ${result.album}` : ""}
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() => findAndDownload(result.query)}
              >
                <Search size={15} />
                Найти и скачать
              </button>
              {result.sourceUrl ? (
                <button
                  className="ghost-button"
                  onClick={() => void openExternal(result.sourceUrl ?? "")}
                >
                  <ExternalLink size={14} />
                  Открыть источник
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="shazam-manual">
        <div>
          <h2 className="serif">Или найти вручную</h2>
          <p>Введите исполнителя и название — Nova откроет поиск и загрузку.</p>
        </div>
        <div className="download-search-row">
          <Search size={16} />
          <input
            placeholder="Например, Sacrothorn — Инкуб"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") findAndDownload(manual);
            }}
          />
          <button
            className="primary-button"
            onClick={() => findAndDownload(manual)}
            disabled={!manual.trim()}
          >
            Найти
          </button>
        </div>
      </div>

      <div className="shazam-info">
        <div>
          <Sparkles size={17} />
          <strong>Найдём и предложим</strong>
          <p>
            После распознавания можно открыть трек в библиотеке или перейти к
            поиску и загрузке.
          </p>
        </div>
        <div>
          <ShieldCheck size={17} />
          <strong>Два провайдера</strong>
          <p>
            Встроенное Shazam-совместимое распознавание или AudD/ACRCloud по
            вашему ключу.
          </p>
        </div>
      </div>
    </div>
  );
}
