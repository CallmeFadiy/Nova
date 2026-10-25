import { useEffect, useState } from "react";
import { listenDownloadProgress } from "../lib/tauri";
import type { DownloadProgress } from "../types";

export function useDownloadProgress() {
  const [items, setItems] = useState<Record<string, DownloadProgress>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenDownloadProgress((progress) => {
      setItems((previous) => ({ ...previous, [progress.id]: progress }));
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const setProgress = (progress: DownloadProgress) => {
    setItems((previous) => ({ ...previous, [progress.id]: progress }));
  };

  return { items, setProgress };
}
