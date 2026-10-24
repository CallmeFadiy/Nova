import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "../lib/audio";
import { BUILTIN_PRESETS, type EqPreset } from "../lib/eq";

interface EqState {
  enabled: boolean;
  bands: number[];
  preamp: number;
  presetId: string;
  customPresets: EqPreset[];
  setEnabled: (enabled: boolean) => void;
  setBand: (index: number, value: number) => void;
  setPreamp: (value: number) => void;
  applyPreset: (preset: EqPreset) => void;
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;
  reset: () => void;
  apply: () => void;
}

const FLAT = BUILTIN_PRESETS[0];

export const useEqStore = create<EqState>()(
  persist(
    (set, get) => ({
      enabled: true,
      bands: [...FLAT.bands],
      preamp: FLAT.preamp,
      presetId: FLAT.id,
      customPresets: [],

      setEnabled: (enabled) => {
        set({ enabled });
        get().apply();
      },

      setBand: (index, value) => {
        const bands = [...get().bands];
        bands[index] = Math.max(-12, Math.min(12, value));
        set({ bands, presetId: "custom" });
        get().apply();
      },

      setPreamp: (value) => {
        set({ preamp: Math.max(-12, Math.min(12, value)), presetId: "custom" });
        get().apply();
      },

      applyPreset: (preset) => {
        set({
          bands: [...preset.bands],
          preamp: preset.preamp,
          presetId: preset.id,
        });
        get().apply();
      },

      savePreset: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const preset: EqPreset = {
          id: `custom-${Date.now()}`,
          name: trimmed,
          bands: [...get().bands],
          preamp: get().preamp,
          builtin: false,
        };
        set((state) => ({
          customPresets: [...state.customPresets, preset],
          presetId: preset.id,
        }));
      },

      deletePreset: (id) => {
        const preset = get().customPresets.find((item) => item.id === id);
        if (!preset) return;
        set((state) => ({
          customPresets: state.customPresets.filter((item) => item.id !== id),
          ...(state.presetId === id
            ? {
                bands: [...FLAT.bands],
                preamp: FLAT.preamp,
                presetId: FLAT.id,
              }
            : {}),
        }));
        get().apply();
      },

      reset: () => {
        set({
          bands: [...FLAT.bands],
          preamp: FLAT.preamp,
          presetId: FLAT.id,
          enabled: true,
        });
        get().apply();
      },

      apply: () => {
        const { enabled, bands, preamp } = get();
        audioEngine.setEq({ enabled, bands, preamp });
      },
    }),
    { name: "nova-eq" },
  ),
);
