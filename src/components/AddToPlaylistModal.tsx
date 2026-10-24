import { useState } from "react";
import { Plus } from "lucide-react";
import { trackCountLabel } from "../lib/format";
import { useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

export function AddToPlaylistModal() {
  const trackId = useUiStore((state) => state.addToPlaylistTrackId);
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
    if (!trackId) return;
    const playlist = await createPlaylist(name || "Новый плейлист");
    if (playlist) {
      await addToPlaylist(playlist.id, [trackId]);
    }
    close();
  };

  return (
    <Modal
      open={trackId !== null}
      onClose={close}
      title="В плейлист"
      subtitle="Выберите существующий или создайте новый"
      size="sm"
    >
      <div className="playlist-picker">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="playlist-pick-row"
            onClick={async () => {
              if (!trackId) return;
              await addToPlaylist(playlist.id, [trackId]);
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
