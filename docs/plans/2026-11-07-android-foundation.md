# Nova Android Foundation & Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Получить устанавливаемый на Xiaomi APK, который открывает Nova, получает доступ к `/sdcard/Music`, сканирует библиотеку и играет музыку через нативный ExoPlayer с фоном, экраном блокировки и 10-полосным EQ.

**Architecture:** Tauri Android сохраняет React UI, Zustand и Rust-ядро. Kotlin-плагин `nova-mobile` даёт доступ к «Все файлы», нативному аудио Media3, foreground service и EQ. Очередь и repeat/shuffle остаются в JS, Kotlin получает готовый порядок и держит зеркало для next/prev на локскрине.

**Tech Stack:** Tauri 2.12, React 19, TypeScript, Rust, Kotlin, Media3 ExoPlayer, Android SDK/NDK, ADB.

**Spec:** `docs/specs/2026-11-07-nova-android-design.md`

## Global Constraints

- Android 10+ (API 29+); проверка на `21121210G`, Android 13, arm64-v8a.
- Package `app.nova.player`, label `Nova`.
- Sideload-сборка; `MANAGE_EXTERNAL_STORAGE` + `requestLegacyExternalStorage`.
- Устройство: `7ac47954`; при обрыве USB — `adb tcpip 5555`, затем `adb connect 192.168.0.145:5555`.
- Windows-сборка не должна ломаться; desktop-пути остаются под `#[cfg(desktop)]`.
- Разрушительные тесты только на копии `/sdcard/Download/NovaTest`; `/sdcard/Music` не изменять.
- После каждой задачи — отдельный commit.
- Не коммитить keystore, пароли, `local.properties`, `build/`, `.gradle/`.
- `src-tauri/gen/android` должен быть в Git; `src-tauri/gen/schemas` — нет.

## Review Focus

- **Отказ в «Все файлы»:** приложение не падает и не показывает пустую библиотеку без объяснения; есть экран разрешения и повторная проверка.
- **Кириллица и пробелы в путях:** `/sdcard/Music/Asper X - Галопериод (СЛИВ Telegram).mp3` сканируется, отображается и играет.
- **Фон и audio focus:** сворачивание, экран блокировки, входящий звонок/другое аудио не оставляют «мёртвый» плеер; пауза и возобновление корректны.
- **Рассинхронизация очереди:** shuffle/repeat/next/prev/удаление трека не приводят к чужому треку, зависанию или повторному старту.
- **Android back и жесты:** модалка, очередь и полноэкранный плеер закрываются первыми; приложение не «застревает».

---

### Task 1: Android toolchain и Tauri scaffold

**Files:**
- Modify: `.gitignore`
- Create: `scripts/android-env.ps1`
- Create: `src-tauri/tauri.android.conf.json`
- Generated: `src-tauri/gen/android/**`
- Modify: `src-tauri/tauri.conf.json` only if Android config requires it

**Interfaces:**
- Produces: working `src-tauri/gen/android` Gradle project and a debug APK path printed by the build.
- Produces: `scripts/android-env.ps1` exports `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`, `PATH`.

- [ ] **Step 1: Проверить JDK и Android SDK**

Run:
```powershell
& 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe' -version
adb version
Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk" -Directory
```
Expected: Java 17+ (JBR 25 допустим), adb 1.0.41+, SDK содержит `platform-tools`, `platforms`, `build-tools`.

Если Gradle позже падает на Java 25 — установить JDK 21 (`winget install EclipseAdoptium.Temurin.21.JDK`) и указать его в `JAVA_HOME`.

- [ ] **Step 2: Установить cmdline-tools и NDK**

Скачать актуальный `commandlinetools-win-*_latest.zip` с `https://developer.android.com/studio#command-tools`, распаковать в `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`, затем:
```powershell
$sdk="$env:LOCALAPPDATA\Android\Sdk"
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.2.12479018"
```
Expected: `sdkmanager` завершается с exit 0; в `Sdk\ndk\27.2.12479018` есть `ndk-build.cmd`.

Если `tauri android init` потребует другую NDK — установить указанную версию и обновить `NDK_HOME`.

- [ ] **Step 3: Добавить Rust targets**

Run:
```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```
Expected: `rustup target list --installed` содержит `aarch64-linux-android`.

- [ ] **Step 4: Настроить окружение и Git**

Создать `scripts/android-env.ps1`:
```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.2.12479018"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
```
В `.gitignore` заменить `src-tauri/gen/` на:
```gitignore
src-tauri/gen/schemas/
src-tauri/gen/android/.gradle/
src-tauri/gen/android/**/build/
src-tauri/gen/android/local.properties
```
Expected: `git check-ignore src-tauri/gen/schemas` подтверждает игнор, `src-tauri/gen/android` — нет.

- [ ] **Step 5: Инициализировать Android target**

Run:
```powershell
. .\scripts\android-env.ps1
npx.cmd tauri android init --ci
```
Expected: создан `src-tauri/gen/android` с `settings.gradle.kts`, `app/build.gradle.kts`, `app/src/main/AndroidManifest.xml`, `MainActivity.kt`.

Создать `src-tauri/tauri.android.conf.json`, чтобы Android не пытался бандлить Windows-sidecar:
```json
{
  "bundle": {
    "externalBin": []
  }
}
```
Проверить `app/build.gradle.kts`: `applicationId = "app.nova.player"`, `minSdk = 29`, `targetSdk = 35`, `versionName = "0.1.0"`. Если Tauri перезапишет — исправить после `android init`.

- [ ] **Step 6: Собрать debug APK**

Run:
```powershell
. .\scripts\android-env.ps1
npx.cmd tauri android build --debug --apk --target aarch64
Get-ChildItem src-tauri\gen\android\app\build\outputs\apk -Recurse -Filter *.apk
```
Expected: exit 0 и найден `*debug*.apk`.

- [ ] **Step 7: Установить и запустить на телефоне**

Run:
```powershell
adb devices -l
adb -s 7ac47954 install -r (Get-ChildItem src-tauri\gen\android\app\build\outputs\apk -Recurse -Filter *.apk | Select-Object -First 1).FullName
adb -s 7ac47954 shell am start -n app.nova.player/.MainActivity
Start-Sleep -Seconds 5
adb -s 7ac47954 exec-out screencap -p > $env:TEMP\nova-android-first.png
adb -s 7ac47954 logcat -d -t 200 | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime|app.nova.player'
```
Expected: процесс `app.nova.player` запущен, на скриншоте виден интерфейс Nova, в logcat нет `FATAL EXCEPTION`.

Если `adb devices` пуст: подключить USB, выполнить `adb tcpip 5555`, затем `adb connect 192.168.0.145:5555`.

- [ ] **Step 8: Commit**

```powershell
git add .gitignore scripts/android-env.ps1 src-tauri/tauri.android.conf.json src-tauri/gen/android
git commit -m "feat(android): scaffold tauri android build"
```

---

### Task 2: «Все файлы», default Music folder и permission gate

**Files:**
- Create: `src-tauri/plugins/nova-mobile/**` (Tauri plugin)
- Modify: `src-tauri/Cargo.toml` — path dependency
- Modify: `src-tauri/src/lib.rs` — register plugin and expose commands
- Modify: `src-tauri/src/commands.rs` — Android wrappers
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `src/lib/tauri.ts`
- Create: `src/lib/platform.ts`
- Create: `src/components/AndroidGate.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: Task 1 APK/build.
- Produces: `android_permission_state() -> String` with `"granted" | "denied" | "unknown"`.
- Produces: `android_open_all_files_settings() -> Result<(), String>`.
- Produces: `android_request_notifications() -> Result<(), String>`.
- Produces: `api.androidPermissionState()`, `api.androidOpenAllFilesSettings()`, `api.androidRequestNotifications()`.
- Produces: `AndroidGate` that blocks library until access is granted and calls `addFolder("/storage/emulated/0/Music")` once.

- [ ] **Step 1: Scaffold mobile plugin**

Run:
```powershell
npx.cmd tauri plugin new nova-mobile --android --no-example --no-api --directory src-tauri/plugins
```
Expected: `src-tauri/plugins/nova-mobile` с `Cargo.toml`, `build.rs`, `src/lib.rs`, `android/` и permission metadata.

Add to `src-tauri/Cargo.toml`:
```toml
tauri-plugin-nova-mobile = { path = "plugins/nova-mobile" }
```
Register in `src-tauri/src/lib.rs`:
```rust
#[cfg(target_os = "android")]
let builder = builder.plugin(tauri_plugin_nova_mobile::init());
```

- [ ] **Step 2: Add Android permissions**

В `src-tauri/gen/android/app/src/main/AndroidManifest.xml` добавить:
```xml
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.INTERNET" />
```
В `<application>` добавить `android:requestLegacyExternalStorage="true"` (для API 29).

- [ ] **Step 3: Implement Kotlin permission commands**

В плагине создать `android/src/main/java/app/nova/mobile/NovaMobilePlugin.kt`:
```kotlin
@TauriPlugin
class NovaMobilePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun hasAllFilesAccess(invoke: Invoke) {
    val granted = Build.VERSION.SDK_INT >= 30 &&
      Environment.isExternalStorageManager()
    invoke.resolve(JSObject().put("granted", granted))
  }

  @Command
  fun openAllFilesSettings(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= 30) {
      val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
      intent.data = Uri.parse("package:${activity.packageName}")
      activity.startActivity(intent)
    }
    invoke.resolve()
  }

  @Command
  fun requestNotifications(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= 33) {
      activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 701)
    }
    invoke.resolve()
  }
}
```
Проверить, что package/plugin name совпадает с `Cargo.toml` и `lib.rs`.

- [ ] **Step 4: Add Rust and JS wrappers**

В `commands.rs`:
```rust
#[tauri::command]
pub fn android_permission_state(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = app.plugin(tauri_plugin_nova_mobile::PLUGIN_NAME)
            .map_err(|e| e.to_string())?;
        let value: serde_json::Value = plugin
            .run_mobile_plugin("hasAllFilesAccess", ())
            .map_err(|e| e.to_string())?;
        return Ok(if value.get("granted").and_then(|v| v.as_bool()).unwrap_or(false) {
            "granted".to_string()
        } else {
            "denied".to_string()
        });
    }
    #[cfg(not(target_os = "android"))]
    Ok("granted".to_string())
}
```
Аналогично `android_open_all_files_settings` и `android_request_notifications`.

Зарегистрировать команды в `generate_handler!`.

В `src/lib/tauri.ts`:
```ts
androidPermissionState: () => invoke<string>("android_permission_state"),
androidOpenAllFilesSettings: () => invoke<void>("android_open_all_files_settings"),
androidRequestNotifications: () => invoke<void>("android_request_notifications"),
```

- [ ] **Step 5: Add AndroidGate and default folder**

Создать `src/lib/platform.ts`:
```ts
export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
export const isMobile = isAndroid;
```
`AndroidGate`:
- при `isAndroid` и `permission !== "granted"` показывает экран с кнопкой «Разрешить доступ ко всем файлам» и кнопкой «Настройки»;
- при возврате в приложение повторно вызывает `androidPermissionState`;
- после `granted` вызывает `api.addFolder("/storage/emulated/0/Music")`, если папка существует (проверка через `api.addFolder` может вернуть ошибку — показать её);
- блокирует только маршруты, которым нужна библиотека (`/`, `/library`, `/albums`, `/folders`, `/playlists`, `/favorites`); `Settings`, `Shazam`, `Downloads`, `Import` остаются доступны.

В `App.tsx` на Android обернуть библиотечные routes в `AndroidGate`; глобальный layout не блокировать.

- [ ] **Step 6: Verify permission and scan on device**

Run:
```powershell
adb -s 7ac47954 shell appops get app.nova.player MANAGE_EXTERNAL_STORAGE
adb -s 7ac47954 shell pm grant app.nova.player android.permission.POST_NOTIFICATIONS
```
На телефоне включить «Все файлы», вернуться в Nova, дождаться сканирования.
Expected: в боковой панели и библиотеке количество треков совпадает с `/sdcard/Music` (проверить `adb shell find /sdcard/Music -type f | wc -l`); кириллические названия видны; скриншот библиотеки сохранён.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/plugins src-tauri/Cargo.toml src-tauri/src src-tauri/gen/android/app/src/main/AndroidManifest.xml src/lib src/components/AndroidGate.tsx src/App.tsx src/styles/app.css
git commit -m "feat(android): add all-files access and default music folder"
```

---

### Task 3: Mobile shell and touch layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/PlayerBar.tsx`
- Modify: `src/components/QueuePanel.tsx`
- Modify: `src/components/NowPlaying.tsx`
- Create: `src/components/MobileNav.tsx`
- Modify: `src/styles/app.css`
- Modify: `index.html` if viewport/safe-area meta missing

**Interfaces:**
- Consumes: `isAndroid`/`isMobile` from Task 2.
- Produces: mobile nav with routes `/`, `/library`, `/albums`, `/downloads`, `/settings`; drawer keeps all routes.
- Produces: player bar tap opens `NowPlaying`; back closes overlays.

- [ ] **Step 1: Add bottom navigation**

`MobileNav.tsx`:
- 5 кнопок с `NavLink` и `lucide-react` иконками (Home, Library, Disc3, Download, Settings).
- Активная вкладка — accent color.
- Высота 64px + safe-area inset.
- На desktop `display: none`.

- [ ] **Step 2: Adjust CSS for phone**

В `app.css` для `max-width: 620px`:
- `--player-height: 64px`, `--mobile-nav-height: 64px`;
- `.main-scroll` padding-bottom учитывает player + nav;
- `.page-head` stacked, `h1` 28–32px;
- `.track-table` скрывает лишние колонки (album/format/size), оставляет cover/title/artist/time;
- `.album-grid` 2 колонки, gap 12px;
- `.player-bar` компактный, cover 44px;
- все кнопки минимум 44×44px;
- `padding-top: env(safe-area-inset-top)`, `padding-bottom: env(safe-area-inset-bottom)`.

- [ ] **Step 3: Queue and NowPlaying mobile overlays**

- `.queue-panel` на телефоне — full-screen overlay с кнопкой закрытия.
- `.now-playing` — full-screen, свайп вниз/кнопка закрывает.
- Убедиться, что `QueuePanel` не перекрывает player bar.

- [ ] **Step 4: Android back handling**

Добавить обработку `popstate`/Tauri back event там, где доступно; если нативного события нет — кнопка «Назад» в overlays. Проверить, что back из `NowPlaying`/`QueuePanel` закрывает overlay, а не приложение.

- [ ] **Step 5: Build and screenshot**

Run:
```powershell
. .\scripts\android-env.ps1
npx.cmd tauri android build --debug --apk --target aarch64
adb -s 7ac47954 install -r (Get-ChildItem src-tauri\gen\android\app\build\outputs\apk -Recurse -Filter *.apk | Select-Object -First 1).FullName
adb -s 7ac47954 shell am force-stop app.nova.player
adb -s 7ac47954 shell am start -n app.nova.player/.MainActivity
```
Сделать скриншоты Home, Library, Settings, NowPlaying, Queue. Expected: ничего не обрезано, нижняя навигация не перекрывает контент, кириллица читается.

- [ ] **Step 6: Commit**

```powershell
git add src/App.tsx src/components src/styles/app.css index.html
git commit -m "feat(android): add mobile shell and touch navigation"
```

---

### Task 4: Native audio core (ExoPlayer + queue mirror)

**Files:**
- Create: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/mobile/audio/NovaAudioPlugin.kt`
- Create: `.../NovaAudioService.kt`
- Create: `.../AudioItem.kt`
- Modify: `src-tauri/plugins/nova-mobile/android/build.gradle.kts`
- Modify: `src-tauri/plugins/nova-mobile/src/lib.rs`
- Modify: `src-tauri/src/lib.rs` (register)
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/audio.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/player.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `AudioItem { id: number, uri: string, title: string, artist: string, album: string, artworkPath: string | null, durationMs: number }`.
- Produces commands: `android_audio_set_queue(items, startIndex, positionMs, autoplay)`, `android_audio_play()`, `android_audio_pause()`, `android_audio_seek(ms)`, `android_audio_set_volume(value)`, `android_audio_set_muted(muted)`, `android_audio_set_eq(enabled, bands, preamp)`.
- Produces event `audio-state` payload `{ currentIndex, positionMs, durationMs, isPlaying, ended }`.
- Consumes: queue from `usePlayerStore`, current track file path.

- [ ] **Step 1: Add Media3 dependencies**

В `src-tauri/plugins/nova-mobile/android/build.gradle.kts`:
```kotlin
implementation("androidx.media3:media3-exoplayer:1.6.1")
implementation("androidx.media3:media3-session:1.6.1")
implementation("androidx.media3:media3-ui:1.6.1")
```
Версия должна быть совместима с compileSdk; зафиксировать одну.

- [ ] **Step 2: Implement Kotlin plugin and service**

- `AudioItem` — data class с `serde`-совместимыми именами.
- `NovaAudioService` — `MediaSessionService`, создаёт `ExoPlayer`, `MediaSession`, `MediaStyle` notification.
- `NovaAudioPlugin`:
  - `setQueue` конвертирует `AudioItem` в `MediaItem` с `Uri.fromFile(File(path))`, `MediaMetadata` (title/artist/album/artwork), `setQueue` в JS-порядке, `seekTo`.
  - `play`/`pause`/`seek`/`setVolume`/`setMuted`.
  - `setEq` передаёт параметры в `EqualizerAudioProcessor`.
  - Слушает `Player.Listener` (isPlaying, position, ended) и `trigger("audio-state", ...)`.
- `MediaSession`/notification: play/pause/next/prev/seek; next/prev идут по очереди ExoPlayer, не через JS.
- Audio focus: `setAudioAttributes(..., true)`; `handleAudioFocus` через `Player.Listener`/`AudioFocusManager`.

- [ ] **Step 3: Add Rust wrappers**

В `commands.rs`:
```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioItem { ... }

#[tauri::command]
pub fn android_audio_set_queue(
    app: AppHandle,
    items: Vec<AudioItem>,
    start_index: usize,
    position_ms: u64,
    autoplay: bool,
) -> Result<(), String> { /* run_mobile_plugin("setQueue", ...) */ }
```
Зарегистрировать команды.

- [ ] **Step 4: Add JS audio adapter**

`src/lib/audio.ts`:
- desktop: current `HTMLAudioElement` path unchanged;
- Android: `audioEngine.load` calls `androidAudioSetQueue` with current queue/order; `play/pause/seek/setVolume/setMuted/setEq` call commands;
- `audioEngine.onTime/onPlayState/onEnded` fed from `listen("audio-state")`;
- `audioUrl` on Android returns the raw file path, not `convertFileSrc`.

`player.ts`:
- `audioEngine.load` receives the full queue snapshot; update `playTrackById`/`setContext` to pass `queue/order` to native.
- `handleEnded` must not double-advance if Kotlin already moved to next track; use `ended` event + current index.
- On `removeTracks`, send updated queue to Kotlin.

- [ ] **Step 5: Test playback on device**

Run:
```powershell
adb -s 7ac47954 logcat -c
# launch and play first track through UI or adb shell input
adb -s 7ac47954 shell dumpsys media_session | Select-String -Pattern 'state=|description='
adb -s 7ac47954 shell dumpsys audio | Select-String -Pattern 'player|focus|ExoPlayer'
```
Expected: звук слышен, `state=PlaybackState {state=3...}`, pause/play/seek/next/prev работают, в logcat нет crash.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/plugins src-tauri/src src/lib/audio.ts src/lib/tauri.ts src/store/player.ts src/types.ts src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): add native ExoPlayer playback"
```

---

### Task 5: Background playback, lock screen and 10-band EQ

**Files:**
- Modify: `src-tauri/plugins/nova-mobile/android/.../NovaAudioService.kt`
- Create: `.../EqualizerAudioProcessor.kt`
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml` (service)
- Modify: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/mobile/NovaMobilePlugin.kt`
- Modify: `src/lib/audio.ts`
- Modify: `src/components/EqualizerPanel.tsx` only if command names differ

**Interfaces:**
- Consumes: Task 4 queue commands and events.
- Produces: foreground `MediaSessionService` with notification channel `nova_playback`.
- Produces: media buttons play/pause/next/prev/seek without JS.
- Produces: 10 peaking filters at 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k + preamp.

- [ ] **Step 1: Add foreground service**

В manifest:
```xml
<service
  android:name=".audio.NovaAudioService"
  android:foregroundServiceType="mediaPlayback"
  android:exported="true">
  <intent-filter>
    <action android:name="androidx.media3.session.MediaSessionService" />
  </intent-filter>
</service>
```
Создать notification channel `nova_playback`; `startForeground` с `MediaStyle`; обложка, title/artist, play/pause, next/prev, seek.

- [ ] **Step 2: Audio focus and interruptions**

- `AudioAttributes.USAGE_MEDIA`, `CONTENT_TYPE_MUSIC`, `handleAudioFocus = true`.
- На `AUDIOFOCUS_LOSS` — пауза; `LOSS_TRANSIENT` — пауза с флагом; `GAIN` — возобновление только если пауза была автоматической.
- На звонок/другое аудио проверить, что состояние не «залипает».

- [ ] **Step 3: Implement 10-band EQ**

`EqualizerAudioProcessor`:
- 10 biquad peaking filters, sample rate 44.1/48 kHz, Q ≈ 1.1;
- preamp gain;
- включается/выключается без пересоздания ExoPlayer;
- команда `setEq` принимает `enabled`, `bands: number[10]`, `preamp`.
- В JS `useEqStore` уже хранит presets; отправлять их в native при изменении.

- [ ] **Step 4: Test on device**

- Запустить трек, свернуть приложение, заблокировать экран.
- Проверить уведомление и кнопки play/pause/next/prev/seek.
- Позвонить/включить другое аудио, проверить паузу и возврат.
- Включить/выключить EQ, проверить звук и отсутствие щелчков.
- `adb shell dumpsys media_session`, `dumpsys audio`, `logcat`.

Expected: playback продолжается, управление работает, EQ слышен, нет ANR/crash.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/plugins src-tauri/gen/android/app/src/main/AndroidManifest.xml src/lib/audio.ts src/components/EqualizerPanel.tsx
git commit -m "feat(android): add background media session and equalizer"
```

---

### Task 6: Phase 1 acceptance and documentation

**Files:**
- Create: `docs/ANDROID.md`
- Modify: `README.md` (Android section)
- Modify: `scripts/android-env.ps1` if paths changed
- Modify: `src-tauri/tauri.android.conf.json` if needed

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reproducible build/install instructions and a phase-1 acceptance record.

- [ ] **Step 1: Clean install**

```powershell
adb -s 7ac47954 uninstall app.nova.player
# install fresh APK
adb -s 7ac47954 install (Get-ChildItem src-tauri\gen\android\app\build\outputs\apk -Recurse -Filter *.apk | Select-Object -First 1).FullName
```
Пройти онбординг, выдать «Все файлы», дождаться скана.

- [ ] **Step 2: Acceptance checklist**

Проверить и записать в `docs/ANDROID.md`:
- запуск без крашей;
- скан `/sdcard/Music`, количество совпадает;
- кириллические имена;
- play/pause/seek/next/prev;
- очередь и shuffle/repeat;
- фон и локскрин;
- 10-полосный EQ;
- 5 тем, обложки, фоны;
- back/жесты;
- отсутствие регрессии Windows: `npm.cmd run build:web`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

- [ ] **Step 3: Document**

`docs/ANDROID.md`: prerequisites, env vars, `android init`, build, install, wireless ADB, permissions, known limitations (WMA/AIFF, MediaProjection, sideload), test device.

- [ ] **Step 4: Commit**

```powershell
git add docs/ANDROID.md README.md
git commit -m "docs(android): document build install and phase 1 acceptance"
```

---

## Next Plan

После phase 1 отдельным планом идут: плейлисты/избранное/поиск/альбомы/папки, редактирование и удаление, дубликаты и кодировка, загрузки и импорт, распознавание, тексты, intents и финальный релиз APK. Дизайн уже покрывает их; план phase 2 будет написан после работающего плеера, чтобы не планировать вслепую нативные детали.
