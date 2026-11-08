# Nova Android Phase 2B-1 — Embedded yt-dlp Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> (recommended) or executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Встроить yt-dlp/ffmpeg в Android-APK и заставить существующие
экраны «Загрузки»/«Импорт» скачивать YouTube и прямые ссылки на телефоне, с
прогрессом, отменой и проверкой дублей.

**Architecture:** Новый Kotlin-плагин `NovaDownloadPlugin` на
`youtubedl-android`; Rust-команды `resolve_playlist`/`download_media` на
Android маршрутизируют YouTube-ветки в плагин, прямые источники остаются в
Rust. JS-контракт и событие `download-progress` не меняются. Постоянная
очередь в SQLite и `NovaTaskService` (фон/перезапуск) — отдельный план 2B-2.

**Tech Stack:** Tauri 2, Kotlin, youtubedl-android 0.18.1 + ffmpeg, Rust
(reqwest/direct downloads), React/Zustand, ADB/Playwright.

**Spec:** `docs/specs/2026-11-07-nova-android-design.md` (4.3, 6.3, 7, 9, 11.5)
**Roadmap:** `docs/plans/2026-11-08-android-phase2-roadmap.md`

## Global Constraints

- Android 10+ (minSdk 29), targetSdk 36; телефон `7ac47954` (POCO F4 GT,
  Android 13, arm64), эмулятор `emulator-5554` для быстрых проверок.
- `MANAGE_EXTERNAL_STORAGE` выдан; `ytdlpPath` на Android скрыт, используется
  встроенный yt-dlp.
- Прямые загрузки Zaycev/Muzofond/DriveMusic остаются в Rust и не должны
  регрессировать.
- `/sdcard/Music` не изменяется; тестовые загрузки — в
  `/sdcard/Download/NovaDownloads`; после теста удалить.
- Windows-сборка: `npm.cmd run build:web`,
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
- 392 CSS px, без горизонтального overflow; кнопки загрузки/импорта ≥ 44 px.
- APK только arm64 для телефона; рост APK ожидаем (Python/ffmpeg), размер
  фиксируется в отчёте.
- Встроенный yt-dlp требует `jniLibs.useLegacyPackaging = true` в
  `src-tauri/gen/android/app/build.gradle.kts`; не удалять — иначе
  `nativeLibraryDir` пуст и `YoutubeDL.init` падает.

## Review Focus

- YouTube-сеть может быть недоступна в текущей сети: spike обязан явно
  записать результат и выбрать тестовый URL; при блокировке YouTube
  pipeline проверяется прямой ссылкой, а ограничение документируется.
- `download-progress` из Kotlin должен иметь те же поля, что ожидает
  `useDownloadStore.upsert` (`id, percent, line, status, path, error`), и не
  дублировать/терять события при отмене.
- `resolve_playlist`/`download_media`: прямые URL не должны уходить в yt-dlp;
  YouTube-URL не должен пытаться запустить sidecar `.exe` на Android.
- Отмена должна удалять недокачанный файл и не оставлять запись «done».
- Имя/папка файла: кириллица, пробелы, `outputDir` из настроек; сканер должен
  находить результат.
- Ошибки сети/возрастных ограничений/формата показываются пользователю, а не
  молча теряются.

---

### Task 1: youtubedl-android spike

**Files:**
- Modify: `src-tauri/plugins/nova-mobile/android/build.gradle.kts`
- Modify: `src-tauri/gen/android/build.gradle.kts` (repository if needed)
- Create: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/download/NovaDownloadPlugin.kt`
- Modify: `src-tauri/plugins/nova-mobile/src/lib.rs` (second handle)
- Modify: `src-tauri/plugins/nova-mobile/build.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- `NovaDownloadPlugin` commands: `downloadProbe` → `JSObject` с `version`
  и (если сеть доступна) `title`, `formats`.
- Rust: `android_download_probe(app: AppHandle, url: String) -> Result<serde_json::Value, String>`.
- Two Tauri plugins: `nova-mobile`/`NovaMobilePlugin` and
  `nova-download`/`NovaDownloadPlugin`; `NovaDownloads` handle;
  `run_download_command` uses it. A second class under the same Tauri plugin
  name overwrites the core instance, so a separate `init_downloads()` plugin is
  required.

- [ ] **Step 1: Add the dependency and check resolution**

Add to the plugin module:
```kotlin
implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
```
Run from `src-tauri/gen/android`:
`.\gradlew.bat :tauri-plugin-nova-mobile:dependencies --configuration debugRuntimeClasspath`.
Expected: artifacts resolve; if not, add the repository the artifact requires
(e.g. JitPack) and record the exact working coordinates.

- [ ] **Step 2: Implement the probe**

`NovaDownloadPlugin`:
```kotlin
@TauriPlugin
class NovaDownloadPlugin(private val activity: Activity) : Plugin(activity) {
    private lateinit var youtubeDL: YoutubeDL
    override fun onLoad() {
        youtubeDL = YoutubeDL.getInstance()
        youtubeDL.init(activity.applicationContext)
        FFmpeg.getInstance().init(activity.applicationContext)
    }
    @Command fun downloadProbe(invoke: Invoke) { /* info or init only */ }
}
```
Probe with `--dump-single-json --skip-download --no-playlist` on a known
YouTube URL; return `version`, `title`, and `formats` count. If `YoutubeDL.init`
is the only reliable call in the current network, return `version`/`ok` and
record the network limit.

- [ ] **Step 3: Register the second plugin**

Add `init_downloads()` as a second `TauriPlugin` named `nova-download`
(`NovaDownloads` handle) in `tauri-plugin-nova-mobile/src/lib.rs`; keep
`init()`/`NovaMobile` for `nova-mobile`. Update `run_download_command` to use
`NovaDownloads`; do not change the core `run_mobile_command`. Add
`downloadProbe` to `build.rs`'s `COMMANDS` (the generated `nova-mobile`
permission is unused because JS calls the Rust wrapper, not the Kotlin plugin
directly — leave a comment) and register `android_download_probe` in
`src-tauri/src/lib.rs`.

- [ ] **Step 4: Device probe**

Build arm64, install, invoke `android_download_probe` with a short YouTube URL;
record the output and APK size. Expected: a JSON with title/formats or an
explicit network error; no crash.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/plugins/nova-mobile src-tauri/src src-tauri/gen/android/build.gradle.kts
git commit -m "feat(android): spike embedded youtubedl"
```

---

### Task 2: Download plugin and Rust/JS bridge

**Files:**
- Modify: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/download/NovaDownloadPlugin.kt`
- Modify: `src-tauri/plugins/nova-mobile/src/lib.rs`,
  `src-tauri/src/commands.rs`, `src-tauri/src/media.rs`,
  `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`, `src/hooks/useDownloadProgress.ts`,
  `src/screens/Downloads.tsx`, `src/screens/Import.tsx` (only if needed)
- Test: `.superpowers/sdd/2026-11-08-android-downloads/verify-download.py`

**Interfaces:**
- Kotlin commands:
  - `downloadInfo` args `{ url }` → `{ title, source, tracks:[{ title, artist,
    album, durationMs, downloadUrl, query }] }`.
  - `downloadStart` args `{ id, url, outputDir, query }` → `{ path, title,
    directory }`; progress via `trigger("download-progress", payload)`.
  - `downloadCancel` args `{ id }` → `{ cancelled: Boolean }`.
- Rust:
  - `android_download_info(app, url) -> Result<ImportPlaylist, String>` (async)
  - `android_download_start(app, id, url, output_dir, query) -> Result<DownloadResult, String>` (async)
  - `android_download_cancel(app, id) -> Result<bool, String>`
  - `run_download_command_async` uses `PluginHandle::run_mobile_plugin_async`; the
    Kotlin command dispatches to its worker and resolves later.
- `media::resolve_playlist` and `media::download_media` branch on
  `cfg(target_os = "android")` + YouTube/needs-yt-dlp URLs; direct URLs keep
  the current Rust path.

- [ ] **Step 1: Implement `downloadInfo`**

Use `YoutubeDLRequest` with `--dump-single-json --flat-playlist`; map entries
to `ImportPlaylist`/`ImportTrack`. For a single video return one track; for a
playlist return all entries. Preserve Unicode titles. Fix the probe's minor
gaps before building on it: reject an empty URL instead of probing a default;
always emit `networkLimited` (true/false) and map yt-dlp errors explicitly;
catch `Exception` (not `Throwable`); cache the `--version` result; keep
`downloadProbe` as a diagnostic. Use a timeout/cancel path so a blocked network
does not hold the worker for 165 s.

- [ ] **Step 2: Implement `downloadStart`/cancel and progress**

`downloadStart` runs `YoutubeDL.execute` on a background executor with
`-x --audio-format mp3` (or the format the existing UI expects), output
template `%(title)s.%(ext)s`, `-o <outputDir>`; it returns immediately and
resolves the Tauri command when the worker finishes. Emit `download-progress`
with `id`, `percent` (parse `[download] xx%`), `line`, `status`
(`starting/downloading/done/error`), `path`, `error`; always include
`networkLimited` for errors. Cancel by process id; delete a partial file;
resolve with the final path. Keep the executor alive for the plugin lifetime
and recreate it if it was shut down.

- [ ] **Step 3: Rust routing**

Add `is_ytdlp_url(url)` (YouTube/youtu.be/music.youtube.com and any URL the
existing code routes to `run_ytdlp`). In `resolve_playlist`, on Android use
`android_download_info` for those URLs; otherwise keep the Rust parsers. In
`download_media`, on Android use the plugin for yt-dlp URLs; direct URLs use
`download_direct`. Ensure `ytdlp_path` is ignored on Android.

- [ ] **Step 4: Device download test**

Resolve and download a short YouTube track (or the spike's working URL) to
`/sdcard/Download/NovaDownloads`; assert progress events, final file exists,
`DownloadResult.path` is real, cancel leaves no file. Test a direct Rust URL
too. Expected: PASS; no sidecar error.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/lib src/hooks src/screens
git commit -m "feat(android): add embedded yt-dlp downloads"
```

---

### Task 3: Downloads/Import UI on Android

**Files:**
- Modify: `src/screens/Downloads.tsx`, `src/screens/Import.tsx`,
  `src/screens/Settings.tsx`, `src/styles/app.css`
- Test: `.superpowers/sdd/2026-11-08-android-downloads/verify-download-ui.py`

**Interfaces:** uses Task 1 pickers (`pickFolder`), Task 2 commands/events;
no new commands.

- [ ] **Step 1: Hide desktop-only settings on Android**

`Settings.tsx`: hide the `ytdlpPath` row when `isAndroid`; show a static note
«Встроенный yt-dlp»; keep the download folder picker (2A) and default app-data
directory. Do not remove desktop fields.

- [ ] **Step 2: Mobile layout**

Verify Downloads/Import at 392 px: search field, link input, tabs, progress
rows, cancel/retry, history; buttons ≥ 44 px, no horizontal overflow; IME does
not cover the link field/submit. Fix only real issues.

- [ ] **Step 3: Duplicate/error flows**

Ensure `findDuplicateTrack`/`DuplicateDownloadModal` works on Android; clear
network/format errors via `errorText`; cancelling a queued/downloading item
does not mark it done.

- [ ] **Step 4: Device UI test**

Open `/downloads`, search a query (direct source), download; open `/import`,
paste a YouTube URL, resolve, select one track, download; check progress,
cancel, history, downloaded file visible in the library after scan.

- [ ] **Step 5: Commit**

```bash
git add src/screens src/styles/app.css
git commit -m "fix(android): polish downloads and import screens"
```

---

### Task 4: Phase 2B-1 acceptance and docs

**Files:**
- Modify: `docs/ANDROID.md`, `README.md`
- Modify: `docs/plans/2026-11-08-android-phase2-roadmap.md` (mark 2B-1 done)

- [ ] **Step 1: Windows regression**

```powershell
npm.cmd run build:web
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
Expected: EXIT 0; 13 Rust tests PASS.

- [ ] **Step 2: Phone acceptance**

- Direct source search/download (Zaycev/Muzofond/DriveMusic).
- YouTube single + playlist resolve/download (or documented network limit).
- Progress/cancel/retry/history; file appears in `/sdcard/Download/NovaDownloads`;
  scanner adds it to the library; `/sdcard/Music` unchanged.
- 392 px/44 px screenshots; DB integrity; cleanup test downloads.

- [ ] **Step 3: Docs**

Update `docs/ANDROID.md` with 2B-1 scope, `youtubedl-android` version, APK size,
test results, YouTube network limitation, and the explicit 2B-2 follow-up:
SQLite queue/history + `NovaTaskService` dataSync + restart resume.

- [ ] **Step 4: Commit**

```bash
git add docs/ANDROID.md README.md docs/plans/2026-11-08-android-phase2-roadmap.md
git commit -m "docs: record android downloads acceptance"
```
