# Nova — Mobile Refinement and UI Cleanup

**Goal:** Refine the compact current-track card, align the mobile menu with page
titles, replace the drawer burger with a back arrow, remove the Settings menu
button, switch Library selection to long-press, compact the search/sort row,
restyle the dim/volume controls, embed the AudD token, and remove the approved
copy bloat on desktop and mobile.

**Date:** 2026-11-10
**Branch:** `feat/mobile-refine-cleanup`
**Approved mockups:** card variant A, slider variant A.

## Mobile UI

- [x] Card variant A: 132 px cover, 40 px play/shuffle/open targets, 1 pt smaller
  typography, ~157 px height.
- [x] Reusable `MobileMenuButton`: burger on page-title rows; back arrow while
  the drawer is open; floating arrow over the open drawer.
- [x] Settings has no menu button.
- [x] Library: header counts removed (date only), long-press enters selection,
  mobile “Выбрать” hidden, track actions remain on “…”.
- [x] Library search is 3/4 width; compact sort button with native option menu.
- [x] Dim and volume controls use the card design with large value, icons,
  slider and 0–80/100% labels.

## API key and cleanup

- [x] Remove the API-key field and `shazamKey` from the persisted settings; add
  a versioned migration that deletes the legacy value.
- [x] Embed the AudD token in Rust; recognition commands no longer accept a token
  from the frontend.
- [x] Remove folder, notification and background-work hints; remove the
  notification badge “в приложении”; remove both duplicate hints.
- [x] Library/Albums header counts removed; tab and sidebar counters kept.
- [x] Downloads: remove “поиск, ссылки, yt-dlp”, confirmation text, both
  section subtitles, empty-search hint and the bottom quality/folder/automatic
  block. Keep the top download-folder card.
- [x] Desktop and mobile share the cleanup; desktop keeps its large hero card,
  sort select and existing settings slider rows.

## Verification

- [x] Web audit at 392×794: 10 routes, no overflow; all controls except the
  intentionally smaller 40 px card buttons are ≥ 44 px; long-press selects one
  track without opening the actions modal; sort/search width 3:1.
- [x] Desktop 1440×900: no header counts, mobile menu/back arrow hidden,
  desktop sort select visible, desktop settings sliders unchanged.
- [x] Phone `7ac47954`: card, menu behavior, drawer back arrow, Settings without
  burger, long-press selection, search+sort, dim/volume cards, no API-key field,
  cleaned Downloads.
- [x] Windows: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38
  passed; `npm.cmd run build:web` — exit 0.
- [x] Release APK: 67 611 859 bytes,
  SHA-256 `8FE766E8475E4E8F0CDBE07C83C687BDB07D34F0EF292266B89BDC82C0EA740C`.

## Accepted limitations

- The embedded AudD key is extractable from the APK; it is hidden from the UI,
  not from a determined reverse engineer.
- The compact card uses 40 px buttons by request, below the usual 44 px target.
