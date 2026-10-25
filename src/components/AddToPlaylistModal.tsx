import { useState } from "react";
import { Plus } from "lucide-react";
import { trackCountLabel } from "../lib/format";
import { useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

export function AddToPlaylistModal() {
  const trackIds = useUiStore((state) => state.addToPlaylistTrackIds);
  const openAddToPlaylist = useUiStore((state) => state.openAddToPlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [name, setName] = useState("");

  const close = () => {
    openAddToPlaylist(null);
    setName("");
  };

  const createAndAdd = async () => {
    if (!trackIds || trackIds.length === 0) return;
    const playlist = await createPlaylist(name || "Новый плейлист");
    if (playlist) {
      await addToPlaylist(playlist.id, trackIds);
    }
    close();
  };

  return (
    <Modal
      open={Boolean(trackIds && trackIds.length > 0)}
      onClose={close}
      title="В плейлист"
      subtitle={
        trackIds && trackIds.length > 1
          ? `Добавить ${trackCountLabel(trackIds.length)}`
          : "Выберите существующий или создайте новый"
      }
      size="sm"
    >
      <div className="playlist-picker">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="playlist-pick-row"
            onClick={async () => {
              if (!trackIds || trackIds.length === 0) return;
              await addToPlaylist(playlist.id, trackIds);
              close();
            }}
          >
            <span className="playlist-pick-icon">
              <Plus size={14} />
            </span>
            <span>
              <strong>{playlist.name}</strong>
              <small>{trackCountLabel(playlist.trackIds.length)}</small>
            </span>
          </button>
        ))}

        <div className="inline-create">
          <input
            className="text-input"
            placeholder="Новый плейлист"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createAndAdd();
            }}
          />
          <button className="primary-button" onClick={() => void createAndAdd()}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
