# Nova Android Phase 2A — Library & Touch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> (recommended) or executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести все библиотечные функции десктопа на Android: плейлисты,
избранное, поиск, папки, редактирование, удаление, дубликаты, кодировку,
обложки, фоны, объединение альбомов и touch-выделение.

**Architecture:** Переиспользуем общие React-экраны, Zustand и Rust-команды.
Добавляем Android-мост для файловых пикеров (`content://` → реальный путь),
long-press/выделение и проверяем destructive-операции только на копии
`/sdcard/Download/NovaTest`.

**Tech Stack:** Tauri 2, React + TypeScript, Zustand, Kotlin (Tauri plugin),
Rust, SQLite, ADB, Python Playwright.

**Spec:** `docs/specs/2026-11-07-nova-android-design.md` (разделы 4.1, 4.5,
6.3, 7, 9, 11.4)

## Global Constraints

- Android 10+ (minSdk 29), targetSdk 36; телефон `7ac47954` (POCO F4 GT,
  Android 13, arm64), эмулятор `emulator-5554` для быстрых проверок.
- `MANAGE_EXTERNAL_STORAGE` уже выдан; основная библиотека —
  `/storage/emulated/0/Music`.
- Деструктивные тесты только в `/sdcard/Download/NovaTest`; оригинальная
  `/sdcard/Music` не изменяется.
- Windows-сборка (`npm.cmd run build:web`,
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`) остаётся зелёной.
- Touch-targets ≥ 44 px; на 392 CSS px нет горизонтального скролла.
- На Android в Rust передаются реальные пути (`/storage/...`), не `content://`;
  выбранный контент копируется в `filesDir/nova-imports`.
- Sideload-вариант; Play Store и SAF-режим не входят в этот этап.

## Review Focus

- `content://` из SAF/галереи не попадает в Rust как путь: выбрать картинку и
  аудио, убедиться, что `set_track_cover`/`recognize` получает существующий
  файл.
- SAF tree URI для внутренней памяти и SD-карты: `primary:Music`, `primary:`,
  `1234-ABCD:Music`; неизвестный том возвращает понятную ошибку.
- Long-press не срабатывает при скролле: pointer move > 10 px отменяет таймер,
  обычный tap по-прежнему играет трек.
- Long-press открывает контекстное меню трека и выделяет его; кнопка «Выбрать»
  и повторный tap управляют мультивыделением.
- Back при активном выделении снимает выделение, а не сворачивает приложение;
  playback не меняется.
- Destructive-операции не трогают `/sdcard/Music`; проверка по хешам до/после.
- Кириллица и пробелы в путях: `Asper X - Галопериод (СЛИВ Telegram).mp3`.

---

### Task 1: Android-пикеры файла, изображения и папки

**Files:**
- Modify: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/mobile/NovaMobilePlugin.kt`
- Create: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/mobile/NovaStorage.kt`
- Create: `src-tauri/plugins/nova-mobile/android/src/test/java/app/nova/mobile/NovaStorageTest.kt`
- Modify: `src-tauri/plugins/nova-mobile/android/build.gradle.kts`
- Modify: `src-tauri/plugins/nova-mobile/build.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Kotlin:
  - `internal fun treeDocumentIdToPath(documentId: String, primaryRoot: String): String?`
  - `internal fun treeUriToPath(uri: Uri): String?`
  - `internal fun copyContentToFile(context: Context, uri: Uri, targetDir: File): File`
  - Commands: `pickImage`, `pickAudio`, `pickFolder`; callbacks:
    `pickImageResult`, `pickAudioResult`, `pickFolderResult`.
  - Ответ: `JSObject` с полем `path: String?`; отмена — `path = null`.
- Rust:
  - `android_pick_image(app: AppHandle) -> Result<Option<String>, String>`
  - `android_pick_audio(app: AppHandle) -> Result<Option<String>, String>`
  - `android_pick_folder(app: AppHandle) -> Result<Option<String>, String>`
- JS:
  - `pickImage(): Promise<string | null>` и
    `pickAudioFile(): Promise<string | null>` используют Android-команды при
    `isAndroid`, иначе текущий `open` из `@tauri-apps/plugin-dialog`.
  - `pickFolder(title?: string): Promise<string | null>` — так же.

- [ ] **Step 1: Написать падающий Kotlin-тест**

```kotlin
class NovaStorageTest {
    @Test fun primaryMusic() {
        assertEquals(
            "/storage/emulated/0/Music",
            treeDocumentIdToPath("primary:Music", "/storage/emulated/0"),
        )
    }
    @Test fun primaryRoot() {
        assertEquals("/storage/emulated/0", treeDocumentIdToPath("primary:", "/storage/emulated/0"))
    }
    @Test fun sdCard() {
        assertEquals("/storage/1234-ABCD/Music", treeDocumentIdToPath("1234-ABCD:Music", "/storage/emulated/0"))
    }
    @Test fun malformed() {
        assertNull(treeDocumentIdToPath("primary", "/storage/emulated/0"))
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `.\gradlew.bat :tauri-plugin-nova-mobile:testDebugUnitTest`
(from `src-tauri/gen/android`)
Expected: FAIL — `treeDocumentIdToPath` не найден.

- [ ] **Step 3: Реализовать `NovaStorage.kt`**

`treeDocumentIdToPath` делит `documentId` по первому `:`; `primary` →
`primaryRoot`, иначе `/storage/<volume>`; `File(root, relative).absolutePath`.
`treeUriToPath` берёт `DocumentsContract.getTreeDocumentId(uri)` и
`Environment.getExternalStorageDirectory().absolutePath`.
`copyContentToFile` читает `contentResolver.openInputStream(uri)`, очищает имя
от `/\:*?"<>|`, пишет в `targetDir/<timestamp>-<name>` и возвращает файл.

- [ ] **Step 4: Запустить тест**

Run: тот же gradle-таск.
Expected: PASS (4 tests).

- [ ] **Step 5: Добавить команды и callbacks**

`pickImage`: `ACTION_OPEN_DOCUMENT`, `type = "image/*"`,
`CATEGORY_OPENABLE`. `pickAudio`: `type = "audio/*"` +
`EXTRA_MIME_TYPES` (`audio/mpeg`, `audio/flac`, `audio/wav`, `audio/ogg`,
`audio/mp4`). `pickFolder`: `ACTION_OPEN_DOCUMENT_TREE` с
`FLAG_GRANT_READ_URI_PERMISSION | FLAG_GRANT_WRITE_URI_PERMISSION |
FLAG_GRANT_PERSISTABLE_URI_PERMISSION`.

Callbacks:
- отмена (`resultCode != RESULT_OK`) → `path = null`;
- файл/картинка → `copyContentToFile(context, uri, File(filesDir, "nova-imports"))`;
- папка → `treeUriToPath(uri)`; `null` → `invoke.reject("Выберите папку во
  внутренней памяти")`; успех → `takePersistableUriPermission` и `path`.

- [ ] **Step 6: Добавить Rust-обёртки и JS**

`build.rs`: добавить `"pickImage"`, `"pickAudio"`, `"pickFolder"` в `COMMANDS`.
В `commands.rs` — общий `mobile_pick_path(app, command)`; в `lib.rs` —
регистрация трёх команд. В `tauri.ts` — `androidPickImage`,
`androidPickAudio`, `androidPickFolder` и ветки в `pickImage`,
`pickAudioFile`, `pickFolder`.

- [ ] **Step 7: Проверить на телефоне**

```powershell
adb -s 7ac47954 shell 'mkdir -p /sdcard/Download/NovaTest'
```

Собрать arm64 APK, установить, открыть «Настройки → Добавить папку»;
выбрать `/sdcard/Download/NovaTest` и убедиться, что `Files` возвращает путь, а
папка добавляется. Выбрать картинку для фона и проверить, что
`set_background` получает путь в `filesDir/nova-imports`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/plugins/nova-mobile src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "feat(android): add native file and folder pickers"
```

---

### Task 2: Long-press, выделение и touch-действия

**Files:**
- Create: `src/hooks/useLongPress.ts`
- Create: `src/store/selection.ts`
- Modify: `src/components/TrackRow.tsx`, `src/components/TrackTable.tsx`,
  `src/App.tsx`, `src/styles/app.css`
- Test: `.superpowers/sdd/2026-11-08-android-library/verify-selection.py`

**Interfaces:**
- `useLongPress(onLongPress: () => void, options?: { delayMs?: number;
  moveTolerancePx?: number })` → `{ onTouchStart, onTouchMove, onTouchEnd,
  onTouchCancel }`; defaults 450 ms / 10 px; `onTouchEnd` помечает
  `longPressFired`, чтобы `onClick` его проглотил.
- `useSelectionStore`:
  `selected: Set<number>`, `anchorIndex: number | null`,
  `selectOnly(id, index)`, `toggle(id, index)`, `selectRange(ids, anchorIndex)`,
  `clear()`.
- `TrackRow` получает `onLongPress?: () => void`; long-press вызывает
  `selectOnly(track.id, index)` и `onMenu()` (контекстное меню), обычный tap при
  пустом выделении играет трек, при активном — переключает выделение.
- `App.tsx` в back-handler после модалок и перед `canGoBack`:
  `if (useSelectionStore.getState().selected.size > 0) { clear(); return; }`.

- [ ] **Step 1: Написать падающий тест на телефоне**

Playwright: открыть `/library`, получить bounding box первого `.track-row`,
умножить координаты на `devicePixelRatio`, выполнить
`adb shell input swipe x y x y 600` (device px), подождать 300 ms, проверить
`.selection-bar`, текст `Выбрано 1` и открытый TrackActionsModal; нажать на
вторую строку — `Выбрано 2`; `adb shell input keyevent 4` — `.selection-bar`
исчез, приложение на переднем плане; обычный tap по строке запускает playback.
Отдельный кейс: начать swipe и сдвинуть палец на 30 px до 450 ms — выделение не
появляется, список скроллится.
Expected: FAIL — long-press не выделяет.

- [ ] **Step 2: Реализовать hook и store**

Таймер стартует в `onTouchStart`; `onTouchMove` отменяет при смещении > 10 px;
`onTouchEnd`/`onTouchCancel` очищают таймер. Store — Zustand, без persist.

- [ ] **Step 3: Перевести `TrackTable` на store**

Убрать локальные `useState` для `selected`/`anchorIndex`; `handleActivate`
использует store. Сохранить desktop-семантику Shift/Ctrl/⌘ и right-click
`onMenu`; добавить long-press только для touch.

- [ ] **Step 4: Прогнать тест и desktop smoke**

Run: тест из Step 1. Expected: PASS.
Run: `npm.cmd run build:web`; в браузере проверить Shift/Ctrl-выделение и
right-click. Expected: без регрессий.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLongPress.ts src/store/selection.ts src/components/TrackRow.tsx src/components/TrackTable.tsx src/App.tsx src/styles/app.css
git commit -m "feat(android): add long-press selection and back handling"
```

---

### Task 3: Плейлисты, избранное, поиск, папки на телефоне

**Files:**
- Modify (только найденные mobile-баги): `src/screens/Home.tsx`,
  `src/screens/Library.tsx`, `src/screens/Favorites.tsx`,
  `src/screens/PlaylistDetail.tsx`, `src/screens/Settings.tsx`,
  `src/styles/app.css`
- Test: `.superpowers/sdd/2026-11-08-android-library/verify-library.py`

**Interfaces:** использует Task 1 (пикеры) и Task 2 (выделение); новых
команд нет.

- [ ] **Step 1: Создать безопасную папку**

```powershell
adb -s 7ac47954 shell 'mkdir -p /sdcard/Download/NovaTest'
adb -s 7ac47954 shell 'find /sdcard/Music -maxdepth 1 -type f -name "*.mp3" | head -n 12 | while read f; do cp "$f" /sdcard/Download/NovaTest/; done'
```

- [ ] **Step 2: Написать тест библиотечных сценариев**

Playwright/ADB: добавить NovaTest через
`window.__TAURI_INTERNALS__.invoke('add_folder', { path: '/sdcard/Download/NovaTest' })`
(сам SAF-пикер проверяется в Task 1); проверить `12 треков`;
создать плейлист «Тест»; long-press двух треков; «В плейлист»; открыть
плейлист — 2 трека; добавить трек в избранное; поиск по кириллической
подстроке (`Галопериод`) находит файл
`Asper X - Галопериод (СЛИВ Telegram).mp3`; переименовать/удалить плейлист;
убрать папку NovaTest из библиотеки (файлы оставить для Task 4); проверить
SQLite. Expected: FAIL до исправлений mobile-багов (если они есть).

- [ ] **Step 3: Исправить найденные mobile-баги**

Проверить на 392 px: шапка, поиск, tab-ы, selection bar, плейлист, пустые
состояния, кнопки ≥ 44 px, отсутствие горизонтального скролла. Не менять
desktop-разметку без необходимости.

- [ ] **Step 4: Прогнать тест**

Run: тест из Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens src/styles/app.css
git commit -m "fix(android): polish library and playlist screens"
```

---

### Task 4: Редактирование, обложки, фоны, удаление, дубликаты, кодировка, merge

**Files:**
- Modify (только баги): `src/components/EditTrackModal.tsx`,
  `src/components/TrackActionsModal.tsx`,
  `src/components/DuplicateTracksModal.tsx`,
  `src/components/EncodingFixModal.tsx`,
  `src/components/MergeAlbumsModal.tsx`, `src/screens/Settings.tsx`
- Test: `.superpowers/sdd/2026-11-08-android-library/verify-destructive.py`

**Interfaces:** использует пикеры Task 1; Rust-команды `update_track_metadata`,
`set_track_cover`, `clear_track_cover`, `set_background`, `clear_background`,
`hide_track`, `restore_track`, `delete_track`, `delete_tracks`,
`hash_tracks`, `preview_tag_encoding`, `apply_tag_encoding`, `merge_albums`.

- [ ] **Step 1: Зафиксировать хеши оригиналов**

Если `/sdcard/Download/NovaTest` отсутствует или пуст — создать его и
скопировать 12 файлов из `/sdcard/Music`; затем добавить NovaTest в библиотеку.
Скачать 12 файлов из `/sdcard/Music` и посчитать SHA-256 в PowerShell
(`Get-FileHash`); сохранить список в
`.superpowers/sdd/2026-11-08-android-library/music-before.txt`.

- [ ] **Step 2: Написать destructive-тест**

Playwright/ADB на NovaTest:
1. Edit: изменить title/artist; проверить `update_track_metadata` и UI.
2. Cover: выбрать картинку через пикер; проверить `customCoverPath` и файл.
3. Background: выбрать картинку; проверить `backgroundUrl`.
4. Duplicates: скопировать один файл в `copy.mp3`; `hash_tracks` находит
   группу; удалить дубликат.
5. Encoding: `preview_tag_encoding`/`apply_tag_encoding` на копии; проверить,
   что валидная кириллица не испорчена.
6. Merge: две подписи альбома одного артиста; `merge_albums`; проверить
   группировку.
7. Hide/restore и удалить один файл NovaTest.
Expected: FAIL до исправлений (если они есть).

- [ ] **Step 3: Исправить найденные баги**

Только в модалках/настройках; не менять Rust-команды без необходимости.

- [ ] **Step 4: Проверить оригиналы и прогнать тест**

Скачать 12 файлов из `/sdcard/Music` снова, сравнить SHA-256 с
`music-before.txt`; удалить NovaTest. Повторить тест. Expected: PASS,
оригиналы не изменены.

- [ ] **Step 5: Commit**

```bash
git add src/components src/screens/Settings.tsx
git commit -m "fix(android): verify editing and destructive library flows"
```

---

### Task 5: Приёмка phase 2A и документация

**Files:**
- Modify: `docs/ANDROID.md`
- Modify: `docs/DECISIONS.md` (если меняются правила)

- [ ] **Step 1: Windows-регрессия**

Run:
```powershell
npm.cmd run build:web
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
Expected: оба exit code 0; 13 Rust-тестов PASS.

- [ ] **Step 2: Полный прогон на телефоне**

Проверить: плейлисты, избранное, поиск, альбомы, папки, редактирование,
обложки, фоны, удаление, дубликаты, кодировку, merge; long-press/выделение;
back; 392 px без overflow; скриншоты ключевых экранов.

- [ ] **Step 3: Обновить `docs/ANDROID.md`**

Записать дату, устройство `7ac47954`, количество треков, результаты, известные
ограничения (SAF-папки вне внутренней памяти, MIUI-уведомление).

- [ ] **Step 4: Commit**

```bash
git add docs/ANDROID.md docs/DECISIONS.md
git commit -m "docs: record android library acceptance"
```
