import { useEffect, useLayoutEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { AddToPlaylistModal } from "./components/AddToPlaylistModal";
import { AndroidGate } from "./components/AndroidGate";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CreatePlaylistModal } from "./components/CreatePlaylistModal";
import { EditTrackModal } from "./components/EditTrackModal";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { LyricsModal } from "./components/LyricsModal";
import { MergeAlbumsModal } from "./components/MergeAlbumsModal";
import { MobileMenuButton } from "./components/MobileMenuButton";
import { MobileNav } from "./components/MobileNav";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { PostScanChecks } from "./components/PostScanChecks";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TrackActionsModal } from "./components/TrackActionsModal";
import {
  api,
  backgroundUrl,
  isTauri,
  listenScanProgress,
} from "./lib/tauri";
import { isAndroid } from "./lib/platform";
import { Downloads } from "./screens/Downloads";
import { Favorites } from "./screens/Favorites";
import { Home } from "./screens/Home";
import { Import } from "./screens/Import";
import { Library } from "./screens/Library";
import { PlaylistDetail } from "./screens/PlaylistDetail";
import { Settings } from "./screens/Settings";
import { Shazam } from "./screens/Shazam";
import { useDownloadSync } from "./hooks/useDownloadProgress";
import { useEqStore } from "./store/eq";
import { useLibraryStore } from "./store/library";
import { usePlayerStore } from "./store/player";
import { useSelectionStore } from "./store/selection";
import { useSettingsStore } from "./store/settings";
import { useUiStore } from "./store/ui";

export default function App() {
  const location = useLocation();
  const mainScrollRef = useRef<HTMLElement>(null);

  // A route change should start at the top of the page, especially on a phone
  // where the previous screen may have been scrolled far down. Layout effect
  // runs before paint, so the old offset is never shown for a frame.
  useLayoutEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Install the download listeners and hydrate the native queue at app start,
  // not only when Downloads/Import is opened. This variant does not subscribe
  // the root to progress events.
  useDownloadSync();

  useEffect(() => {
    if (!isAndroid) return;
    const handled = new Set<string>();
    const importOpened = async () => {
      if (document.visibilityState !== "visible") return;
      const opened = await api.androidTakeOpenedFile();
      if (opened.path && !handled.has(opened.path)) {
        handled.add(opened.path);
        const directory = opened.path.substring(
          0,
          opened.path.lastIndexOf("/"),
        );
        await useLibraryStore.getState().addFolder(directory);
        const name = opened.path.split("/").pop() ?? "файл";
        useUiStore
          .getState()
          .notify(`Добавлено в библиотеку: ${name}`, "success");
        window.location.hash = "#/library";
      }
      if (opened.error) {
        useUiStore.getState().notify(opened.error, "error");
      }
    };
    void importOpened();
    const interval = window.setInterval(() => void importOpened(), 3000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void importOpened();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Android: ask once for the battery exemption so playback keeps running in
  // the background. The Settings section is gone; this is the default.
  useEffect(() => {
    if (!isAndroid) return;
    const key = "nova.battery.permissionAsked";
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    void api
      .androidBatteryState()
      .then((state) => {
        if (!state.ignoring) return api.androidRequestIgnoreBattery();
      })
      .catch(() => {
        // The system may reject the request; playback still works in the app.
      });
  }, []);

  const loading = useLibraryStore((state) => state.loading);
  const tracks = useLibraryStore((state) => state.tracks);
  const folders = useLibraryStore((state) => state.folders);
  const error = useLibraryStore((state) => state.error);
  const load = useLibraryStore((state) => state.load);
  const scan = useLibraryStore((state) => state.scan);
  const setScanProgress = useLibraryStore((state) => state.setScanProgress);
  const queueOpen = useUiStore((state) => state.queueOpen);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const appBackground = useSettingsStore((state) => state.appBackground);
  const backgroundDim = useSettingsStore((state) => state.backgroundDim);
  const theme = useSettingsStore((state) => state.theme);
  const autoScan = useSettingsStore((state) => state.autoScan);
  const autoplayOnStart = useSettingsStore((state) => state.autoplayOnStart);

  const hydrated = useRef(false);
  const autoScanStarted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    if (!isAndroid) return;
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(({ canGoBack }) => {
      const ui = useUiStore.getState();
      if (ui.nowPlayingOpen) {
        ui.setNowPlayingOpen(false);
        return;
      }
      if (ui.queueOpen) {
        ui.setQueueOpen(false);
        return;
      }
      if (ui.mobileNavOpen) {
        ui.setMobileNavOpen(false);
        return;
      }
      if (ui.trackActionsTrackId !== null) {
        ui.openTrackActions(null);
        return;
      }
      if (ui.addToPlaylistTrackIds !== null) {
        ui.openAddToPlaylist(null);
        return;
      }
      if (ui.editTrackId !== null) {
        ui.openEditTrack(null);
        return;
      }
      if (ui.mergeAlbumSeed !== null) {
        ui.openMergeAlbums(null);
        return;
      }
      if (ui.createPlaylistOpen) {
        ui.setCreatePlaylistOpen(false);
        return;
      }
      if (ui.equalizerOpen) {
        ui.setEqualizerOpen(false);
        return;
      }
      if (ui.lyricsTrackId !== null) {
        ui.openLyrics(null);
        return;
      }
      const selection = useSelectionStore.getState();
      if (selection.selected.size > 0 || selection.selecting) {
        selection.clear();
        return;
      }
      const hash = window.location.hash;
      const atRoot = hash === "" || hash === "#" || hash === "#/";
      if (atRoot) {
        void api.androidMinimizeApp();
      } else if (canGoBack) {
        window.history.back();
      } else {
        void api.androidMinimizeApp();
      }
    }).then((listener) => {
      unlisten = () => void listener.unregister();
    });
    return () => unlisten?.();
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
        {mobileNavOpen ? (
          <MobileMenuButton className="mobile-menu-global" />
        ) : null}
        <main className="main-scroll" ref={mainScrollRef}>
          <Routes>
            <Route
              path="/"
              element={
                <AndroidGate>
                  <Home />
                </AndroidGate>
              }
            />
            <Route
              path="/library"
              element={
                <AndroidGate>
                  <Library key="tracks" />
                </AndroidGate>
              }
            />
            <Route
              path="/albums"
              element={
                <AndroidGate>
                  <Library key="albums" initialTab="albums" />
                </AndroidGate>
              }
            />
            <Route
              path="/folders"
              element={
                <AndroidGate>
                  <Library key="folders" initialTab="folders" />
                </AndroidGate>
              }
            />
            <Route
              path="/playlists"
              element={
                <AndroidGate>
                  <Library key="playlists" initialTab="playlists" />
                </AndroidGate>
              }
            />
            <Route
              path="/playlists/:id"
              element={
                <AndroidGate>
                  <PlaylistDetail />
                </AndroidGate>
              }
            />
            <Route
              path="/favorites"
              element={
                <AndroidGate>
                  <Favorites />
                </AndroidGate>
              }
            />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/import" element={<Import />} />
            <Route path="/shazam" element={<Shazam />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <QueuePanel />
        <PlayerBar />
        <MobileNav />
      </div>

      <TrackActionsModal />
      <AddToPlaylistModal />
      <CreatePlaylistModal />
      <EqualizerPanel />
      <NowPlaying />
      <LyricsModal />
      <EditTrackModal />
      <MergeAlbumsModal />
      <PostScanChecks />
      <ConfirmDialog />
      <Toasts />
      {!isTauri ? <div className="demo-badge">Демо-режим браузера</div> : null}
    </>
  );
}
