import { Download, FolderOpen, Link2, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../store/settings";

export function Downloads() {
  const downloadDir = useSettingsStore((state) => state.downloadDir);
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Очередь загрузок</p>
          <h1 className="serif">Загрузки</h1>
          <p className="page-sub">
            Активные и завершённые загрузки в одном списке
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => navigate("/settings")}
        >
          <Settings2 size={15} />
          Настроить yt-dlp
        </button>
      </header>

      <div className="downloads-empty">
        <div className="downloads-icon">
          <Download size={26} />
        </div>
        <h2 className="serif">Пока ничего не скачивается</h2>
        <p>
          Загрузки появятся здесь после подтверждения списка из импорта или
          поиска по названию.
        </p>
        <div className="downloads-actions">
          <button
            className="primary-button"
            onClick={() => navigate("/import")}
          >
            <Link2 size={15} />
            Импорт по ссылке
          </button>
          <button
            className="secondary-button"
            onClick={() => navigate("/settings")}
          >
            <FolderOpen size={15} />
            Папка загрузок
          </button>
        </div>
        <span className="downloads-path">
          {downloadDir || "По умолчанию: Downloads/Nova"}
        </span>
      </div>

      <div className="downloads-info">
        <div>
          <strong>Как это будет работать</strong>
          <p>
            yt-dlp скачивает аудио в выбранном формате. Метаданные и обложка
            встраиваются в файл, после чего Nova индексирует его как обычный
            локальный трек.
          </p>
        </div>
        <div>
          <strong>Прогресс и отмена</strong>
          <p>
            Каждая загрузка показывает процент, скорость и размер. Незавершённую
            можно поставить на паузу или отменить.
          </p>
        </div>
        <div>
          <strong>Без сюрпризов</strong>
          <p>
            Ничего не скачивается автоматически: сначала список с галочками,
            потом кнопка «Скачать выбранные».
          </p>
        </div>
      </div>
    </div>
  );
}
