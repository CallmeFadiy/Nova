import {
  FolderOpen,
  Heart,
  Image,
  ListPlus,
  Merge,
  Pencil,
  Play,
  ScrollText,
  Trash2,
} from "lucide-react";
import { pickImage, revealInFolder } from "../lib/tauri";
import { useConfirmStore } from "../store/confirm";
import { groupAlbums, useLibraryStore } from "../store/library";
import { usePlayerStore } from "../store/player";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

export function TrackActionsModal() {
  const trackId = useUiStore((state) => state.trackActionsTrackId);
  const openTrackActions = useUiStore((state) => state.openTrackActions);
  const openAddToPlaylist = useUiStore((state) => state.openAddToPlaylist);
  const openLyrics = useUiStore((state) => state.openLyrics);
  const openEditTrack = useUiStore((state) => state.openEditTrack);
  const openMergeAlbums = useUiStore((state) => state.openMergeAlbums);
  const tracks = useLibraryStore((state) => state.tracks);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const hideTrack = useLibraryStore((state) => state.hideTrack);
  const setTrackCover = useLibraryStore((state) => state.setTrackCover);
  const clearTrackCover = useLibraryStore((state) => state.clearTrackCover);
  const deleteTrack = useLibraryStore((state) => state.deleteTrack);
  const confirm = useConfirmStore((state) => state.confirm);

  const track = tracks.find((item) => item.id === trackId) ?? null;
  const albumGroup = track
    ? groupAlbums(tracks).find((group) =>
        group.tracks.some((item) => item.id === track.id),
      ) ?? null
    : null;

  const close = () => openTrackActions(null);

  return (
    <Modal open={Boolean(track)} onClose={close} size="sm">
      {track ? (
        <div className="track-actions-modal">
          <div className="track-actions-head">
            <div>
              <h2 className="serif">{track.title}</h2>
              <p>{track.artist}</p>
            </div>
          </div>
          <div className="action-list">
            <button
              className="action-row"
              onClick={() => {
                usePlayerStore
                  .getState()
                  .setContext([track.id], track.id, "Трек", true);
                close();
              }}
            >
              <Play size={16} />
              Играть
            </button>
            <button
              className="action-row"
              onClick={() => {
                openAddToPlaylist(track.id);
                openTrackActions(null);
              }}
            >
              <ListPlus size={16} />
              Добавить в плейлист
            </button>
            <button
              className="action-row"
              onClick={() => {
                openLyrics(track.id);
                openTrackActions(null);
              }}
            >
              <ScrollText size={16} />
              Текст песни
            </button>
            <button
              className="action-row"
              onClick={() => {
                openEditTrack(track.id);
                openTrackActions(null);
              }}
            >
              <Pencil size={16} />
              Изменить название и автора
            </button>
            {albumGroup ? (
              <button
                className="action-row"
                onClick={() => {
                  openMergeAlbums({
                    trackIds: albumGroup.tracks.map((item) => item.id),
                    name: albumGroup.name,
                  });
                  openTrackActions(null);
                }}
              >
                <Merge size={16} />
                Объединить альбомы
              </button>
            ) : null}
            <button
              className="action-row"
              onClick={() => {
                void toggleFavorite(track.id);
                close();
              }}
            >
              <Heart
                size={16}
                fill={track.favorite ? "currentColor" : "none"}
              />
              {track.favorite ? "Убрать из избранного" : "В избранное"}
            </button>
            <button
              className="action-row"
              onClick={async () => {
                const path = await pickImage();
                if (path) await setTrackCover(track.id, path);
                close();
              }}
            >
              <Image size={16} />
              Заменить обложку
            </button>
            {track.customCoverPath ? (
              <button
                className="action-row"
                onClick={() => {
                  void clearTrackCover(track.id);
                  close();
                }}
              >
                <Trash2 size={16} />
                Вернуть исходную обложку
              </button>
            ) : null}
            <button
              className="action-row"
              onClick={() => {
                void revealInFolder(track.path);
                close();
              }}
            >
              <FolderOpen size={16} />
              Показать в папке
            </button>
            <button
              className="action-row danger"
              onClick={() => {
                void hideTrack(track.id);
                close();
              }}
            >
              <Trash2 size={16} />
              Скрыть из альбома
            </button>
            <button
              className="action-row danger"
              onClick={() => {
                close();
                void confirm({
                  title: "Удалить трек?",
                  message:
                    "Удалить трек из Nova и файл с диска? Это действие нельзя отменить.",
                  confirmLabel: "Удалить трек и файл",
                  tone: "danger",
                }).then((confirmed) => {
                  if (!confirmed) return;
                  if (usePlayerStore.getState().currentId === track.id) {
                    usePlayerStore.getState().clearQueue();
                  }
                  void deleteTrack(track.id, true);
                });
              }}
            >
              <Trash2 size={16} />
              Удалить трек и файл
            </button>
          </div>
          <p className="modal-note">
            «Скрыть из альбома» убирает трек только из Nova. Файл на диске
            остаётся на месте.
          </p>
          <p className="modal-path">{track.path}</p>
        </div>
      ) : null}
    </Modal>
  );
}
