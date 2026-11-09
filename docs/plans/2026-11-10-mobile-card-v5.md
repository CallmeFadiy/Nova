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

## Accepted limitation

- Play/shuffle are 32 px by explicit request, below the general 44 px touch
  target. The rest of the mobile controls keep 44 px.
