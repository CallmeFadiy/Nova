# Nova Android Phase 2C–2D — Recognition, Lyrics, Polish and Release

**Goal:** Finish Android phase 2: recognition (microphone, file, system audio),
lyrics, share/open-with, MIUI background settings, release APK and the final
touch/accessibility acceptance.

**Architecture:** AudD is the Android recognition provider; the bundled
`songrec` fingerprint engine stays Windows-only (it panics on Android). System
audio uses `MediaProjection` + `AudioPlaybackCapture` in a short-lived
`mediaProjection` foreground service that writes a 16 kHz mono WAV, which Rust
uploads to AudD. Share/open uses `FileProvider`; `ACTION_VIEW` imports into
`/sdcard/Download/NovaInbox`. The rest reuses the existing Rust core/UI.

**Spec:** `docs/specs/2026-11-07-nova-android-design.md` (4.4, 6.3, 9, 11)
**Roadmap:** `docs/plans/2026-11-08-android-phase2-roadmap.md`

## Global Constraints

- Android 10+ (minSdk 29), targetSdk 36; phone `7ac47954` (Android 13, arm64).
- `/sdcard/Music` unchanged; imported/shared test files only in
  `/sdcard/Download/...`.
- Windows: `npm.cmd run build:web`,
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
- 392 CSS px, no horizontal overflow, 44 px controls.
- No Play Store release yet; a locally signed release APK is enough.

## 2C — Recognition and lyrics

- [x] Runtime `RECORD_AUDIO` permission via a Tauri permission alias.
- [x] Android routes recognition to AudD; built-in Shazam returns a clear
  Windows-only error instead of panicking.
- [x] `recognize_audd_file` uploads a picked audio file to AudD.
- [x] `NovaProjectionService`: MediaProjection consent, `mediaProjection`
  foreground service, `AudioPlaybackCapture`, 16 kHz mono WAV.
- [x] System-audio AudD path on Android; microphone still uses the Rust cpal
  capture (works on Android).
- [x] Lyrics (`get_lyrics`, cache, editor) verified on the phone; Genius 403
  falls back to LRCLIB with synced LRC.
- [x] Device checks: microphone permission dialog, AudD auth error with a fake
  key, file upload, projection consent/capture, lyrics.

## 2D — Polish and release

- [x] Share and open-with actions in the track sheet via `FileProvider`.
- [x] `ACTION_VIEW` audio/video intent filter and import to `NovaInbox`.
- [x] MIUI battery optimization/autostart controls in Settings.
- [x] Release signing config (`keystore.properties`, local keystore ignored).
- [ ] Build/verify a signed release APK.
- [x] 392 px/44 px/safe-area audit across all screens (26 checks; one Shazam
  source-switch fix, needs the final APK rebuild).
- [ ] Final device acceptance and docs.
