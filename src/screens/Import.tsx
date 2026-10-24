import { useState } from "react";
import { ArrowRight, Check, Link2, ShieldCheck } from "lucide-react";
import { useUiStore } from "../store/ui";

const SOURCES = [
  "Spotify",
  "Яндекс Музыка",
  "VK Музыка",
  "Apple Music",
  "YouTube Music",
  "Deezer",
];

export function Import() {
  const [url, setUrl] = useState("");
  const notify = useUiStore((state) => state.notify);

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
            placeholder="https://open.spotify.com/playlist/…"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                notify(
                  "Разбор ссылок подключается на этапе загрузок",
                  "info",
                );
              }
            }}
          />
          <button
            className="primary-button"
            onClick={() =>
              notify("Разбор ссылок подключается на этапе загрузок", "info")
            }
          >
            Разобрать
          </button>
        </div>
        <div className="source-chips">
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
            Публичный плейлист или альбом. Для приватных ссылок понадобится
            ключ источника в настройках.
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
            Скачивание начинается только после подтверждения. Файлы попадают в
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

      <div className="roadmap-row">
        <span>Следующий шаг</span>
        <ArrowRight size={14} />
        <span>Подключение yt-dlp и разбор ссылок</span>
      </div>
    </div>
  );
}
