import { create } from "zustand";
import { api } from "../lib/tauri";
import type { DownloadHistoryItem, DownloadProgress, DownloadTask } from "../types";

const HISTORY_KEY = "nova.download.history.v1";
const HISTORY_LIMIT = 80;

/**
 * Downloads the user cancelled. Cancellation rejects the in-flight command, and
 * the screens check this set before writing a result so a cancelled item can
 * never be recorded as done (or silently re-queued by an import fallback).
 */
const cancelledIds = new Set<string>();

export function markDownloadCancelled(id: string) {
  cancelledIds.add(id);
  if (cancelledIds.size > 200) {
    cancelledIds.clear();
    cancelledIds.add(id);
  }
}

export function isDownloadCancelled(id: string) {
  return cancelledIds.has(id);
}

export function clearDownloadCancelled(id: string) {
  cancelledIds.delete(id);
}

function readHistory(): DownloadHistoryItem[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DownloadHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory(items: DownloadHistoryItem[]) {
  try {
    if (typeof window === "undefined") return;
    const serializable = items.slice(0, HISTORY_LIMIT).map((item) => ({
      id: item.id,
      title: item.title,
      line: item.line,
      status: item.status,
      path: item.path,
      error: item.error,
      finishedAt: item.finishedAt,
    }));
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(serializable));
  } catch {
    // ignore storage errors
  }
}

interface DownloadStore {
  items: Record<string, DownloadProgress>;
  pending: string[];
  paused: boolean;
  history: DownloadHistoryItem[];
  hydrated: boolean;
  upsert: (progress: DownloadProgress) => void;
  enqueue: (ids: string[]) => void;
  nextQueued: () => Promise<string | null>;
  pauseQueue: () => void;
  resumeQueue: () => void;
  cancelQueued: (id: string) => void;
  removeDownload: (id: string) => void;
  moveQueued: (id: string, direction: -1 | 1) => void;
  clearHistory: () => void;
  /** Loads the persisted queue/history once. Safe to call repeatedly. */
  hydrate: () => Promise<void>;
  // Native actions backed by SQLite. The Downloads/Import UI still uses the
  // local queue loop above until Task 4 switches it over.
  enqueueNative: (task: DownloadTask) => Promise<string>;
  pauseNative: (paused: boolean) => Promise<void>;
  resumeNative: () => Promise<void>;
  cancelNative: (id: string) => Promise<boolean>;
  moveNative: (id: string, direction: -1 | 1) => Promise<void>;
  clearHistoryNative: () => Promise<void>;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: {},
  pending: [],
  paused: false,
  history: readHistory(),
  hydrated: false,

  upsert: (progress) =>
    set((state) => {
      const previous = state.items[progress.id];
      const item: DownloadProgress = {
        ...previous,
        ...progress,
        order: progress.order ?? previous?.order ?? 0,
        title: progress.title ?? previous?.title,
        retry:
          progress.status === "done"
            ? undefined
            : (progress.retry ?? previous?.retry),
      };
      const terminal =
        item.status === "done" || item.status === "error";
      let history = state.history;

      if (terminal) {
        const entry: DownloadHistoryItem = {
          id: item.id,
          title: item.title || item.line || "Загрузка",
          line: item.line,
          status: item.status === "done" ? "done" : "error",
          path: item.path,
          error: item.error,
          finishedAt: Date.now(),
          retry: item.retry,
        };
        history = [
          entry,
          ...state.history.filter((existing) => existing.id !== item.id),
        ].slice(0, HISTORY_LIMIT);
        writeHistory(history);
      } else if (state.history.some((existing) => existing.id === item.id)) {
        history = state.history.filter((existing) => existing.id !== item.id);
        writeHistory(history);
      }

      return {
        items: { ...state.items, [progress.id]: item },
        pending:
          terminal
            ? state.pending.filter((id) => id !== progress.id)
            : state.pending,
        history,
      };
    }),

  enqueue: (ids) =>
    set((state) => {
      const queued = ids.filter(
        (id) => state.items[id]?.status === "queued",
      );
      return {
        pending: [...new Set([...state.pending, ...queued])],
        paused: false,
      };
    }),

  nextQueued: async () => {
    for (;;) {
      const state = get();
      const queued = state.pending.filter(
        (id) => state.items[id]?.status === "queued",
      );
      if (queued.length === 0) {
        if (state.pending.length > 0) set({ pending: [] });
        return null;
      }
      if (state.paused) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        continue;
      }
      const [id, ...rest] = queued;
      set({ pending: rest });
      return id;
    }
  },

  pauseQueue: () => set({ paused: true }),
  resumeQueue: () => set({ paused: false }),

  cancelQueued: (id) =>
    set((state) => {
      if (state.items[id]?.status !== "queued") return state;
      const items = { ...state.items };
      delete items[id];
      return {
        items,
        pending: state.pending.filter((pendingId) => pendingId !== id),
      };
    }),

  removeDownload: (id) =>
    set((state) => {
      const items = { ...state.items };
      delete items[id];
      const history = state.history.filter((entry) => entry.id !== id);
      if (history.length !== state.history.length) writeHistory(history);
      return {
        items,
        history,
        pending: state.pending.filter((pendingId) => pendingId !== id),
      };
    }),

  moveQueued: (id, direction) =>
    set((state) => {
      const pending = [...state.pending];
      const index = pending.indexOf(id);
      if (index < 0) return state;
      const target = index + direction;
      if (target < 0 || target >= pending.length) return state;
      [pending[index], pending[target]] = [pending[target], pending[index]];
      const base = Date.now();
      const items = { ...state.items };
      pending.forEach((pendingId, position) => {
        const item = items[pendingId];
        if (item) {
          items[pendingId] = { ...item, order: base + position };
        }
      });
      return { pending, items };
    }),

  clearHistory: () => {
    writeHistory([]);
    set({ history: [] });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    // Set the flag before the first await so React StrictMode's double effect
    // cannot issue two overlapping loads.
    set({ hydrated: true });

    try {
      const [queue, history] = await Promise.all([
        api.downloadQueueList(),
        api.downloadHistoryList(),
      ]);

      // Merge rows for display only. The legacy `pending` loop stays JS-owned
      // until Task 4 switches downloads over to the native worker.
      set((state) => {
        const items = { ...state.items };

        for (const row of queue) {
          const { orderIndex, ...progress } = row;
          const previous = state.items[row.id];
          items[row.id] = {
            ...previous,
            ...progress,
            order: orderIndex ?? previous?.order ?? 0,
          };
        }

        return {
          items,
          // Only replace the localStorage history once the native table has
          // rows; an empty table on an upgrading install must not wipe it.
          history: history.length > 0 ? history : state.history,
        };
      });
    } catch {
      // Keep the localStorage fallback when the DB is unavailable.
    }
  },

  enqueueNative: (task) => api.downloadEnqueue(task),

  pauseNative: async (paused) => {
    await api.downloadQueuePause(paused);
    set({ paused });
  },

  resumeNative: () => api.downloadQueueResume(),

  cancelNative: async (id) => {
    const removed = await api.downloadQueueCancel(id);
    if (removed) get().removeDownload(id);
    return removed;
  },

  moveNative: (id, direction) => api.downloadQueueMove(id, direction),

  clearHistoryNative: async () => {
    await api.downloadHistoryClear();
    writeHistory([]);
    set({ history: [] });
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as unknown as { __novaDownloads: typeof useDownloadStore }
  ).__novaDownloads = useDownloadStore;
}
