import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLibraryStore } from "../store/library";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

export function CreatePlaylistModal() {
  const open = useUiStore((state) => state.createPlaylistOpen);
  const setOpen = useUiStore((state) => state.setCreatePlaylistOpen);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const close = () => {
    setOpen(false);
    setName("");
  };

  const submit = async () => {
    const playlist = await createPlaylist(name || "Новый плейлист");
    close();
    if (playlist) navigate(`/playlists/${playlist.id}`);
  };

  return (
    <Modal open={open} onClose={close} title="Новый плейлист" size="sm">
      <p className="modal-note">
        Плейлист может собирать треки из любых папок библиотеки.
      </p>
      <input
        className="text-input"
        placeholder="Например, Ночная смена"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
      <button className="primary-button wide" onClick={() => void submit()}>
        Создать плейлист
      </button>
    </Modal>
  );
}
