import { create } from "zustand";
import { api, isTauri, listenUpdateProgress } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import type { UpdateInfo, UpdateProgress } from "../types";
import { useUiStore } from "./ui";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "permission"
  | "installing"
  | "error";

interface UpdateState {
  open: boolean;
  info: UpdateInfo | null;
  status: UpdateStatus;
  progress: UpdateProgress | null;
  downloadedPath: string | null;
  error: string | null;
  silent: boolean;
  check: (silent?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  install: () => Promise<void>;
  close: () => void;
}

let progressListener: (() => void) | null = null;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useUpdateStore = create<UpdateState>((set, get) => ({
  open: false,
  info: null,
  status: "idle",
  progress: null,
  downloadedPath: null,
  error: null,
  silent: false,

  check: async (silent = false) => {
    if (!isAndroid) {
      if (!silent) {
        useUiStore
          .getState()
          .notify("Автообновление доступно в Android-версии", "info");
      }
      return;
    }
    if (get().status === "checking" || get().status === "downloading") return;
    set({
      status: "checking",
      silent,
      error: null,
      progress: null,
      downloadedPath: null,
    });
    try {
      const info = await api.updateCheck();
      if (!info) {
        set({ status: "idle", open: false, info: null });
        if (!silent) {
          useUiStore.getState().notify("У вас последняя версия Nova", "success");
        }
        return;
      }
      set({ info, status: "available", open: true });
    } catch (error) {
      set({ status: "error", error: errorText(error), open: !silent });
      if (!silent) {
        useUiStore.getState().notify(errorText(error), "error");
      }
    }
  },

  downloadAndInstall: async () => {
    const info = get().info;
    if (!info) return;
    if (!isTauri) {
      useUiStore
        .getState()
        .notify("Обновление доступно в Android-приложении", "info");
      return;
    }
    set({ status: "downloading", progress: { downloaded: 0, total: info.size }, error: null });
    if (!progressListener) {
      void listenUpdateProgress((progress) => {
        if (useUpdateStore.getState().status === "downloading") {
          set({ progress });
        }
      }).then((unlisten) => {
        progressListener = unlisten;
      });
    }
    try {
      const path = await api.updateDownload(
        info.assetUrl,
        info.assetName,
        info.sha256,
      );
      set({ downloadedPath: path });
      await get().install();
    } catch (error) {
      set({ status: "error", error: errorText(error) });
      useUiStore.getState().notify(errorText(error), "error");
    }
  },

  install: async () => {
    const path = get().downloadedPath;
    if (!path) {
      await get().downloadAndInstall();
      return;
    }
    set({ status: "installing", error: null });
    try {
      const result = await api.updateInstall(path);
      if (result.needsPermission) {
        set({ status: "permission" });
        useUiStore
          .getState()
          .notify(
            "Разрешите установку из Nova в настройках Android и нажмите ещё раз",
            "info",
          );
        return;
      }
      useUiStore.getState().notify("Открыт установщик Android", "success");
      set({ open: false, status: "idle" });
    } catch (error) {
      set({ status: "error", error: errorText(error) });
      useUiStore.getState().notify(errorText(error), "error");
    }
  },

  close: () => {
    set({ open: false });
  },
}));
