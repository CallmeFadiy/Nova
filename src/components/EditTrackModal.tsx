import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

export function EditTrackModal() {
  const trackId = useUiStore((state) => state.editTrackId);
  const openEditTrack = useUiStore((state) => state.openEditTrack);
  const tracks = useLibraryStore((state) => state.tracks);
  const updateTrackMetadata = useLibraryStore(
    (state) => state.updateTrackMetadata,
  );
  const track = tracks.find((item) => item.id === trackId) ?? null;

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!track) return;
    setTitle(track.title);
    setArtist(track.artist);
    setAlbum(track.album);
    setAlbumArtist(track.albumArtist);
  }, [track?.id, track?.title, track?.artist, track?.album, track?.albumArtist]);

  const save = async () => {
    if (!track || !title.trim() || !artist.trim()) return;
    setSaving(true);
    await updateTrackMetadata(track.id, {
      title: title.trim(),
      artist: artist.trim(),
      album: album.trim() || undefined,
      albumArtist: albumArtist.trim() || undefined,
    });
    setSaving(false);
    openEditTrack(null);
  };

  return (
    <Modal
      open={Boolean(track)}
      onClose={() => openEditTrack(null)}
      title="Название и автор"
      subtitle="Изменения сохраняются в библиотеке Nova. Файл на диске не переименовывается."
      size="sm"
    >
      {track ? (
        <div className="form-stack">
          <div className="settings-field">
            <label>Название трека</label>
            <input
              className="text-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label>Исполнитель</label>
            <input
              className="text-input"
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
            />
          </div>
          <div className="settings-field">
            <label>Альбом</label>
            <input
              className="text-input"
              value={album}
              onChange={(event) => setAlbum(event.target.value)}
            />
          </div>
          <div className="settings-field">
            <label>Album artist</label>
            <input
              className="text-input"
              value={albumArtist}
              onChange={(event) => setAlbumArtist(event.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button
              className="ghost-button"
              onClick={() => openEditTrack(null)}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              className="primary-button"
              onClick={() => void save()}
              disabled={saving || !title.trim() || !artist.trim()}
            >
              <Save size={14} />
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
