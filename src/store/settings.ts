import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShazamProvider = "builtin" | "audd" | "acrcloud";

interface SettingsState {
  appBackground: string | null;
  nowBackground: string | null;
  backgroundDim: number;
  downloadDir: string;
  ytdlpPath: string;
  shazamProvider: ShazamProvider;
  shazamKey: string;
  autoplayOnStart: boolean;
  autoScan: boolean;
  setAppBackground: (path: string | null) => void;
  setNowBackground: (path: string | null) => void;
  setBackgroundDim: (value: number) => void;
  setDownloadDir: (value: string) => void;
  setYtdlpPath: (value: string) => void;
  setShazamProvider: (value: ShazamProvider) => void;
  setShazamKey: (value: string) => void;
  setAutoplayOnStart: (value: boolean) => void;
  setAutoScan: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appBackground: null,
      nowBackground: null,
      backgroundDim: 45,
      downloadDir: "",
      ytdlpPath: "",
      shazamProvider: "builtin",
      shazamKey: "",
      autoplayOnStart: false,
      autoScan: true,
      setAppBackground: (path) => set({ appBackground: path }),
      setNowBackground: (path) => set({ nowBackground: path }),
      setBackgroundDim: (value) =>
        set({ backgroundDim: Math.max(0, Math.min(80, value)) }),
      setDownloadDir: (value) => set({ downloadDir: value }),
      setYtdlpPath: (value) => set({ ytdlpPath: value }),
      setShazamProvider: (value) => set({ shazamProvider: value }),
      setShazamKey: (value) => set({ shazamKey: value }),
      setAutoplayOnStart: (value) => set({ autoplayOnStart: value }),
      setAutoScan: (value) => set({ autoScan: value }),
    }),
    { name: "nova-settings" },
  ),
);
