import { useEffect, useMemo, useState } from "react";
import { Merge } from "lucide-react";
import { groupAlbums, useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import { Cover } from "./Cover";
import { Modal } from "./Modal";

export function MergeAlbumsModal() {
  const seed = useUiStore((state) => state.mergeAlbumSeed);
  const openMergeAlbums = useUiStore((state) => state.openMergeAlbums);
  const tracks = useLibraryStore((state) => state.tracks);
  const mergeAlbums = useLibraryStore((state) => state.mergeAlbums);

  const groups = useMemo(() => groupAlbums(tracks), [tracks]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!seed) return;
    const seedIds = new Set(seed.trackIds);
    const next = new Set(
      groups
        .filter(
          (group) =>
            group.name === seed.name ||
            group.tracks.some((track) => seedIds.has(track.id)),
        )
        .map((group) => group.key),
    );
    setSelected(next);
    setName(seed.name);
  }, [seed, groups]);

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirm = async () => {
    if (selected.size === 0 || !name.trim()) return;
    const ids = groups
      .filter((group) => selected.has(group.key))
      .flatMap((group) => group.tracks.map((track) => track.id));
    setSaving(true);
    await mergeAlbums(ids, name.trim());
    setSaving(false);
    openMergeAlbums(null);
  };

  return (
    <Modal
      open={Boolean(seed)}
      onClose={() => openMergeAlbums(null)}
      title="Объединить альбомы"
      subtitle="Выберите альбомы и задайте общее название. Треки и файлы не переименовываются."
      size="md"
    >
      <div className="merge-albums-modal">
        <div className="merge-album-list">
          {groups.map((group) => {
            const checked = selected.has(group.key);
            return (
              <button
                key={group.key}
                className={`merge-album-row${checked ? " is-selected" : ""}`}
                onClick={() => toggle(group.key)}
              >
                <span className="merge-check">
                  <input type="checkbox" checked={checked} readOnly />
                </span>
                <span className="merge-art">
                  <Cover
                    track={group.tracks[0]}
                    className="merge-cover"
                    label={group.name}
                  />
                </span>
                <span className="merge-info">
                  <strong>{group.name}</strong>
                  <small>
                    {group.tracks.length} трек(ов)
                    {group.albums.length > 0
                      ? ` · ${group.albums.join(" · ")}`
                      : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="settings-field">
          <label>Название нового альбома</label>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Asper X — все треки"
          />
        </div>
        <div className="modal-actions">
          <button
            className="ghost-button"
            onClick={() => openMergeAlbums(null)}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            className="primary-button"
            onClick={() => void confirm()}
            disabled={saving || selected.size === 0 || !name.trim()}
          >
            <Merge size={14} />
            {saving
              ? "Объединяем…"
              : `Объединить (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
