# Nova — Mobile Card Variant 5

**Goal:** Apply the approved mobile-only current-track card and header spacing.

**Date:** 2026-11-10
**Branch:** `feat/mobile-card-v5`
**Approved mockup:** `.superpowers/sdd/mockups3/nova-card-5-variants.png`
(Variant 5, with the label inside the frame and an upward-only indicator).

## Changes

- [x] Mobile header top padding reduced from 62 px to 30 px; date margin reduced
  so it sits closer to the greeting.
- [x] Card variant 5: 132 px cover, 32 px play/shuffle, title 19 px, artist 8 px,
  time labels 5.5 px, no metadata chips, no “Открыть”, ~139 px height.
- [x] “Продолжить слушать” sits inside the inner frame; progress times and
  controls stay inside the frame too.
- [x] Playing bars animate only upward from a bottom origin and stop when playback
  is paused; static low bars remain visible while paused.
- [x] Desktop card and desktop controls unchanged.

## Verification

- [x] Browser measurements at 392×794: eyebrow/play/shuffle/time labels inside
  the inner frame; no horizontal overflow.
- [x] Play/pause test: `eq` animation with `animation-direction: normal` and
  bottom origin while playing; `animation: none` and static bars when paused.
- [x] Phone `7ac47954`: header spacing, card, missing “Открыть”, label inside
  frame and static bars while paused.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38 passed;
  `npm.cmd run build:web` — exit 0.
- [x] Release APK: 67 611 487 bytes,
  SHA-256 `4FA48B8470E0E42A298BBCB1777EA16AE4F6890B0FD55BAA33F20A5B17A6608A`.

## Follow-up: image A and Android AudD (2026-11-10)

**Branch:** `feat/mobile-card-image-audtdisable`
**Approved mockup:** `.superpowers/sdd/mockups4/card-image-options-6.png`
(option A).

### Changes

- [x] Card image option A: the cover is a square on the inner frame’s top,
  left and bottom edges. It is 121 px when the title fits one line and grows
  with the card (about 140 px) when the title needs two lines.
- [x] The artwork is fitted inside the square (`object-fit: contain`), so it
  never spills outside the inner frame; non-square art is letterboxed rather
  than cropped.
- [x] The mobile title is clamped to two lines with an ellipsis, so an
  arbitrarily long title cannot push the card or the square past the frame.
- [x] AudD is disabled on Android only. The provider reads “AudD (временно
  отключён)”, Shazam shows “Распознавание временно недоступно” and disables
  both recognition buttons, and the Rust commands return
  “AudD временно отключён на Android”.
- [x] The AudD implementation and embedded key remain in the build. Windows
  AudD is unchanged and still active.
- [x] Slider cards for dimming and notification volume are unchanged by
  request.

### Verification

- [x] Browser at 392×794: one-line title → 121×121, two-line title →
  139.7×139.7; both aligned to the inner frame top/left/bottom; no horizontal
  overflow.
- [x] Desktop at 1440×900: card image remains 300×300 in a 300 px column.
- [x] Phone `7ac47954`: image square flush to the frame on both a long and a
  short title; Settings shows the disabled provider; Shazam shows the
  unavailable state; playing indicator freezes when paused.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38 passed;
  `npm.cmd run build:web` — exit 0.
- [x] Release APK: 67 611 927 bytes,
  SHA-256 `936878FBE7561821EE5693B63C9574E869A444E3C2DF83528DB7A25B83348352`.

## Accepted limitation

- Play/shuffle are 32 px by explicit request, below the general 44 px touch
  target. The rest of the mobile controls keep 44 px.
