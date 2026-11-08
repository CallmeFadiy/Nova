import { useEffect } from "react";
import { listenDownloadProgress } from "../lib/tauri";
import {
  isDownloadCancelled,
  useDownloadStore,
} from "../store/downloads";

let listenerStarted = false;

export function useDownloadProgress() {
  const items = useDownloadStore((state) => state.items);
  const pending = useDownloadStore((state) => state.pending);
  const paused = useDownloadStore((state) => state.paused);
  const history = useDownloadStore((state) => state.history);
  const setProgress = useDownloadStore((state) => state.upsert);
  const enqueue = useDownloadStore((state) => state.enqueue);
  const nextQueued = useDownloadStore((state) => state.nextQueued);
  const pauseQueue = useDownloadStore((state) => state.pauseQueue);
  const resumeQueue = useDownloadStore((state) => state.resumeQueue);
  const cancelQueued = useDownloadStore((state) => state.cancelQueued);
  const moveQueued = useDownloadStore((state) => state.moveQueued);
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const clearHistory = useDownloadStore((state) => state.clearHistory);

  useEffect(() => {
    if (listenerStarted) return;
    listenerStarted = true;
    // Keep this listener for the lifetime of the window: an import batch
    // continues after the user navigates away from the Import screen.
    void listenDownloadProgress((progress) => {
      // A cancelled yt-dlp run still publishes one last error snapshot while the
      // command unwinds; ignore it so the cancelled row stays removed.
      if (isDownloadCancelled(progress.id)) return;
      useDownloadStore.getState().upsert(progress);
    });
  }, []);

  return {
    items,
    pending,
    paused,
    history,
    setProgress,
    enqueue,
    nextQueued,
    pauseQueue,
    resumeQueue,
    cancelQueued,
    removeDownload,
    moveQueued,
    clearHistory,
  };
}
