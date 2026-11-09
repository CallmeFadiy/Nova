# Nova — Remove Track Hiding and Mobile Polish

**Goal:** Remove the “hide a track without deleting the file” feature on desktop
and Android, keep only “delete track and file”, reuse the desktop Nova icon on
Android, and make the mobile layout respect phone display insets.

**Date:** 2026-11-09
**Branch:** `feat/remove-hide-mobile-polish`

## 1. Remove hiding

- [x] Remove “Скрыть из альбома” and its note from the track actions sheet.
- [x] Remove the “Скрытые треки” settings section and restore button.
- [x] Remove `hideTrack`/`restoreTrack` from the store, API and demo data.
- [x] Remove the `hidden` field from the `Track` model and snapshot query.
- [x] Remove Rust `hide_track`/`restore_track` commands and registrations.
- [x] Drop the legacy `hidden_tracks` table during schema migration so every
  previously hidden track becomes visible again; files are not touched.
- [x] Keep only “Удалить трек и файл” as the delete action.
- [x] Unit test: legacy `hidden_tracks` is dropped, the track row survives.

## 2. Android icon

- [x] Generate Android mipmaps and adaptive icon from the desktop
  `src-tauri/icons/icon.png` (white headphones).
- [x] Use a `#0B0B0D` adaptive background and add a round icon.
- [x] Verify the icon in the phone launcher.

## 3. Mobile display insets

- [x] Add `viewport-fit=cover`.
- [x] Apply safe-area insets to main scroll, mobile menu, sidebar, player bar,
  bottom navigation, queue, Now Playing, modals and toasts.
- [x] Reset page scroll on route changes.
- [x] Verify all 10 screens at 392 CSS px and on the phone: no horizontal
  overflow, controls ≥ 44 px, no status-bar/system-navigation overlap.

## 4. Acceptance

- [x] Hide a track in the old release, install the new APK over it, confirm the
  track returns and its file remains (`911 (4 Раунд)`,
  `/sdcard/Music/Тони Раут - 911.mp3`).
- [x] Confirm Settings no longer has “Скрытые треки” and track actions no longer
  offer “Скрыть из альбома”.
- [x] Confirm the API key survives the in-place update.
- [x] Windows: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38
  passed; `npm.cmd run build:web` — exit 0.
- [x] Release APK: 67 757 631 bytes,
  SHA-256 `3BF8A05D0318222E7B61C412BFC7B1C69DEAC5127DEE17EB160454BD064D8A1A`.
- [x] `/sdcard/Music` — 104 files, 78 tracks; test files and folders removed.
