import { create } from "zustand";
import { api } from "../lib/tauri";
import type {
  DownloadHistoryItem,
  DownloadProgress,
  DownloadQueueRow,
  DownloadTask,
  DownloadStatus,
} from "../types";

const HISTORY_KEY = "nova.download.history.v1";
const HISTORY_LIMIT = 80;

/** Callbacks that should run once a queue row finishes successfully. */
const doneCallbacks = new Map<string, () => void>();

/** In-session retry actions, re-attached when native history is reloaded. */
const retryById = new Map<string, () => void>();

export function registerDownloadDone(id: string, callback: () => void) {
  doneCallbacks.set(id, callback);
}

/** Removes a callback whose task was never persisted. */
export function cancelDownloadDone(id: string) {
  doneCallbacks.delete(id);
}

function fireDoneCallback(id: string) {
  const callback = doneCallbacks.get(id);
  if (!callback) return;
  doneCallbacks.delete(id);
  try {
    callback();
  } catch {
    // A failed post-download action (for example a duplicate replacement) must
    // not break the queue UI.
  }
}

function isActiveStatus(status: DownloadStatus) {
  return (
    status === "queued" || status === "starting" || status === "downloading"
  );
}

function pendingFromItems(
  items: Record<string, DownloadProgress>,
): string[] {
  return Object.values(items)
    .filter((item) => item.status === "queued")
    .sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((item) => item.id);
}

/**
 * Reads the pre-2B-2 localStorage history once, so upgrading users keep their
 * records after the native SQLite history becomes the source of truth.
 */
function readLegacyHistory(): DownloadHistoryItem[] {
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

function clearLegacyHistory() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
}

/** Rust stores seconds; the UI works with JavaScript milliseconds. */
function toMillis(value: number) {
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function rowToProgress(row: DownloadQueueRow): DownloadProgress {
  return {
    id: row.id,
    percent: row.percent,
    line: row.line,
    status: row.status,
    path: row.path,
    error: row.error,
    kind: row.kind,
    cancellable: row.cancellable,
    order: row.orderIndex,
    title: row.title ?? undefined,
    retry: retryById.get(row.id),
  };
}

interface DownloadStore {
  items: Record<string, DownloadProgress>;
  pending: string[];
  paused: boolean;
  history: DownloadHistoryItem[];
  hydrated: boolean;
  /** Mirrors a native `download-progress` event; terminal rows are removed. */
  upsert: (progress: DownloadProgress) => void;
  /** Persists a task and lets the native worker run it. */
  enqueue: (task: DownloadTask) => Promise<string>;
  pauseQueue: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  /** Stops an active row or deletes a queued one. */
  cancelQueued: (id: string) => Promise<boolean>;
  removeDownload: (id: string) => void;
  moveQueued: (id: string, direction: -1 | 1) => Promise<void>;
  clearHistory: () => Promise<void>;
  /** Loads persisted queue/history once and resumes interrupted rows. */
  hydrate: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  /** Records a failure that happened before the native worker saw the task. */
  recordFailure: (
    id: string,
    title: string,
    message: string,
    retry?: () => void,
  ) => Promise<void>;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: {},
  pending: [],
  paused: false,
  history: [],
  hydrated: false,

  upsert: (progress) => {
    const terminal =
      progress.status === "done" ||
      progress.status === "error" ||
      progress.status === "cancelled";

    set((state) => {
      const previous = state.items[progress.id];

      if (terminal) {
        if (progress.status === "done") retryById.delete(progress.id);
        else if (progress.retry) retryById.set(progress.id, progress.retry);
        else if (previous?.retry) retryById.set(progress.id, previous.retry);
        const items = { ...state.items };
        delete items[progress.id];
        return { items, pending: pendingFromItems(items) };
      }

      const item: DownloadProgress = {
        ...previous,
        ...progress,
        order: progress.order ?? previous?.order ?? 0,
        title: progress.title ?? previous?.title,
        retry: progress.retry ?? previous?.retry,
      };
      if (item.retry) retryById.set(item.id, item.retry);
      const items = { ...state.items, [item.id]: item };
      return { items, pending: pendingFromItems(items) };
    });

    if (!terminal) return;
    if (progress.status === "done") fireDoneCallback(progress.id);
    // History is written by the worker before it emits the terminal event.
    void get().refreshHistory();
    void api.downloadQueueClearFinished().catch(() => undefined);
  },

  enqueue: (task) => api.downloadEnqueue(task),

  pauseQueue: async () => {
    await api.downloadQueuePause(true);
    set({ paused: true });
  },

  resumeQueue: async () => {
    await api.downloadQueuePause(false);
    set({ paused: false });
  },

  cancelQueued: async (id) => {
    const status = get().items[id]?.status;
    const cancelled = await api.downloadQueueCancel(id);
    if (cancelled && status === "queued") {
      set((state) => {
        const items = { ...state.items };
        delete items[id];
        return { items, pending: pendingFromItems(items) };
      });
    }
    return cancelled;
  },

  removeDownload: (id) =>
    set((state) => {
      const items = { ...state.items };
      delete items[id];
      return { items, pending: pendingFromItems(items) };
    }),

  moveQueued: async (id, direction) => {
    await api.downloadQueueMove(id, direction);
    await get().refreshQueue();
  },

  clearHistory: async () => {
    await api.downloadHistoryClear();
    retryById.clear();
    set({ history: [] });
  },

  hydrate: async () => {
    if (get().hydrated) return;

    // Startup side effects are best-effort: a malformed legacy row or a
    // transient DB error must never hide an already persisted queue.
    try {
      // Re-queue rows left in starting/downloading by a killed process and
      // claim the foreground service while the activity is still visible.
      await api.downloadQueueResume();
    } catch {
      // The worker also resumes on its own connection at app setup.
    }

    try {
      const legacy = readLegacyHistory();
      if (legacy.length > 0) {
        await api.downloadHistoryImport(
          legacy.map((entry) => ({
            ...entry,
            finishedAt: Math.max(1, Math.round(entry.finishedAt / 1000)),
          })),
        );
        clearLegacyHistory();
      }
    } catch {
      // Keep the old history for the next attempt.
    }

    // Terminal rows have already been copied to download_history.
    try {
      await api.downloadQueueClearFinished();
    } catch {
      // A leftover terminal row is harmless; history is still authoritative.
    }

    try {
      const [rows, history, state] = await Promise.all([
        api.downloadQueueList(),
        api.downloadHistoryList(),
        api.downloadQueueState(),
      ]);

      const items: Record<string, DownloadProgress> = {};
      for (const row of rows) {
        if (!isActiveStatus(row.status)) continue;
        items[row.id] = rowToProgress(row);
      }

      set({
        items,
        pending: pendingFromItems(items),
        history: history
          .map((entry) => ({
            ...entry,
            finishedAt: toMillis(entry.finishedAt),
            retry: entry.status === "done" ? undefined : retryById.get(entry.id),
          }))
          .sort((a, b) => b.finishedAt - a.finishedAt)
          .slice(0, HISTORY_LIMIT),
        paused: state.paused,
        hydrated: true,
      });

      // Drop any terminal row written between the list and this call.
      void api.downloadQueueClearFinished().catch(() => undefined);
    } catch {
      // Let the next mount retry; the hook intentionally calls hydrate on
      // every mount while `hydrated` is false.
      set({ hydrated: false });
    }
  },

  refreshQueue: async () => {
    const rows = await api.downloadQueueList();
    const items: Record<string, DownloadProgress> = {};
    for (const row of rows) {
      if (!isActiveStatus(row.status)) continue;
      items[row.id] = rowToProgress(row);
    }
    set({ items, pending: pendingFromItems(items) });
  },

  refreshHistory: async () => {
    const history = await api.downloadHistoryList();
    set({
      history: history
        .map((entry) => ({
          ...entry,
          finishedAt: toMillis(entry.finishedAt),
          retry: entry.status === "done" ? undefined : retryById.get(entry.id),
        }))
        .sort((a, b) => b.finishedAt - a.finishedAt)
        .slice(0, HISTORY_LIMIT),
    });
  },

  recordFailure: async (id, title, message, retry) => {
    if (retry) retryById.set(id, retry);
    const entry: DownloadHistoryItem = {
      id,
      title,
      line: message,
      status: "error",
      path: null,
      error: message,
      finishedAt: Date.now(),
      retry,
    };

    set((state) => {
      const items = { ...state.items };
      delete items[id];
      return { items, pending: pendingFromItems(items) };
    });

    try {
      await api.downloadHistoryImport([
        {
          ...entry,
          finishedAt: Math.max(1, Math.round(entry.finishedAt / 1000)),
        },
      ]);
      await get().refreshHistory();
    } catch {
      // Keep the error visible even if SQLite is temporarily unavailable.
      set((state) => ({
        history: [
          entry,
          ...state.history.filter((existing) => existing.id !== id),
        ].slice(0, HISTORY_LIMIT),
      }));
    }
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as unknown as { __novaDownloads: typeof useDownloadStore }
  ).__novaDownloads = useDownloadStore;
}
