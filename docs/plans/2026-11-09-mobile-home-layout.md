# Nova — Mobile Home Layout

**Goal:** Mobile-only adjustments to the Home screen: move the menu button to the
right on the greeting line, remove the scanner and shuffle actions from Home,
and make the current-track card compact.

**Date:** 2026-11-09
**Branch:** `feat/mobile-home-layout`
**Approved mockup:** Variant A — compact horizontal card.

## Changes

- [x] Render the mobile menu inside the Home header, on the same line as
  «Добрый вечер»; the global floating menu on other screens moves to the top
  right.
- [x] Keep a floating close button over the sidebar when the drawer is open.
- [x] Hide the Home header actions on mobile: scanner and shuffle are no longer
  on Home. Hide the Library scan button on mobile too, so the scanner remains
  only in Settings.
- [x] Compact current-track card: 140 px cover, two-column layout, title/artist,
  chips, progress, play, shuffle icon and «Открыть»; hide
  «Играть всю библиотеку» on mobile.
- [x] Keep touch targets at least 44 px.
- [x] Desktop layout unchanged: Home actions remain, desktop hero stays
  300 px, the mobile menu is not rendered on desktop.

## Verification

- [x] 392×794 browser audit: no horizontal overflow, all controls ≥ 44 px,
  10 routes; menu right at 12 px on non-Home pages; Home menu right at 16 px
  and vertically centered with the greeting.
- [x] Desktop 1440×900: Home menu hidden, header actions visible, hero columns
  `300px …`.
- [x] Phone `7ac47954`: Home shows the menu on the greeting line, no
  scan/shuffle buttons, compact card with the full cover, «Недавно
  добавленные» above the fold.
- [x] Windows: `npm.cmd run build:web` — exit 0; cargo tests unaffected (38).
- [x] Release APK: 67 612 255 bytes,
  SHA-256 `3FC3BD402D32197F88DB161899F96E2CCB8DB03B2325F5459F15B577E021AD39`.
