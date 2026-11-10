# Nova — Compact Track Menu and Date Spacing

**Goal:** Make the desktop and Android track menus more compact, remove the
technical file path, and bring the weekday/date line closer to the page heading.

**Date:** 2026-11-10
**Branch:** `feat/compact-track-menu`
**Approved mockup:** `.superpowers/sdd/mockups5/nova-compact-menus-and-date.png`

## Decisions

- Desktop: option A, a single-column compact list (380 px wide, 31 px rows,
  grouped by separators).
- Android: option A, a compact bottom sheet with 44 px rows.
- Remove the file path from the track menu. Keep the artist subtitle and all
  actions unless the user asks for more removals.
- Date: capitalize the weekday and remove the comma: `Вторник 10 ноября`.
- Move the date line closer to the greeting/page title on Home and Library
  (desktop and Android).
- The `Скрыть из альбома` item is already absent from the current source; the
  user's screenshot came from an older desktop build. Rebuild and verify.

## Changes

- [x] Add a shared `formatWeekdayDate()` helper and use it on Home and Library.
- [x] Add `date-line` spacing on Home and Library only.
- [x] Pass the track title/artist into `Modal`'s header and remove the extra
  empty header row plus `.modal-path`.
- [x] Style `.track-actions-dialog` for the desktop compact list and the
  44 px Android sheet; keep separators before share/edit/favorite/delete groups.
- [x] Keep desktop >900 px unaffected outside the dialog.

## Verification

- [x] Browser at 1440×900: dialog 380×366, no path, 31 px rows; date is
  `Вторник 10 ноября` and 1 px from the greeting box.
- [x] Browser at 392×794: bottom sheet 44 px rows, 11 items with Android
  actions, no path; date spacing on Home and Library.
- [x] Desktop app: rebuilt `Nova.exe` (24 202 752 bytes) runs; date visible;
  built bundle has no `Скрыть из альбома`, `.modal-path` or
  `.track-actions-head` strings.
- [x] Android APK: 67 612 655 bytes,
  SHA-256 `241D2B2DA203127D1C5EC53D05AAA9E28544AF6F71A711DA4D1D285A2BAE8935`;
  installed on `7ac47954`. Phone screen was locked at the end, so the final
  on-device menu screenshot is pending unlock.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38 passed;
  `npm.cmd run build:web` — exit 0.
