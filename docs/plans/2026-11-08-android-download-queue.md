# Nova Android Phase 2B-2 — Persistent Download Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> (recommended) or executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [x]`) syntax for tracking.

**Goal:** Перенести очередь/историю загрузок в SQLite, запускать загрузки
нативным worker'ом и `NovaTaskService` (dataSync), переживать перезапуск
приложения и отменять прямые Rust-загрузки.

**Architecture:** Rust владеет очередью в `nova.db`; фоновый worker читает
очередь отдельным SQLite-соединением, выполняет direct/yt-dlp задачи через
существующие `media` функции и обновляет статусы. Kotlin `NovaTaskService`
держит процесс в foreground и показывает прогресс; JS — только представление,
hydrate из БД и события. 2B-1 (встроенный yt-dlp) остаётся основой.

**Tech Stack:** Tauri 2, Rust/rusqlite/tokio, Kotlin foreground service,
React/Zustand, ADB/Playwright.

**Spec:** `docs/specs/2026-11-07-nova-android-design.md` (4.3, 6.3, 7, 9, 11.5)
**Roadmap:** `docs/plans/2026-11-08-android-phase2-roadmap.md`

## Global Constraints

- Android 10+ (minSdk 29), targetSdk 36; phone `7ac47954` (Android 13, arm64).
- `NovaTaskService` type `dataSync`, channel `nova_downloads`, Android 14+
  timeout/pause; foreground service keeps the process alive.
- Queue/history survive process restart; in-flight jobs are re-queued on start.
- Direct Rust downloads must be cancellable (token checked while streaming).
- `/sdcard/Music` unchanged; test downloads `/sdcard/Download/NovaDownloads`.
- Windows: `npm.cmd run build:web`,
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
- 392 CSS px, 44 px controls; no 2C/2D scope creep.
- GPL/license docs stay current.

## Review Focus

- Restart: kill the app mid-queue; on relaunch the job is `queued` and resumes,
  not `done`/stuck.
- Cancel: direct and yt-dlp jobs stop, delete their own staging/partial files,
  and never become `done`; a concurrent job's file is untouched.
- Background: screen off/Home keeps the queue moving; notification updates;
  Android 14 timeout pauses instead of crashing.
- DB: WAL concurrent worker/app connections; no lock held across await;
  history/queue dedupe; terminal statuses only once.
- UI: hydrate doesn't duplicate events; pause/resume/move/cancel reflect DB;
  progress from a previous session isn't resurrected.
- Foreground service start/stop/restart; no orphan notification.

---

### Task 1: SQLite queue/history schema, commands and JS hydration

**Files:**
- Modify: `src-tauri/src/db.rs` (schema)
- Modify: `src-tauri/src/models.rs` (DownloadTask/QueueItem)
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- Modify: `src/types.ts`, `src/lib/tauri.ts`, `src/store/downloads.ts`,
  `src/hooks/useDownloadProgress.ts`
- Test: `src-tauri/src/downloads.rs` (new module + unit tests)

**Interfaces:**
- Tables:
  `download_queue(id TEXT PRIMARY KEY, kind TEXT, url TEXT, query TEXT,
  output_dir TEXT, file_name TEXT, expected_artist TEXT, expected_title TEXT,
  title TEXT, status TEXT, percent REAL, line TEXT, path TEXT, error TEXT,
  order_index INTEGER, created_at INTEGER, updated_at INTEGER, finished_at INTEGER)`;
  `download_history(id INTEGER PRIMARY KEY AUTOINCREMENT, download_id TEXT,
  title TEXT, line TEXT, status TEXT, path TEXT, error TEXT, finished_at INTEGER)`.
- Rust:
  - `pub struct DownloadTask { id, kind, url, query, output_dir, file_name,
    expected_artist, expected_title, title }`
  - `download_queue_list(state) -> Result<Vec<DownloadProgress>, String>`
  - `download_history_list(state) -> Result<Vec<DownloadHistoryItem>, String>`
  - `download_enqueue(state, task) -> Result<String, String>`
  - `download_queue_pause(state, paused) -> Result<(), String>`
  - `download_queue_cancel(state, id) -> Result<bool, String>`
  - `download_queue_move(state, id, direction) -> Result<(), String>`
  - `download_history_clear(state) -> Result<(), String>`
  - `download_queue_resume(state) -> Result<(), String>` (re-queue
    `starting/downloading`; called on startup)
- JS:
  - `api.downloadQueueList/HistoryList/Enqueue/Pause/Cancel/Move/HistoryClear/QueueResume`.
  - `useDownloadStore.hydrate()` loads queue + history; `enqueue(task)` calls native;
  - `useDownloadProgress` calls `hydrate` once and keeps the progress listener.

- [x] **Step 1: Add schema and a failing Rust test**

Create `src-tauri/src/downloads.rs` with an in-memory `Connection` test:
```rust
#[test]
fn enqueue_list_and_move() {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::apply_schema(&conn).unwrap();
    let id = queue::enqueue(&conn, task("a", "https://example/a.mp3")).unwrap();
    queue::enqueue(&conn, task("b", "https://example/b.mp3")).unwrap();
    assert_eq!(queue::ids(&conn).unwrap(), vec![id.clone(), "b".into()]);
    queue::move_item(&conn, &id, 1).unwrap();
    assert_eq!(queue::ids(&conn).unwrap(), vec!["b".into(), id]);
}
```
Run `cargo test --manifest-path src-tauri/Cargo.toml --lib downloads::`.
Expected: FAIL — tables/helpers missing.

- [x] **Step 2: Implement schema and queue helpers**

Expose `pub(crate) fn apply_schema(conn: &Connection)` from `db.rs` (or a
`downloads::ensure_schema` called by both `db::init` and tests). Implement
`queue::enqueue/list/ids/move/set_status/set_paused`, `history::insert/list/clear`
with SQL, no business logic. `enqueue` appends `order_index = max+1`.
`resume` sets `starting/downloading` to `queued`, clears percent/error.

- [x] **Step 3: Rust commands and registration**

Add the commands in `commands.rs` (state DB lock only around SQL), register in
`lib.rs`, and add unit tests for enqueue/list/move/cancel/resume/history.

- [x] **Step 4: JS types/API and store hydrate**

Add `DownloadTask`, `DownloadQueueItem` types and API methods. `useDownloadStore`
adds `hydrate` and native `enqueue/pause/resume/cancel/move/clearHistory`;
`useDownloadProgress` calls `hydrate` once. Do not switch the existing
Downloads/Import queue loop yet; this task only makes persistence available.

- [x] **Step 5: Verify**

Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`,
`npm.cmd run build:web`, and on the phone invoke `download_queue_list` →
`[]`, `download_history_list` → `[]`. Commit.

---

### Task 2: Native download worker, cancellation and scan

**Files:**
- Modify: `src-tauri/src/downloads.rs`, `src-tauri/src/lib.rs`,
  `src-tauri/src/commands.rs`, `src-tauri/src/media.rs`, `src-tauri/src/models.rs`
- Modify: `src-tauri/plugins/nova-mobile/android/.../NovaDownloadPlugin.kt`
  (only if cancel needs a process id)
- Test: `.superpowers/sdd/2026-11-08-android-download-queue/verify-worker.py`

**Interfaces:**
- `downloads::start_worker(app: AppHandle)`, `stop_worker()`,
  `cancel_token(id) -> Arc<AtomicBool>`, `is_running()`.
- Worker connection: dedicated `rusqlite::Connection::open(app_dir/nova.db)`
  with WAL; no `AppState` mutex held across await.
- `media::download_direct(..., cancel: Option<Arc<AtomicBool>>)` checks the
  token each stream chunk and deletes its own partial file on cancel.
- `download_queue_start(app)` starts the worker if not running; enqueue starts it.
- On terminal: update queue, insert history, add output dir to folders and scan,
  emit `download-complete`; on cancel/error clean own files.

- [x] **Step 1: Failing worker test**

Create an in-memory queue test that seeds a direct task, runs one worker step
with a local HTTP server, and asserts status `done`, path exists, history row.
Expected: FAIL — worker missing.

- [x] **Step 2: Implement worker loop**

Loop: read oldest `queued` (or `downloading` after resume), skip if paused;
mark `starting`, emit; call `media::download_media`/`download_direct`; update
`downloading`; on result `done` + path + history + scan; on error `error` +
message; on cancel `cancelled`, delete own files; sleep 250 ms when empty.
Use `tokio::spawn`; guard with an `AtomicBool` `worker_running`.

- [x] **Step 3: Cancellation**

Map `id -> Arc<AtomicBool>`; `download_queue_cancel` sets the token and calls
`android_download_cancel` for yt-dlp; `download_direct` checks it while
streaming; worker marks cancelled. Add a device test: large direct URL, cancel,
no file/done.

- [x] **Step 4: Native scan**

On `done`, add the output dir to folders (INSERT OR IGNORE) and call
`scanner::scan` with a short-lived DB connection; emit `download-complete`.
The JS can refresh with `get_snapshot`.

- [x] **Step 5: Verify/commit**

Rust tests, direct + yt-dlp worker on phone, cancel, scan; commit.

---

### Task 3: NovaTaskService dataSync + notification

**Files:**
- Create: `src-tauri/plugins/nova-mobile/android/src/main/java/app/nova/download/NovaTaskService.kt`
- Modify: `NovaDownloadPlugin.kt`, `AndroidManifest.xml`
- Test: `verify-service.py`

**Interfaces:**
- Kotlin commands: `startTaskService`, `updateTaskNotification`
  (`{title,percent,status}`), `stopTaskService`.
- Service: `dataSync` foreground, channel `nova_downloads` (IMPORTANCE_LOW),
  `START_STICKY`, `onTimeout` (API 35) pauses the queue via a flag/command.
- Worker starts service on enqueue, updates notification (throttled), stops on
  empty; on paused/timeout the service remains with «Пауза».

- [x] **Step 1: Implement service and manifest** (no notification spam; update
  max once per 500 ms).
- [x] **Step 2: Wire worker start/stop/progress.**
- [x] **Step 3: Device test:** enqueue yt-dlp, Home/screen off, verify progress
  continues, notification updates, `dumpsys activity services` shows
  `NovaTaskService` foreground `dataSync`; Android 14 timeout path simulated by
  calling `onTimeout`/pause command, queue pauses, app doesn't crash.
- [x] **Step 4: Commit.**

---

### Task 4: UI on native queue/history + restart

**Files:**
- Modify: `src/store/downloads.ts`, `src/hooks/useDownloadProgress.ts`,
  `src/screens/Downloads.tsx`, `src/screens/Import.tsx`, `src/styles/app.css`
- Test: `verify-queue-ui.py`

**Interfaces:**
- Store: `items`/`pending`/`history`/`paused` hydrate from native; `enqueue`
  takes `DownloadTask`; `pauseQueue/resumeQueue/cancelQueued/moveQueued/
  clearHistory` call native; `upsert` only mirrors events.
- Remove the JS `nextQueued` loop and `localStorage` history; Downloads/Import
  call `api.downloadEnqueue` and rely on events; on `download-complete` call
  `load()`; preserve retry/cancel/duplicate UI.
- Restart: on mount `download_queue_resume` + hydrate; in-flight jobs show
  queued/downloading from DB.

- [x] **Step 1: Refactor store and screens; remove the JS queue loop.**
- [x] **Step 2: Device test:** enqueue 2 direct + 1 yt-dlp; pause/resume/move/
  cancel; force-stop/relaunch; queue resumes and finishes; history persists;
  background/notification; 392 px/44 px; cleanup.
- [x] **Step 3: Commit.**

---

### Task 5: Phase 2B-2 acceptance and docs

**Files:** `docs/ANDROID.md`, `README.md`, roadmap, `docs/THIRD_PARTY.md` if
new components.

- [x] **Step 1: Windows regression** (`build:web`, cargo tests).
- [x] **Step 2: Phone acceptance:** restart/resume, background, notification,
  Android 14 timeout simulation, direct/yt-dlp cancel, history persistence,
  78 Music tracks, `/sdcard/Music` unchanged, cleanup.
- [x] **Step 3: Docs:** 2B-2 section, limitations, next 2C/2D.
- [x] **Step 4: Commit.**
