import { useEffect, useRef } from "react";
import { Menu, ScanLine } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AddToPlaylistModal } from "./components/AddToPlaylistModal";
import { CreatePlaylistModal } from "./components/CreatePlaylistModal";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TrackActionsModal } from "./components/TrackActionsModal";
import { backgroundUrl, isTauri, listenScanProgress } from "./lib/tauri";
import { Downloads } from "./screens/Downloads";
import { Favorites } from "./screens/Favorites";
import { Home } from "./screens/Home";
import { Import } from "./screens/Import";
import { Library } from "./screens/Library";
import { PlaylistDetail } from "./screens/PlaylistDetail";
import { Settings } from "./screens/Settings";
import { Shazam } from "./screens/Shazam";
import { useEqStore } from "./store/eq";
import { useLibraryStore } from "./store/library";
import { usePlayerStore } from "./store/player";
import { useSettingsStore } from "./store/settings";
import { useUiStore } from "./store/ui";

export default function App() {
  const loading = useLibraryStore((state) => state.loading);
  const tracks = useLibraryStore((state) => state.tracks);
  const folders = useLibraryStore((state) => state.folders);
  const error = useLibraryStore((state) => state.error);
  const load = useLibraryStore((state) => state.load);
  const scan = useLibraryStore((state) => state.scan);
  const scanning = useLibraryStore((state) => state.scanning);
  const scanProgress = useLibraryStore((state) => state.scanProgress);
  const setScanProgress = useLibraryStore((state) => state.setScanProgress);
  const queueOpen = useUiStore((state) => state.queueOpen);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const appBackground = useSettingsStore((state) => state.appBackground);
  const backgroundDim = useSettingsStore((state) => state.backgroundDim);
  const autoScan = useSettingsStore((state) => state.autoScan);
  const autoplayOnStart = useSettingsStore((state) => state.autoplayOnStart);

  const hydrated = useRef(false);
  const autoScanStarted = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenScanProgress((progress) => setScanProgress(progress)).then(
      (stop) => {
        unlisten = stop;
      },
    );
    return () => {
      unlisten?.();
      setScanProgress(null);
    };
  }, [setScanProgress]);

  useEffect(() => {
    if (loading) return;
    if (!autoScan || folders.length === 0 || autoScanStarted.current) return;
    autoScanStarted.current = true;
    void scan();
  }, [loading, autoScan, folders.length, scan]);

  useEffect(() => {
    if (loading || tracks.length === 0 || hydrated.current) return;
    hydrated.current = true;
    usePlayerStore.getState().hydrate();
    useEqStore.getState().apply();
    if (autoplayOnStart) {
      const state = usePlayerStore.getState();
      if (state.currentId !== null) {
        window.setTimeout(() => {
          if (!usePlayerStore.getState().isPlaying) {
            usePlayerStore.getState().togglePlay();
          }
        }, 350);
      }
    }
  }, [loading, tracks.length, autoplayOnStart]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const player = usePlayerStore.getState();
      if (event.code === "Space") {
        event.preventDefault();
        player.togglePlay();
      } else if (event.code === "ArrowRight" && event.ctrlKey) {
        event.preventDefault();
        player.next(false);
      } else if (event.code === "ArrowLeft" && event.ctrlKey) {
        event.preventDefault();
        player.prev();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        player.seek(player.positionMs + 5000);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        player.seek(Math.max(0, player.positionMs - 5000));
      } else if (event.code === "KeyM") {
        player.toggleMute();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      const player = usePlayerStore.getState();
      try {
        window.localStorage.setItem("nova.position", String(player.positionMs));
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const bg = backgroundUrl(appBackground);

  if (loading && tracks.length === 0) {
    return (
      <div className="boot-screen">
        <img src="/icon.png" alt="" />
        <h1 className="serif">Nova</h1>
        <p>Читаем библиотеку…</p>
      </div>
    );
  }

  if (error && tracks.length === 0) {
    return (
      <div className="boot-screen">
        <img src="/icon.png" alt="" />
        <h1 className="serif">Nova</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void load()}>
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <>
      {bg ? (
        <div
          className="app-background"
          style={{
            backgroundImage: `url(${bg})`,
            opacity: Math.max(0.12, 1 - backgroundDim / 100),
          }}
        />
      ) : null}

      <div
        className={`app-shell${queueOpen ? "" : " queue-hidden"}${
          mobileNavOpen ? " mobile-nav-open" : ""
        }`}
      >
        <Sidebar />
        <button
          className="mobile-menu"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label="Меню"
        >
          <Menu size={18} />
        </button>
        <main className="main-scroll">
          <div className="global-toolbar">
            {scanning && scanProgress ? (
              <span className="global-scan-status">
                Сканирование {scanProgress.current}/{scanProgress.total}
              </span>
            ) : null}
            <button
              className="secondary-button global-scan-button"
              onClick={() => void scan()}
              disabled={scanning}
            >
              <ScanLine size={15} className={scanning ? "spin" : ""} />
              {scanning ? "Сканирование…" : "Сканировать папки"}
            </button>
          </div>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library key="tracks" />} />
            <Route
              path="/albums"
              element={<Library key="albums" initialTab="albums" />}
            />
            <Route
              path="/folders"
              element={<Library key="folders" initialTab="folders" />}
            />
            <Route
              path="/playlists"
              element={<Library key="playlists" initialTab="playlists" />}
            />
            <Route path="/playlists/:id" element={<PlaylistDetail />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/import" element={<Import />} />
            <Route path="/shazam" element={<Shazam />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <QueuePanel />
        <PlayerBar />
      </div>

      <TrackActionsModal />
      <AddToPlaylistModal />
      <CreatePlaylistModal />
      <EqualizerPanel />
      <NowPlaying />
      <Toasts />
      {!isTauri ? <div className="demo-badge">Демо-режим браузера</div> : null}
    </>
  );
}
