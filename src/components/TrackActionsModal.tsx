import {
  ExternalLink,
  FolderOpen,
  Heart,
  Image,
  ListPlus,
  Merge,
  Pencil,
  Play,
  ScrollText,
  Share2,
  Trash2,
} from "lucide-react";
import { api, pickImage, revealInFolder } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import { errorText } from "../lib/errors";
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
  const notify = useUiStore((state) => state.notify);
  const tracks = useLibraryStore((state) => state.tracks);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
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
    <Modal
      open={Boolean(track)}
      onClose={close}
      size="sm"
      title={track?.title}
      subtitle={track?.artist}
      className="track-actions-dialog"
    >
      {track ? (
        <div className="track-actions-modal">
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
            {isAndroid ? (
              <>
                <button
                  className="action-row group-start"
                  onClick={() => {
                    close();
                    void api
                      .androidShareFile(track.path)
                      .catch((error) => notify(errorText(error), "error"));
                  }}
                >
                  <Share2 size={16} />
                  Поделиться
                </button>
                <button
                  className="action-row"
                  onClick={() => {
                    close();
                    void api
                      .androidOpenFile(track.path)
                      .catch((error) => notify(errorText(error), "error"));
                  }}
                >
                  <ExternalLink size={16} />
                  Открыть в другом приложении
                </button>
              </>
            ) : null}
            <button
              className="action-row group-start"
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
              className={`action-row${isAndroid ? "" : " group-start"}`}
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
                try {
                  const path = await pickImage();
                  if (!path) {
                    notify("Выбор отменён", "info");
                    return;
                  }
                  await setTrackCover(track.id, path);
                  close();
                } catch (error) {
                  notify(errorText(error), "error");
                }
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
              className="action-row danger group-start"
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
                  void deleteTrack(track.id, true);
                });
              }}
            >
              <Trash2 size={16} />
              Удалить трек и файл
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
