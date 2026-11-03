import { create } from "zustand";
import type { DownloadHistoryItem, DownloadProgress } from "../types";

const HISTORY_KEY = "nova.download.history.v1";
const HISTORY_LIMIT = 80;

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
  upsert: (progress: DownloadProgress) => void;
  enqueue: (ids: string[]) => void;
  nextQueued: () => Promise<string | null>;
  pauseQueue: () => void;
  resumeQueue: () => void;
  cancelQueued: (id: string) => void;
  moveQueued: (id: string, direction: -1 | 1) => void;
  clearHistory: () => void;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: {},
  pending: [],
  paused: false,
  history: readHistory(),

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
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as unknown as { __novaDownloads: typeof useDownloadStore }
  ).__novaDownloads = useDownloadStore;
}
