import { useEffect } from "react";
import {
  listenDownloadComplete,
  listenDownloadProgress,
} from "../lib/tauri";
import { useDownloadStore } from "../store/downloads";
import { useLibraryStore } from "../store/library";

let started = false;

export function useDownloadProgress() {
  const items = useDownloadStore((state) => state.items);
  const pending = useDownloadStore((state) => state.pending);
  const paused = useDownloadStore((state) => state.paused);
  const history = useDownloadStore((state) => state.history);
  const hydrated = useDownloadStore((state) => state.hydrated);
  const setProgress = useDownloadStore((state) => state.upsert);
  const enqueue = useDownloadStore((state) => state.enqueue);
  const pauseQueue = useDownloadStore((state) => state.pauseQueue);
  const resumeQueue = useDownloadStore((state) => state.resumeQueue);
  const cancelQueued = useDownloadStore((state) => state.cancelQueued);
  const moveQueued = useDownloadStore((state) => state.moveQueued);
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const clearHistory = useDownloadStore((state) => state.clearHistory);
  const hydrate = useDownloadStore((state) => state.hydrate);
  const recordFailure = useDownloadStore((state) => state.recordFailure);

  useEffect(() => {
    if (started) return;
    started = true;

    // Keep these listeners for the lifetime of the window: a batch continues
    // after the user navigates away from Downloads/Import.
    void listenDownloadProgress((progress) => {
      useDownloadStore.getState().upsert(progress);
    });
    void listenDownloadComplete(() => {
      // The worker already scanned the output folder; reload the snapshot
      // instead of running a second scan.
      void useLibraryStore.getState().refresh();
    });
    // Pull the persisted queue once at startup; this also re-queues rows left
    // in starting/downloading and claims the foreground service.
    void useDownloadStore.getState().hydrate();
  }, []);

  return {
    items,
    pending,
    paused,
    history,
    hydrated,
    setProgress,
    enqueue,
    pauseQueue,
    resumeQueue,
    cancelQueued,
    moveQueued,
    removeDownload,
    clearHistory,
    hydrate,
    recordFailure,
  };
}
