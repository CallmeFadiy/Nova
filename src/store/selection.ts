import { create } from "zustand";

interface SelectionState {
  selected: Set<number>;
  anchorIndex: number | null;
  selectOnly: (id: number, index: number) => void;
  toggle: (id: number, index: number) => void;
  selectRange: (ids: number[], anchorIndex: number) => void;
  retain: (ids: Iterable<number>) => void;
  clear: () => void;
}

/**
 * Shared track selection. Lives outside `TrackTable` so the Android back
 * handler in `App.tsx` can clear the selection after closing modals.
 */
export const useSelectionStore = create<SelectionState>((set) => ({
  selected: new Set<number>(),
  anchorIndex: null,

  selectOnly: (id, index) =>
    set({ selected: new Set([id]), anchorIndex: index }),

  toggle: (id, index) =>
    set((state) => {
      const next = new Set(state.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next, anchorIndex: index };
    }),

  selectRange: (ids, anchorIndex) =>
    set({ selected: new Set(ids), anchorIndex }),

  retain: (ids) =>
    set((state) => {
      const available = new Set(ids);
      const next = new Set(
        [...state.selected].filter((id) => available.has(id)),
      );
      if (next.size === state.selected.size) return state;
      return { selected: next };
    }),

  clear: () => set({ selected: new Set<number>(), anchorIndex: null }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __novaSelection: typeof useSelectionStore })
    .__novaSelection = useSelectionStore;
}
