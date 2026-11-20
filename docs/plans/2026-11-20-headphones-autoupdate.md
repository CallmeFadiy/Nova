# Nova — Headphone Resume and Android Update

**Goal:** Add “continue on headphone connect” and an in-app Android update flow
from the project’s GitHub Releases.

**Date:** 2026-11-20
**Branch:** `feat/headphones-autoupdate`

## Decisions

- Headphone resume is Android-only. A setting in Playback enables it; default is
  off. If playback was paused by unplugging headphones, reconnecting headphones
  resumes it. A manual pause (UI or headset button routed through the app)
  cancels the pending resume.
- Android update: check the latest stable GitHub release, download the arm64 APK
  to cache, verify SHA-256, verify package name/version/signature in Kotlin,
  then open the system installer. The user always confirms installation.
- “Автообновление” checks on startup when enabled and shows a prompt; the user
  can also check manually from Settings. Windows keeps manual installers.

## Changes

- [x] Android service audio-device callback and noisy receiver.
  - `NovaPlaybackService` pauses on `ACTION_AUDIO_BECOMING_NOISY`, remembers the
    pending resume, and resumes on the next headphone device addition.
  - A manual pause clears the pending resume; a 1.5 s grace window keeps the
    unplug pause itself from clearing it.
- [x] Setting + native bridge for resume on headphones.
  - `resumeOnHeadphones` in Settings (default off, Android only), synced at
    startup and on change through `android_set_resume_on_headphones`.
- [x] GitHub update check/download commands, progress event, SHA-256.
  - `updater.rs` uses `api.github.com/repos/CallmeFadiy/Nova/releases/latest`,
    requires the `Nova-*-android-arm64.apk` asset, downloads to
    `cache/updates`, emits `update-progress`, verifies GitHub’s `sha256:` digest
    and removes older cached APKs.
- [x] Kotlin APK verification and installer intent.
  - `installApk` checks `REQUEST_INSTALL_PACKAGES`, package name, a higher
    version code and the signing certificate before opening the installer.
- [x] Update modal + Settings section.
  - `UpdateModal` shows version, size, notes, hash, progress, permission and
    error states; Settings has an Android-only “Обновления” section.
  - Startup check runs once when `autoUpdate` is on (default on); manual check
    always reports “последняя версия” or opens the prompt.
- [ ] Physical update install test — blocked until a release newer than the
  installed `0.1.0` exists (or a throwaway test release is published).
- [x] Build and install on the phone; verify the setting, headphone resume and
  the “up to date” check without touching `/sdcard/Music`.

## Verification

- `npm.cmd run build:web`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` (38 passed)
- `npm.cmd run tauri -- android build --apk --target aarch64`
  - APK: `app-universal-release.apk`, 67 811 263 bytes
  - SHA-256: `2D9EF4376B3514B23980DEF9CCDB453998884F667B0D6677D3ECD86ED7C1721B`
- `adb -s 7ac47954 install -r <apk>` — success, versionCode 1000 preserved.
- Settings: “Продолжать при подключении наушников” toggled on without an error;
  “Проверить” showed “У вас последняя версия Nova”.
- Headphone test with Bluetooth YYK-Q16 (15 s disconnect):
  - `02:28:28.628 broadcast ACTION_AUDIO_BECOMING_NOISY`
  - `02:28:28.632 player piid:695 state:paused` — Nova paused on unplug.
  - `02:28:43.181 player piid:695 state:started` — Nova resumed on reconnect.
- `/sdcard/Music` was not modified; the library scan was read-only.
