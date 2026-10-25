import { useState } from "react";
import {
  ExternalLink,
  FileAudio,
  Loader2,
  Mic,
  Music2,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, openExternal, pickAudioFile } from "../lib/tauri";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { RecognitionResult } from "../types";

export function Shazam() {
  const provider = useSettingsStore((state) => state.shazamProvider);
  const shazamKey = useSettingsStore((state) => state.shazamKey);
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();

  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [manual, setManual] = useState("");

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
          ? await api.recognizeShazam()
          : await api.recognizeAudd(shazamKey);
      setResult(recognized);
      notify(`Распознано: ${recognized.artist} — ${recognized.title}`, "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось распознать трек",
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
        error instanceof Error ? error.message : "Не удалось распознать файл",
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
            Нажмите — Nova запишет 8 секунд и предложит найти песню
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
        <button
          className={`shazam-button${listening ? " is-listening" : ""}`}
          onClick={() => void recognize()}
          disabled={listening}
        >
          <span className="shazam-ring" />
          {listening ? (
            <Loader2 size={32} className="spin" />
          ) : (
            <Mic size={34} />
          )}
        </button>
        <h2 className="serif">
          {listening ? "Слушаю…" : "Нажмите, чтобы слушать"}
        </h2>
        <p>
          {provider === "builtin"
            ? "Встроенное распознавание Shazam: 8 секунд записи, без ключа. Работает через Shazam-совместимый сервис."
            : provider === "acrcloud"
              ? "ACRCloud требует три параметра. Используйте AudD или ручной поиск."
              : shazamKey
                ? "Запись не сохраняется. Микрофон запрашивается только на время распознавания."
                : "Добавьте ключ AudD в настройках — и распознавание заработает."}
        </p>
        <div className="shazam-providers">
          <span>Провайдер: {providerLabel}</span>
          <span>Запись 8 секунд · без сохранения</span>
        </div>
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
