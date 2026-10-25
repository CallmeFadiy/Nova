import { Heart, Play, Shuffle } from "lucide-react";
import { TrackTable } from "../components/TrackTable";
import { formatMinutes, trackCountLabel } from "../lib/format";
import { favoriteTracks, useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";

export function Favorites() {
  const tracks = useLibraryStore((state) => state.tracks);
  const setContext = usePlayerStore((state) => state.setContext);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const favorites = favoriteTracks(tracks);

  const play = (shuffled = false) => {
    if (favorites.length === 0) return;
    if (shuffled && !usePlayerStore.getState().shuffle) toggleShuffle();
    setContext(
      favorites.map((track) => track.id),
      favorites[0].id,
      "Избранное",
      true,
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Личная коллекция</p>
          <h1 className="serif">Избранное</h1>
          <p className="page-sub">
            {trackCountLabel(favorites.length)} ·{" "}
            {formatMinutes(
              favorites.reduce((sum, track) => sum + track.durationMs, 0),
            )}
          </p>
        </div>
        <div className="head-actions">
          <button
            className="primary-button"
            onClick={() => play()}
            disabled={favorites.length === 0}
          >
            <Play size={15} fill="currentColor" />
            Играть
          </button>
          <button
            className="secondary-button"
            onClick={() => play(true)}
            disabled={favorites.length === 0}
          >
            <Shuffle size={15} />
            Перемешать
          </button>
        </div>
      </header>

      <div className="favorites-note">
        <Heart size={15} />
        <span>
          Сердце в плеере или в списке треков добавляет песню сюда. Это
          виртуальный альбом – файлы остаются в своих папках.
        </span>
      </div>

      <TrackTable
        tracks={favorites}
        label="Избранное"
        emptyTitle="В избранном пока пусто"
        emptyText="Нажмите на сердце у любого трека – он появится здесь."
      />
    </div>
  );
}
