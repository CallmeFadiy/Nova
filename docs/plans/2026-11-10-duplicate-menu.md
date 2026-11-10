# Nova — Compact Duplicate Menu

**Goal:** Replace the mobile duplicate cleanup sheet with the approved compact
“what to keep” picker, add a mandatory second confirmation, and stop opening the
sheet automatically after a scan.

**Date:** 2026-11-10
**Branch:** `feat/mobile-duplicate-menu`
**Approved mockup:** `.superpowers/sdd/mockups7/nova-duplicate-menu-mockups.png`
(option B).

## Decisions

- Mobile: radio selection — choose the file to keep; the rest are marked
  “Будет удалён”.
- Show filename, size and duration; do not show the full path.
- Always ask a second time before deleting files from disk.
- After a scan, show a toast “Найдены дубликаты: N” with an “Открыть” button;
  do not open the cleanup sheet automatically.
- Desktop keeps its existing list layout; its delete action also asks for
  confirmation.

## Changes

- [x] Mobile compact duplicate picker with group cards and keep radios.
- [x] “Не трогать” per group; footer summary “Оставить X · удалить Y”.
- [x] Second confirmation dialog with the file count and an irreversible-action
      warning.
- [x] Action toast support and notification-only duplicate discovery.
- [x] Removed full paths from the compact rows.

## Verification

- [x] Browser 392×800: compact picker, radio selection, footer count, second
      confirmation; no overflow.
- [x] Toast action opens the picker; no automatic duplicate modal.
- [x] Desktop duplicate dialog still uses its list layout and asks for
      confirmation.
- [x] Android APK: 67 610 279 bytes,
      SHA-256 `3FF3B65D9508251B9508C75D835E230F5F45A099A0F96A503E14BD160EFA8200`;
      installed on `7ac47954`. No duplicate pair was left in Music, so the
      on-device toast/picker could not be re-triggered without a test folder;
      the compact picker was verified in the 392 px browser build.
- [x] `cargo test --lib` — 38 passed; `npm.cmd run build:web` — exit 0.
- [x] Windows `Nova.exe` rebuilt (24 198 656 bytes); installers/zip refreshed.
