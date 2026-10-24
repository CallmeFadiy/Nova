import { GripVertical, Shuffle, Trash2, X } from "lucide-react";
import { formatMinutes, trackCountLabel } from "../lib/format";
import { useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import { Cover } from "./Cover";

export function QueuePanel() {
  const tracks = useLibraryStore((state) => state.tracks);
  const order = usePlayerStore((state) => state.order);
  const currentId = usePlayerStore((state) => state.currentId);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const sourceLabel = usePlayerStore((state) => state.sourceLabel);
  const playFromOrder = usePlayerStore((state) => state.playFromOrder);
  const reshuffle = usePlayerStore((state) => state.reshuffle);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const setQueueOpen = useUiStore((state) => state.setQueueOpen);

  const items = order
    .map((id, index) => {
      const track = tracks.find((item) => item.id === id);
      return track ? { track, index } : null;
    })
    .filter((item): item is { track: (typeof tracks)[number]; index: number } =>
      Boolean(item),
    );

  const totalDuration = items.reduce(
    (sum, item) => sum + item.track.durationMs,
    0,
  );

  return (
    <aside className="queue-panel">
      <div className="queue-head">
        <div>
          <h2 className="serif">Очередь</h2>
          <p>
            {sourceLabel} · {trackCountLabel(items.length)}
            {shuffle ? " · перемешано" : ""}
          </p>
        </div>
        <div className="queue-head-actions">
          <button
            className={`icon-button${shuffle ? " is-active" : ""}`}
            onClick={reshuffle}
            title="Перемешать заново"
            aria-label="Перемешать заново"
          >
            <Shuffle size={15} />
          </button>
          <button
            className="icon-button queue-close"
            onClick={() => setQueueOpen(false)}
            aria-label="Скрыть очередь"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="queue-empty">
          <p>Очередь пуста.</p>
          <span>Включите трек в библиотеке — он появится здесь.</span>
        </div>
      ) : (
        <div className="queue-list">
          {items.map(({ track, index }) => {
            const active = track.id === currentId;
            return (
              <button
                key={`${track.id}-${index}`}
                className={`queue-item${active ? " is-active" : ""}`}
                onClick={() => playFromOrder(index)}
              >
                <span className="queue-index">
                  {active ? (
                    <span className="playing-bars" aria-label="Играет">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <Cover track={track} className="queue-cover" />
                <span className="queue-text">
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </span>
                <GripVertical size={13} className="queue-grip" />
              </button>
            );
          })}
        </div>
      )}

      <div className="queue-foot">
        <span>{formatMinutes(totalDuration)}</span>
        <div className="queue-foot-actions">
          <button className="ghost-button" onClick={reshuffle}>
            <Shuffle size={13} />
            Перемешать
          </button>
          <button
            className="icon-button"
            onClick={clearQueue}
            title="Очистить очередь"
            aria-label="Очистить очередь"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
