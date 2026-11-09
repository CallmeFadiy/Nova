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
- [x] Device checks: microphone permission, AudD upload with the public `test`
  token (file, microphone and system capture return AudD fingerprint/no-match,
  proving the file is received), projection consent/capture, lyrics.
- [x] 12-second preview extraction (`symphonia`, 16 kHz mono WAV) for files
  larger than AudD's 10 MB limit; smaller files are still uploaded whole.
  Verified both paths with the public `test` token: 8.9 MB MP3 (whole file) →
  Kosandra / Miyagi & Andy Panda; 20.8 MB FLAC (preview) → «Санавабич» /
  Miyagi & Эндшпиль. Raw-file fallback stays for formats `symphonia` cannot
  decode.
- [x] AudD limit/key error mapping to actionable Russian messages; the supplied
  key is valid but the account quota is exhausted (`the limit was reached`).
- [x] API key entered in Settings and persisted across an app restart.
- [x] Projection watchdog/revocation handling.

## 2D — Polish and release

- [x] Share and open-with actions in the track sheet via `FileProvider`.
- [x] `ACTION_VIEW` audio/video intent filter and import to `NovaInbox`.
- [x] MIUI battery optimization/autostart controls in Settings.
- [x] Release signing config (`keystore.properties`, local keystore ignored).
- [x] Build/verify a signed release APK (`Nova-0.1.0-arm64-release.apk`,
  67 298 283 bytes, SHA-256 `B4A8922D…F34564F`, arm64-v8a, clean install).
- [x] 392 px/44 px/safe-area audit across all screens (26 checks; Shazam
  source-switch CSS included in the final APK).
- [x] Final device acceptance and docs: 78 tracks, playback/background/lockscreen,
  notification actions, API key persists across restart, `/sdcard/Music` 104
  files, Windows smoke.
