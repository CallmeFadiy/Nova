# Nova — Mobile Now Playing and Settings Cleanup

**Goal:** Rework the mobile Now Playing screen, add two burger-menu entries, and
reduce Settings to the essential sections. Move duplicate/encoding/missing-file
checks to automatic post-scan maintenance.

**Date:** 2026-11-10
**Branch:** `feat/mobile-now-playing-settings`
**Approved mockup:** `.superpowers/sdd/mockups6/nova-mobile-now-playing-and-settings.png`

## Decisions

- Now Playing: option C — like and lyrics buttons sit on the cover, progress and
  transport live in a fixed bottom dock. Remove the secondary icon row on mobile
  (volume, equalizer, queue, heart/lyrics duplicate). App bottom navigation on
  other screens stays.
- Burger menu: add `Эквалайзер` and `Тексты песен`. Lyrics opens the text for
  the current track plus a track search.
- Settings stays: folders, appearance, notifications, playback, about.
- Settings loses: downloads/yt-dlp, Android background work, lyrics cache,
  recognition, duplicates, missing files, tag encoding, and the equalizer row
  (moved to the burger).
- Post-scan: missing records are cleaned automatically with a toast; duplicate
  and encoding checks run automatically and open their existing preview modals.
- Android background work: ask for the battery exemption once on first launch.
- Mobile sound/dimming sliders use the compact desktop-style row.
- Shazam: remove the `Найдём и предложим` and `Два провайдера` info blocks.
- Import: remove the three step cards, the DRM note, and the demo-list hint.

## Changes

- [x] Now Playing structure: cover actions, transport dock, mobile CSS.
- [x] Sidebar actions for equalizer and lyrics; lyrics track search.
- [x] Settings section removal + compact slider rows.
- [x] Global post-scan maintenance component and modals.
- [x] Android first-launch battery request.
- [x] Shazam and Import block removal.
- [x] Build, desktop verification, docs; phone install pending reconnect.

## Verification

- [x] Browser 392×800: Now Playing dock fixed at 697–800 px, cover actions,
  secondary row hidden; no horizontal overflow.
- [x] Browser 1440×900: desktop Now Playing keeps the inline transport and
  secondary row; cover actions hidden.
- [x] Settings: only five sections (folders, appearance, notifications,
  playback, Nova); mobile sliders use the compact desktop row.
- [x] Desktop app: rebuilt, sidebar shows both new items; startup scan opened
  the automatic tag-encoding preview (21 fields) without applying it.
- [x] Shazam/Import: removed blocks verified absent in the browser.
- [x] `cargo test --lib` — 38 passed; `npm.cmd run build:web` — exit 0.
- [x] Windows: `Nova.exe` 24 198 656 bytes, installers/zip refreshed.
- [x] Android APK: 67 610 079 bytes,
  SHA-256 `6D14DFED5BA534068624F2BF6B328A5CF7DC808B5AA2CEC2C368366C68E73BDF`.
  Installed on `7ac47954`: Now Playing with cover actions and fixed dock,
  burger items, lyrics search, five Settings sections and compact sliders
  verified on device.
