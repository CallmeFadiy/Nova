import { Mic, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";

export function Shazam() {
  const provider = useSettingsStore((state) => state.shazamProvider);
  const notify = useUiStore((state) => state.notify);
  const navigate = useNavigate();

  const providerLabel =
    provider === "builtin"
      ? "Встроенное распознавание"
      : provider === "audd"
        ? "AudD"
        : "ACRCloud";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Что это играет?</p>
          <h1 className="serif">Распознать трек</h1>
          <p className="page-sub">
            Включите микрофон на 8 секунд — Nova найдёт песню и предложит
            скачать
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => navigate("/settings")}
        >
          <Radio size={15} />
          {providerLabel}
        </button>
      </header>

      <div className="shazam-stage">
        <button
          className="shazam-button"
          onClick={() =>
            notify(
              "Распознавание подключается на этапе Shazam",
              "info",
            )
          }
        >
          <span className="shazam-ring" />
          <Mic size={34} />
        </button>
        <h2 className="serif">Нажмите, чтобы слушать</h2>
        <p>
          Запись не сохраняется. Микрофон запрашивается только в момент
          распознавания.
        </p>
        <div className="shazam-providers">
          <span>Провайдер: {providerLabel}</span>
          <span>Ручной поиск всегда доступен</span>
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
