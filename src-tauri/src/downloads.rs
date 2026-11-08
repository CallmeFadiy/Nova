//! Persistent download queue and history.
//!
//! All SQL lives here. Tauri commands in `commands.rs` only take the app DB
//! mutex and delegate, so the same helpers are unit-tested against an in-memory
//! SQLite database without a running app.

use crate::db::now_secs;
use crate::models::{
    DownloadComplete, DownloadHistoryItem, DownloadProgress, DownloadQueueRow, DownloadResult,
    DownloadTask,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Settings key for the global queue pause flag. The queue table has no
/// `paused` column because pause applies to the whole worker, not one row.
pub const PAUSED_KEY: &str = "download_queue_paused";

/// Newest-first history cap, matching `HISTORY_LIMIT` in the JS store.
pub const HISTORY_LIMIT: i64 = 80;

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Fallback id for callers that do not generate one themselves. JS normally
/// passes an id so progress events, cancellation and history share one key.
pub fn new_id() -> String {
    let seq = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("dl-{}-{seq}", crate::db::now_millis())
}

pub mod queue {
    use super::*;

    /// Appends a task at the end of the queue. A blank `task.id` is replaced
    /// with a generated id; the effective id is returned.
    pub fn enqueue(conn: &Connection, task: &DownloadTask) -> rusqlite::Result<String> {
        let id = if task.id.trim().is_empty() {
            new_id()
        } else {
            task.id.clone()
        };
        let order_index: i64 = conn.query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 FROM download_queue",
            [],
            |row| row.get(0),
        )?;
        let now = now_secs();
        conn.execute(
            r#"
            INSERT INTO download_queue (
                id, kind, url, query, output_dir, file_name, expected_artist,
                expected_title, title, status, percent, line, path, error,
                order_index, created_at, updated_at, finished_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'queued', 0, '', NULL, NULL,
                ?10, ?11, ?11, NULL
            )
            "#,
            params![
                id,
                task.kind,
                task.url,
                task.query,
                task.output_dir,
                task.file_name,
                task.expected_artist,
                task.expected_title,
                task.title,
                order_index,
                now,
            ],
        )?;
        Ok(id)
    }

    pub fn ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT id FROM download_queue ORDER BY order_index ASC, created_at ASC, rowid ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    pub fn list(conn: &Connection) -> rusqlite::Result<Vec<DownloadQueueRow>> {
        let mut stmt = conn.prepare(
            r#"
            SELECT id, kind, title, percent, line, status, path, error, order_index
            FROM download_queue
            ORDER BY order_index ASC, created_at ASC, rowid ASC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DownloadQueueRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                percent: row.get(3)?,
                line: row.get(4)?,
                status: row.get(5)?,
                path: row.get(6)?,
                error: row.get(7)?,
                order_index: row.get(8)?,
                // Direct Rust downloads are cancelled with a token, yt-dlp jobs
                // with the embedded process id, so every queued row is
                // cancellable now.
                cancellable: true,
            })
        })?;
        rows.collect()
    }

    /// Swaps the row with its neighbour in queue order. Moving past either end
    /// is a no-op. `order_index` is renumbered from scratch so duplicate values
    /// from older builds or a crashed writer cannot wedge the queue.
    pub fn move_item(conn: &Connection, id: &str, direction: i64) -> rusqlite::Result<()> {
        if direction != -1 && direction != 1 {
            return Ok(());
        }
        let mut ids = ids(conn)?;
        let Some(index) = ids.iter().position(|queued| queued == id) else {
            return Ok(());
        };
        let target = index as i64 + direction;
        if target < 0 || target as usize >= ids.len() {
            return Ok(());
        }
        ids.swap(index, target as usize);

        let tx = conn.unchecked_transaction()?;
        let now = now_secs();
        for (position, queued_id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE download_queue SET order_index = ?2, updated_at = ?3 WHERE id = ?1",
                params![queued_id, position as i64, now],
            )?;
        }
        tx.commit()
    }

    /// `(active, queued)` counts. `active` means a row the worker owns
    /// (`starting`/`downloading`); terminal rows are ignored so the service is
    /// stopped once the last finished row is recorded.
    pub fn counts(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
        conn.query_row(
            r#"
            SELECT
                SUM(CASE WHEN status IN ('starting', 'downloading') THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)
            FROM download_queue
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                ))
            },
        )
    }

    /// Deletes rows whose terminal state has already been recorded in
    /// `download_history`. Keeps the queue table bounded across restarts.
    pub fn clear_finished(conn: &Connection) -> rusqlite::Result<usize> {
        conn.execute(
            "DELETE FROM download_queue WHERE status IN ('done', 'error', 'cancelled')",
            [],
        )
    }

    /// Oldest row the worker should run. Rows a previous process left in
    /// `starting`/`downloading` are re-queued by [`resume`] before the first
    /// pick, so only `queued` rows are eligible here.
    pub fn next_queued(conn: &Connection) -> rusqlite::Result<Option<DownloadTask>> {
        conn.query_row(
            r#"
            SELECT id, kind, url, query, output_dir, file_name, expected_artist,
                   expected_title, title
            FROM download_queue
            WHERE status = 'queued'
            ORDER BY order_index ASC, created_at ASC, rowid ASC
            LIMIT 1
            "#,
            [],
            |row| {
                Ok(DownloadTask {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    url: row.get(2)?,
                    query: row.get(3)?,
                    output_dir: row.get(4)?,
                    file_name: row.get(5)?,
                    expected_artist: row.get(6)?,
                    expected_title: row.get(7)?,
                    title: row.get(8)?,
                })
            },
        )
        .optional()
    }

    /// Status and kind for one row, used by cancellation to distinguish a
    /// queued row (safe to delete) from an active one (must be stopped by the
    /// worker so it can clean its own files).
    pub fn status_kind(conn: &Connection, id: &str) -> rusqlite::Result<Option<(String, String)>> {
        conn.query_row(
            "SELECT status, kind FROM download_queue WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
    }

    /// Updates worker-owned columns. `None` keeps the stored value for percent,
    /// line and path; `error` is always written so a retry can clear it.
    /// Used by the native worker in Task 2.
    pub fn set_status(
        conn: &Connection,
        id: &str,
        status: &str,
        percent: Option<f64>,
        line: Option<&str>,
        path: Option<&str>,
        error: Option<&str>,
    ) -> rusqlite::Result<usize> {
        let now = now_secs();
        conn.execute(
            r#"
            UPDATE download_queue SET
                status = ?2,
                percent = COALESCE(?3, percent),
                line = COALESCE(?4, line),
                path = COALESCE(?5, path),
                error = ?6,
                updated_at = ?7,
                finished_at = CASE
                    WHEN ?2 IN ('done', 'error', 'cancelled') THEN COALESCE(finished_at, ?7)
                    ELSE finished_at
                END
            WHERE id = ?1
            "#,
            params![id, status, percent, line, path, error, now],
        )
    }

    pub fn set_paused(conn: &Connection, paused: bool) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![PAUSED_KEY, if paused { "1" } else { "0" }],
        )?;
        Ok(())
    }

    /// Read by the worker before it picks the next row.
    pub fn is_paused(conn: &Connection) -> rusqlite::Result<bool> {
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![PAUSED_KEY],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.as_deref() == Some("1"))
    }

    /// Removes only a still-queued row. The worker moves a claimed row to
    /// `starting` under the same lock, so a zero-row result here means the
    /// worker owns it and must stop it through its cancel token instead of
    /// having its row deleted underneath it.
    pub fn cancel_queued(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
        let removed = conn.execute(
            "DELETE FROM download_queue WHERE id = ?1 AND status = 'queued'",
            params![id],
        )?;
        Ok(removed > 0)
    }

    /// Re-queues rows a previous process left mid-flight. Called on startup.
    /// `active` is the row the live worker already owns; a startup command that
    /// races the worker must not put that row back in the queue.
    pub fn resume_except(
        conn: &Connection,
        active: Option<&str>,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            r#"
            UPDATE download_queue SET
                status = 'queued',
                percent = 0,
                line = '',
                path = NULL,
                error = NULL,
                updated_at = ?1
            WHERE status IN ('starting', 'downloading')
              AND (?2 IS NULL OR id != ?2)
            "#,
            params![now_secs(), active],
        )
    }

    pub fn resume(conn: &Connection) -> rusqlite::Result<usize> {
        resume_except(conn, None)
    }
}

pub mod history {
    use super::*;

    /// Records a finished download. A retry replaces the earlier entry with the
    /// same download id so history shows one row per task.
    pub fn insert(conn: &Connection, item: &DownloadHistoryItem) -> rusqlite::Result<i64> {
        let finished_at = if item.finished_at > 0 {
            item.finished_at
        } else {
            now_secs()
        };
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM download_history WHERE download_id = ?1",
            params![item.id],
        )?;
        tx.execute(
            r#"
            INSERT INTO download_history (
                download_id, title, line, status, path, error, finished_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                item.id,
                item.title,
                item.line,
                item.status,
                item.path,
                item.error,
                finished_at,
            ],
        )?;
        // Keep the table bounded like history::list so an unattended worker
        // cannot grow it forever.
        tx.execute(
            r#"
            DELETE FROM download_history
            WHERE id NOT IN (
                SELECT id FROM download_history
                ORDER BY finished_at DESC, id DESC
                LIMIT ?1
            )
            "#,
            params![HISTORY_LIMIT],
        )?;
        let row_id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(row_id)
    }

    pub fn list(conn: &Connection) -> rusqlite::Result<Vec<DownloadHistoryItem>> {
        let mut stmt = conn.prepare(
            r#"
            SELECT download_id, title, line, status, path, error, finished_at
            FROM download_history
            ORDER BY finished_at DESC, id DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt.query_map(params![HISTORY_LIMIT], |row| {
            Ok(DownloadHistoryItem {
                id: row.get(0)?,
                title: row.get(1)?,
                line: row.get(2)?,
                status: row.get(3)?,
                path: row.get(4)?,
                error: row.get(5)?,
                finished_at: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn clear(conn: &Connection) -> rusqlite::Result<usize> {
        conn.execute("DELETE FROM download_history", [])
    }
}

/// Set when the background queue worker task is alive. Enqueue, resume and app
/// startup all call [`start_worker`]; only the first call spawns a task.
static WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Set by [`stop_worker`]. The loop exits between items (a running download is
/// allowed to finish so its files and queue row stay consistent).
static WORKER_STOP: AtomicBool = AtomicBool::new(false);

/// Whether `NovaTaskService` is currently in the foreground. The worker starts
/// it before the first task and stops it when no queued/active row remains.
static SERVICE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Ensures the "Пауза" notification is posted only once while the queue stays
/// paused instead of on every 250 ms worker tick.
static PAUSED_SHOWN: AtomicBool = AtomicBool::new(false);

/// Id of the row the worker is running. Progress events for other ids (the
/// legacy JS download path) must not overwrite the queue notification.
static ACTIVE_TASK_ID: Mutex<Option<String>> = Mutex::new(None);

/// Written by `NovaTaskService.onTimeout` (API 35) next to `nova.db`, i.e. in
/// Rust's `app_data_dir`. The worker consumes it and persists the pause flag.
const TIMEOUT_MARKER: &str = "nova-task-timeout-pause";

/// Cancellation flags by download id. `download_queue_cancel` sets the flag;
/// `download_direct` polls it while streaming and the worker checks it before
/// and after dispatch. Entries are removed on terminal status so the map does
/// not grow for the life of the process.
static CANCEL_TOKENS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn cancel_tokens() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    CANCEL_TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Token for one download. Returns the existing flag when a cancel request
/// created it before the worker picked the row.
pub fn cancel_token(id: &str) -> Arc<AtomicBool> {
    let mut tokens = cancel_tokens()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    tokens
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

/// Drops the token for a finished download. Safe when no token exists.
pub fn forget_cancel_token(id: &str) {
    let mut tokens = cancel_tokens()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    tokens.remove(id);
}

/// Whether the background queue task is alive. Task 3 uses it to decide when a
/// foreground service can be stopped; unit tests assert it stays false.
#[allow(dead_code)]
pub fn is_running() -> bool {
    WORKER_RUNNING.load(Ordering::SeqCst)
}

/// Starts the queue worker if it is not already running. Called from app setup,
/// enqueue, queue start and resume.
pub fn start_worker(app: AppHandle) {
    if WORKER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    WORKER_STOP.store(false, Ordering::SeqCst);

    let Some(state) = app.try_state::<crate::AppState>() else {
        WORKER_RUNNING.store(false, Ordering::SeqCst);
        eprintln!("download worker: AppState is not managed yet");
        return;
    };
    let app_dir = state.app_dir.clone();
    drop(state);

    tauri::async_runtime::spawn(async move {
        let db_path = app_dir.join("nova.db");
        match open_worker_connection(&db_path) {
            Ok(conn) => {
                // Rows a killed process left in starting/downloading are safe to
                // try again: direct writes delete their partial file, yt-dlp
                // deletes its staging directory.
                if let Err(error) = queue::resume(&conn) {
                    eprintln!("download worker: cannot reset interrupted rows: {error}");
                }
                // A `Connection` is Send but not Sync, so the long-lived worker
                // keeps it behind a mutex and only locks around short SQL
                // sections. The guard is never held across an `.await`.
                let db = Mutex::new(conn);
                worker_loop(&db, Some(&app), Some(&app_dir), Some(&db_path)).await;
            }
            Err(error) => eprintln!(
                "download worker: cannot open {}: {error}",
                db_path.display()
            ),
        }
        WORKER_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Asks the worker to exit before picking the next row.
pub fn stop_worker() {
    WORKER_STOP.store(true, Ordering::SeqCst);
}

fn set_active_task(id: Option<&str>) {
    let mut active = ACTIVE_TASK_ID
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *active = id.map(str::to_string);
}

/// Id of the row the worker currently owns. Startup resume uses it to avoid
/// re-queueing a row that a live worker is already downloading.
pub fn active_task_id() -> Option<String> {
    ACTIVE_TASK_ID
        .lock()
        .map(|active| active.clone())
        .unwrap_or(None)
}

/// Whether `id` is the queue row currently running. Used by `media` progress
/// callbacks so a legacy JS download cannot overwrite the queue notification.
#[cfg(target_os = "android")]
pub fn is_active_download(id: &str) -> bool {
    ACTIVE_TASK_ID
        .lock()
        .map(|active| active.as_deref() == Some(id))
        .unwrap_or(false)
}

fn service_start(app: Option<&AppHandle>, title: &str) {
    #[cfg(target_os = "android")]
    if let Some(app) = app {
        // Always drive a START, even when a previous task is still running: it
        // refreshes the notification title for the new row. Kotlin uses a plain
        // `startService` in that case, so a background queue stays allowed.
        if crate::commands::android_task_service_start(app, title, 0.0, "starting") {
            SERVICE_ACTIVE.store(true, Ordering::SeqCst);
            PAUSED_SHOWN.store(false, Ordering::SeqCst);
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, title);
}

fn service_update(app: Option<&AppHandle>, percent: f64, status: &str) {
    #[cfg(target_os = "android")]
    if let Some(app) = app {
        if SERVICE_ACTIVE.load(Ordering::SeqCst) {
            crate::commands::android_task_notification(app, "", percent, status);
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, percent, status);
}

fn service_stop(app: Option<&AppHandle>) {
    #[cfg(target_os = "android")]
    if let Some(app) = app {
        if SERVICE_ACTIVE.swap(false, Ordering::SeqCst) {
            crate::commands::android_task_service_stop(app);
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    PAUSED_SHOWN.store(false, Ordering::SeqCst);
}

/// Claims `NovaTaskService` from a foreground Rust command (enqueue/start/
/// resume). Android 12+ rejects a foreground-service start once the app is in
/// the background, so the worker's lazy start on claim can be too late; these
/// commands start it while the activity is still foreground and the worker only
/// refreshes the running service afterwards.
pub fn ensure_task_service(app: &AppHandle, title: &str) -> bool {
    #[cfg(target_os = "android")]
    {
        let Some(state) = app.try_state::<crate::AppState>() else {
            return false;
        };
        let (paused, active, queued, live, next_title) = {
            let Ok(conn) = state.db.lock() else {
                return false;
            };
            let paused = queue::is_paused(&conn).unwrap_or(false);
            let (active, queued) = queue::counts(&conn).unwrap_or((0, 0));
            let rows = queue::list(&conn).unwrap_or_default();
            // Prefer the row the worker already owns: enqueueing another task
            // must not overwrite the notification title of the live download.
            let live = rows
                .iter()
                .find(|row| matches!(row.status.as_str(), "starting" | "downloading"))
                .or_else(|| rows.iter().find(|row| row.status == "queued"))
                .map(|row| {
                    (
                        row.title.clone().unwrap_or_default(),
                        row.percent,
                        row.status.clone(),
                    )
                });
            let next_title = rows
                .iter()
                .find(|row| row.status == "queued")
                .and_then(|task| task.title.clone())
                .unwrap_or_default();
            (paused, active, queued, live, next_title)
        };
        if paused || active + queued == 0 {
            return false;
        }
        let (title, percent, status) = match live {
            Some((live_title, percent, status)) if !live_title.trim().is_empty() => {
                (live_title, percent, status)
            }
            Some((_, percent, status)) => {
                let title = if title.trim().is_empty() {
                    next_title
                } else {
                    title.to_string()
                };
                (title, percent, status)
            }
            None => (title.to_string(), 0.0, "starting".to_string()),
        };
        let started =
            crate::commands::android_task_service_start(app, &title, percent, &status);
        if started {
            // Keep the worker-side flags in sync: `service_after_step` must be
            // able to update and stop a service that this command started.
            SERVICE_ACTIVE.store(true, Ordering::SeqCst);
            PAUSED_SHOWN.store(false, Ordering::SeqCst);
        }
        started
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, title);
        false
    }
}

/// Applies the Android 15 `dataSync` timeout marker written by the service.
/// Returns `true` when a marker was consumed.
fn consume_timeout_marker(db: &Mutex<Connection>, app_dir: &Path) -> bool {
    let marker = app_dir.join(TIMEOUT_MARKER);
    if !marker.exists() {
        return false;
    }
    let _ = std::fs::remove_file(&marker);
    let paused = with_db(db, |conn| queue::set_paused(conn, true));
    if let Err(error) = paused {
        eprintln!("download worker: cannot persist timeout pause: {error}");
    }
    // The service already left the foreground in `onTimeout`; do not try to
    // stop it again, just forget it so the next task starts a fresh one.
    SERVICE_ACTIVE.store(false, Ordering::SeqCst);
    PAUSED_SHOWN.store(true, Ordering::SeqCst);
    true
}

/// Stops the foreground service when no work is left, and posts a single
/// "Пауза" update while the queue is paused with pending rows.
fn service_after_step(db: &Mutex<Connection>, app: Option<&AppHandle>) {
    let (active, queued, paused) = with_db(db, |conn| {
        let counts = queue::counts(conn).unwrap_or((0, 0));
        let paused = queue::is_paused(conn).unwrap_or(false);
        (counts.0, counts.1, paused)
    });

    if active == 0 && queued == 0 {
        service_stop(app);
        return;
    }

    if paused {
        if !PAUSED_SHOWN.swap(true, Ordering::SeqCst) {
            service_update(app, 0.0, "paused");
        }
    } else {
        PAUSED_SHOWN.store(false, Ordering::SeqCst);
    }
}

/// Dedicated connection for the worker. WAL matches `db::init`; the busy
/// timeout lets the worker and UI commands share the database instead of
/// failing with `SQLITE_BUSY` during a scan or a queue update.
fn open_worker_connection(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(conn)
}

/// Runs `f` with the worker connection locked. Never call this around an
/// `.await`: the guard makes the surrounding future non-`Send`.
fn with_db<T>(db: &Mutex<Connection>, f: impl FnOnce(&Connection) -> T) -> T {
    let conn = db
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&conn)
}

async fn worker_loop(
    db: &Mutex<Connection>,
    app: Option<&AppHandle>,
    app_dir: Option<&Path>,
    db_path: Option<&Path>,
) {
    const IDLE_SLEEP: Duration = Duration::from_millis(250);

    loop {
        if WORKER_STOP.load(Ordering::SeqCst) {
            break;
        }
        if let Some(app_dir) = app_dir {
            consume_timeout_marker(db, app_dir);
        }
        if with_db(db, |conn| queue::is_paused(conn).unwrap_or(false)) {
            service_after_step(db, app);
            tokio::time::sleep(IDLE_SLEEP).await;
            continue;
        }
        match worker_step(db, app, app_dir, db_path).await {
            Ok(true) => service_after_step(db, app),
            Ok(false) => {
                service_after_step(db, app);
                tokio::time::sleep(IDLE_SLEEP).await;
            }
            Err(error) => {
                eprintln!("download worker: {error}");
                service_after_step(db, app);
                tokio::time::sleep(IDLE_SLEEP).await;
            }
        }
    }
}

/// Picks the oldest queued row, marks it `starting` and returns its cancel
/// token. The connection lock is dropped before the caller awaits.
fn claim_next(
    db: &Mutex<Connection>,
    app: Option<&AppHandle>,
) -> Result<Option<(DownloadTask, Arc<AtomicBool>)>, String> {
    let task = {
        let conn = db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(task) = queue::next_queued(&conn).map_err(|error| error.to_string())? else {
            return Ok(None);
        };
        let changed = queue::set_status(
            &conn,
            &task.id,
            "starting",
            Some(0.0),
            Some("Подготовка…"),
            None,
            None,
        )
        .map_err(|error| error.to_string())?;
        if changed == 0 {
            // A queued cancel deleted the row between `next_queued` and this
            // update. Do not download it; `download_queue_cancel` already
            // dropped its token.
            return Ok(None);
        }
        task
    };

    // A cancel may have arrived while the row was queued; the token is the
    // source of truth, not the row status.
    let token = cancel_token(&task.id);
    set_active_task(Some(&task.id));
    service_start(app, &task_title(&task));
    emit_progress(
        app,
        DownloadProgress {
            id: task.id.clone(),
            percent: 0.0,
            line: "Подготовка…".to_string(),
            status: "starting".to_string(),
            path: None,
            error: None,
        },
    );
    Ok(Some((task, token)))
}

/// Runs the oldest queued row once. Returns `false` when the queue is empty.
///
/// Kept separate from [`worker_loop`] so tests can drive a single step against
/// an in-memory database and a local HTTP server without a Tauri window.
async fn worker_step(
    db: &Mutex<Connection>,
    app: Option<&AppHandle>,
    app_dir: Option<&Path>,
    db_path: Option<&Path>,
) -> Result<bool, String> {
    let Some((task, token)) = claim_next(db, app)? else {
        return Ok(false);
    };

    if token.load(Ordering::Relaxed) {
        with_db(db, |conn| finish_cancelled(conn, app, &task));
        set_active_task(None);
        forget_cancel_token(&task.id);
        return Ok(true);
    }

    let downloading = with_db(db, |conn| {
        queue::set_status(
            conn,
            &task.id,
            "downloading",
            Some(0.0),
            Some("Скачивание…"),
            None,
            None,
        )
    });
    if let Err(error) = downloading {
        // Do not strand the row in `starting`: put it back in the queue (or
        // record the cancel if one arrived while we were marking it).
        if token.load(Ordering::Relaxed) {
            with_db(db, |conn| finish_cancelled(conn, app, &task));
        } else {
            let _ = with_db(db, |conn| {
                queue::set_status(conn, &task.id, "queued", Some(0.0), Some(""), None, None)
            });
        }
        forget_cancel_token(&task.id);
        set_active_task(None);
        return Err(error.to_string());
    }

    let result = dispatch(&task, app, Arc::clone(&token)).await;
    let cancelled = token.load(Ordering::Relaxed);

    match result {
        Ok(result) => {
            if cancelled {
                // A cancel racing the last chunk must never leave a `done` row
                // or a completed file behind.
                let _ = std::fs::remove_file(&result.path);
                with_db(db, |conn| finish_cancelled(conn, app, &task));
            } else {
                finish_done(db, app, app_dir, db_path, &task, &result);
            }
        }
        Err(error) => {
            with_db(db, |conn| {
                if cancelled {
                    finish_cancelled(conn, app, &task);
                } else {
                    finish_error(conn, app, &task, &error);
                }
            });
        }
    }

    forget_cancel_token(&task.id);
    set_active_task(None);
    Ok(true)
}

async fn dispatch(
    task: &DownloadTask,
    app: Option<&AppHandle>,
    cancel: Arc<AtomicBool>,
) -> Result<DownloadResult, String> {
    match task.kind.as_str() {
        "ytdlp" => {
            let app = app
                .ok_or_else(|| "Загрузка yt-dlp недоступна без приложения".to_string())?;
            crate::media::download_media(
                app,
                task.id.clone(),
                task.url.clone(),
                task.query.clone(),
                task.output_dir.clone(),
                None,
                task.expected_artist.clone(),
                task.expected_title.clone(),
                Some(cancel),
            )
            .await
        }
        _ => {
            crate::media::download_direct_impl(
                app,
                task.id.clone(),
                task.url.clone(),
                task.output_dir.clone(),
                task.file_name.clone(),
                task.expected_artist.clone(),
                task.expected_title.clone(),
                Some(cancel),
            )
            .await
        }
    }
}

fn finish_done(
    db: &Mutex<Connection>,
    app: Option<&AppHandle>,
    app_dir: Option<&Path>,
    db_path: Option<&Path>,
    task: &DownloadTask,
    result: &DownloadResult,
) {
    // A transient `SQLITE_BUSY` must not delete a finished file or record the
    // wrong status: retry the update, and on repeated failure keep the file and
    // leave the row `downloading` for the resume path.
    let mut changed = 0usize;
    let mut last_error = None;
    for attempt in 0..3 {
        match with_db(db, |conn| {
            queue::set_status(
                conn,
                &task.id,
                "done",
                Some(100.0),
                Some("Готово"),
                Some(&result.path),
                None,
            )
        }) {
            Ok(count) => {
                changed = count;
                last_error = None;
                break;
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < 2 {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }
    if let Some(error) = last_error {
        eprintln!(
            "download worker: cannot mark {} done: {error}; keeping {}",
            task.id, result.path
        );
        return;
    }
    if changed == 0 {
        // The row was removed by a queued-cancel race: do not record a phantom
        // history entry or announce completion, and do not leave the orphan file.
        let _ = std::fs::remove_file(&result.path);
        return;
    }

    let line = "Готово".to_string();
    if let Err(error) = with_db(db, |conn| {
        history::insert(
            conn,
            &DownloadHistoryItem {
                id: task.id.clone(),
                title: task_title(task),
                line: line.clone(),
                status: "done".to_string(),
                path: Some(result.path.clone()),
                error: None,
                finished_at: now_secs(),
            },
        )
    }) {
        // The file and queue row are still correct; history can be rebuilt from
        // the terminal row by Task 4 if this transient write failed.
        eprintln!(
            "download worker: cannot record history for {}: {error}",
            task.id
        );
    }

    emit_progress(
        app,
        DownloadProgress {
            id: task.id.clone(),
            percent: 100.0,
            line,
            status: "done".to_string(),
            path: Some(result.path.clone()),
            error: None,
        },
    );

    // Native scan on completion: make the output directory part of the library
    // and rescan it with a short-lived connection so a slow scan never blocks a
    // UI command on the worker connection. The foreground service is Task 3.
    if let (Some(app), Some(app_dir), Some(db_path)) = (app, app_dir, db_path) {
        match open_worker_connection(db_path) {
            Ok(scan_conn) => {
                let _ = scan_conn.execute(
                    "INSERT OR IGNORE INTO folders (path, recursive, added_at)
                     VALUES (?1, 1, ?2)",
                    params![result.directory, now_secs()],
                );
                if let Err(error) = crate::scanner::scan(app, &scan_conn, app_dir) {
                    eprintln!("download worker: scan failed: {error}");
                }
            }
            Err(error) => eprintln!("download worker: scan connection failed: {error}"),
        }
        let _ = app.emit(
            "download-complete",
            DownloadComplete {
                id: task.id.clone(),
                path: result.path.clone(),
            },
        );
    }
}

fn finish_error(conn: &Connection, app: Option<&AppHandle>, task: &DownloadTask, error: &str) {
    let changed = queue::set_status(
        conn,
        &task.id,
        "error",
        None,
        Some(error),
        None,
        Some(error),
    )
    .unwrap_or(0);
    if changed > 0 {
        let _ = history::insert(
            conn,
            &DownloadHistoryItem {
                id: task.id.clone(),
                title: task_title(task),
                line: error.to_string(),
                status: "error".to_string(),
                path: None,
                error: Some(error.to_string()),
                finished_at: now_secs(),
            },
        );
    }

    emit_progress(
        app,
        DownloadProgress {
            id: task.id.clone(),
            percent: 0.0,
            line: error.to_string(),
            status: "error".to_string(),
            path: None,
            error: Some(error.to_string()),
        },
    );
}

fn finish_cancelled(conn: &Connection, app: Option<&AppHandle>, task: &DownloadTask) {
    const CANCELLED: &str = "Загрузка отменена";

    let changed = queue::set_status(
        conn,
        &task.id,
        "cancelled",
        None,
        Some(CANCELLED),
        None,
        None,
    )
    .unwrap_or(0);
    if changed > 0 {
        let _ = history::insert(
            conn,
            &DownloadHistoryItem {
                id: task.id.clone(),
                title: task_title(task),
                line: CANCELLED.to_string(),
                status: "cancelled".to_string(),
                path: None,
                error: None,
                finished_at: now_secs(),
            },
        );
    }

    // `cancelled` is terminal for the UI, which drops the row and refreshes
    // history instead of keeping an "error" row in the active list.
    emit_progress(
        app,
        DownloadProgress {
            id: task.id.clone(),
            percent: 0.0,
            line: CANCELLED.to_string(),
            status: "cancelled".to_string(),
            path: None,
            error: Some(CANCELLED.to_string()),
        },
    );
}

/// Human-readable queue/history title, also used for the foreground
/// notification before the worker claims the row.
pub(crate) fn task_title(task: &DownloadTask) -> String {
    task.title
        .clone()
        .or_else(|| task.query.clone())
        .or_else(|| task.file_name.clone())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| task.url.clone())
}

fn emit_progress(app: Option<&AppHandle>, progress: DownloadProgress) {
    if let Some(app) = app {
        #[cfg(target_os = "android")]
        if is_active_download(&progress.id) {
            service_update(Some(app), progress.percent, &progress.status);
        }
        let _ = app.emit("download-progress", progress);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn task(id: &str, url: &str) -> DownloadTask {
        DownloadTask {
            id: id.to_string(),
            kind: "ytdlp".to_string(),
            url: url.to_string(),
            query: Some(format!("query {id}")),
            output_dir: "Downloads".to_string(),
            file_name: None,
            expected_artist: None,
            expected_title: None,
            title: Some(format!("title {id}")),
        }
    }

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::apply_schema(&conn).unwrap();
        conn
    }

    fn history_item(id: &str, status: &str, finished_at: i64) -> DownloadHistoryItem {
        DownloadHistoryItem {
            id: id.to_string(),
            title: format!("title {id}"),
            line: String::new(),
            status: status.to_string(),
            path: None,
            error: None,
            finished_at,
        }
    }

    #[test]
    fn enqueue_list_and_move() {
        let conn = conn();
        let id = queue::enqueue(&conn, &task("a", "https://example/a.mp3")).unwrap();
        queue::enqueue(&conn, &task("b", "https://example/b.mp3")).unwrap();
        assert_eq!(queue::ids(&conn).unwrap(), vec![id.clone(), "b".into()]);
        queue::move_item(&conn, &id, 1).unwrap();
        assert_eq!(queue::ids(&conn).unwrap(), vec!["b".into(), id]);
    }

    #[test]
    fn enqueue_appends_after_existing_rows() {
        let conn = conn();
        queue::enqueue(&conn, &task("a", "https://example/a.mp3")).unwrap();
        queue::enqueue(&conn, &task("b", "https://example/b.mp3")).unwrap();
        queue::enqueue(&conn, &task("c", "https://example/c.mp3")).unwrap();

        assert_eq!(
            queue::ids(&conn).unwrap(),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );

        // Moving past the edges is a no-op, not an error.
        queue::move_item(&conn, "a", -1).unwrap();
        queue::move_item(&conn, "c", 1).unwrap();
        assert_eq!(
            queue::ids(&conn).unwrap(),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn clear_finished_keeps_active_rows() {
        let conn = conn();
        queue::enqueue(&conn, &task("queued", "https://example/q.mp3")).unwrap();
        queue::enqueue(&conn, &task("done", "https://example/d.mp3")).unwrap();
        queue::enqueue(&conn, &task("error", "https://example/e.mp3")).unwrap();
        queue::enqueue(&conn, &task("cancelled", "https://example/c.mp3")).unwrap();
        for (id, status) in [
            ("done", "done"),
            ("error", "error"),
            ("cancelled", "cancelled"),
        ] {
            queue::set_status(&conn, id, status, None, None, None, None).unwrap();
        }

        assert_eq!(queue::clear_finished(&conn).unwrap(), 3);
        assert_eq!(queue::ids(&conn).unwrap(), vec!["queued".to_string()]);
    }

    #[test]
    fn list_returns_queue_rows_with_order_and_metadata() {
        let conn = conn();
        queue::enqueue(&conn, &task("a", "https://example/a.mp3")).unwrap();
        queue::enqueue(&conn, &task("b", "https://example/b.mp3")).unwrap();
        let mut direct = task("c", "https://example/c.mp3");
        direct.kind = "direct".to_string();
        direct.title = Some("direct title".to_string());
        queue::enqueue(&conn, &direct).unwrap();
        queue::set_status(
            &conn,
            "b",
            "downloading",
            Some(42.5),
            Some("[download] 42.5%"),
            None,
            None,
        )
        .unwrap();

        let items = queue::list(&conn).unwrap();
        assert_eq!(items.len(), 3);

        assert_eq!(items[0].id, "a");
        assert_eq!(items[0].kind, "ytdlp");
        assert_eq!(items[0].title.as_deref(), Some("title a"));
        assert_eq!(items[0].status, "queued");
        assert_eq!(items[0].percent, 0.0);
        assert_eq!(items[0].order_index, 0);
        assert!(items[0].cancellable);

        assert_eq!(items[1].id, "b");
        assert_eq!(items[1].status, "downloading");
        assert_eq!(items[1].percent, 42.5);
        assert_eq!(items[1].line, "[download] 42.5%");
        assert_eq!(items[1].order_index, 1);

        assert_eq!(items[2].id, "c");
        assert_eq!(items[2].kind, "direct");
        assert_eq!(items[2].title.as_deref(), Some("direct title"));
        assert_eq!(items[2].order_index, 2);
        assert!(items[2].cancellable);
    }

    #[test]
    fn cancel_removes_only_queued_rows_and_reports_result() {
        let conn = conn();
        queue::enqueue(&conn, &task("a", "https://example/a.mp3")).unwrap();
        queue::enqueue(&conn, &task("b", "https://example/b.mp3")).unwrap();

        assert!(queue::cancel_queued(&conn, "a").unwrap());
        assert_eq!(queue::ids(&conn).unwrap(), vec!["b".to_string()]);

        assert!(!queue::cancel_queued(&conn, "a").unwrap());
        assert!(!queue::cancel_queued(&conn, "missing").unwrap());

        let items = queue::list(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "b");
    }

    #[test]
    fn resume_except_keeps_the_live_worker_row_downloading() {
        let conn = conn();
        queue::enqueue(&conn, &task("live", "https://example/live.mp3")).unwrap();
        queue::enqueue(&conn, &task("dead", "https://example/dead.mp3")).unwrap();
        queue::set_status(&conn, "live", "downloading", Some(10.0), None, None, None)
            .unwrap();
        queue::set_status(&conn, "dead", "starting", Some(0.0), None, None, None).unwrap();

        assert_eq!(queue::resume_except(&conn, Some("live")).unwrap(), 1);
        let rows = queue::list(&conn).unwrap();
        assert_eq!(rows[0].id, "live");
        assert_eq!(rows[0].status, "downloading");
        assert_eq!(rows[0].percent, 10.0);
        assert_eq!(rows[1].id, "dead");
        assert_eq!(rows[1].status, "queued");
    }

    #[test]
    fn resume_requeues_interrupted_rows_and_clears_progress() {
        let conn = conn();
        queue::enqueue(&conn, &task("starting", "https://example/1.mp3")).unwrap();
        queue::enqueue(&conn, &task("downloading", "https://example/2.mp3")).unwrap();
        queue::enqueue(&conn, &task("queued", "https://example/3.mp3")).unwrap();
        queue::enqueue(&conn, &task("done", "https://example/4.mp3")).unwrap();

        queue::set_status(
            &conn,
            "starting",
            "starting",
            Some(0.0),
            Some("starting yt-dlp"),
            None,
            None,
        )
        .unwrap();
        queue::set_status(
            &conn,
            "downloading",
            "downloading",
            Some(66.0),
            Some("[download] 66%"),
            Some("Downloads/partial.mp3"),
            Some("temporary"),
        )
        .unwrap();
        queue::set_status(
            &conn,
            "done",
            "done",
            Some(100.0),
            Some("[download] 100%"),
            Some("Downloads/a.mp3"),
            None,
        )
        .unwrap();

        assert_eq!(queue::resume(&conn).unwrap(), 2);

        let items = queue::list(&conn).unwrap();
        let by_id = |id: &str| items.iter().find(|item| item.id == id).unwrap();

        let starting = by_id("starting");
        assert_eq!(starting.status, "queued");
        assert_eq!(starting.percent, 0.0);
        assert!(starting.line.is_empty());
        assert!(starting.error.is_none());

        let downloading = by_id("downloading");
        assert_eq!(downloading.status, "queued");
        assert_eq!(downloading.percent, 0.0);
        assert!(downloading.line.is_empty());
        assert!(downloading.path.is_none());
        assert!(downloading.error.is_none());

        assert_eq!(by_id("queued").status, "queued");
        assert_eq!(by_id("done").status, "done");
        assert_eq!(by_id("done").percent, 100.0);
    }

    #[test]
    fn counts_active_and_queued_rows() {
        let conn = conn();
        assert_eq!(queue::counts(&conn).unwrap(), (0, 0));

        queue::enqueue(&conn, &task("queued", "https://example/q.mp3")).unwrap();
        queue::enqueue(&conn, &task("starting", "https://example/s.mp3")).unwrap();
        queue::enqueue(&conn, &task("downloading", "https://example/d.mp3")).unwrap();
        queue::set_status(&conn, "starting", "starting", None, None, None, None).unwrap();
        queue::set_status(&conn, "downloading", "downloading", None, None, None, None).unwrap();

        assert_eq!(queue::counts(&conn).unwrap(), (2, 1));

        queue::set_status(&conn, "starting", "done", Some(100.0), None, None, None).unwrap();
        assert_eq!(queue::counts(&conn).unwrap(), (1, 1));
    }

    #[test]
    fn pause_flag_round_trips_through_settings() {
        let conn = conn();
        assert!(!queue::is_paused(&conn).unwrap());
        queue::set_paused(&conn, true).unwrap();
        assert!(queue::is_paused(&conn).unwrap());
        queue::set_paused(&conn, false).unwrap();
        assert!(!queue::is_paused(&conn).unwrap());
    }

    #[test]
    fn history_insert_list_and_clear() {
        let conn = conn();
        assert!(history::list(&conn).unwrap().is_empty());

        history::insert(&conn, &history_item("old", "done", 100)).unwrap();
        history::insert(&conn, &history_item("new", "error", 200)).unwrap();

        let items = history::list(&conn).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "new");
        assert_eq!(items[0].status, "error");
        assert_eq!(items[0].finished_at, 200);
        assert_eq!(items[1].id, "old");

        assert_eq!(history::clear(&conn).unwrap(), 2);
        assert!(history::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn history_replaces_duplicate_ids_and_prunes_to_limit() {
        let conn = conn();
        history::insert(&conn, &history_item("same", "error", 10)).unwrap();
        let mut retry = history_item("same", "done", 20);
        retry.title = "retried".to_string();
        history::insert(&conn, &retry).unwrap();

        let items = history::list(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].status, "done");
        assert_eq!(items[0].title, "retried");

        for index in 0..(HISTORY_LIMIT + 5) {
            history::insert(
                &conn,
                &history_item(&format!("bulk-{index}"), "done", 1000 + index),
            )
            .unwrap();
        }

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM download_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, HISTORY_LIMIT);

        let items = history::list(&conn).unwrap();
        assert_eq!(items.len() as i64, HISTORY_LIMIT);
        assert_eq!(items[0].id, format!("bulk-{}", HISTORY_LIMIT + 4));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nova-worker-{name}-{}-{}",
            std::process::id(),
            crate::db::now_millis()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_request(stream: &mut TcpStream) {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .ok();
        let mut buffer = [0u8; 1024];
        let mut received = Vec::new();
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    received.extend_from_slice(&buffer[..count]);
                    if received.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }

    /// Serves one request and closes the connection.
    fn serve_once(content_type: &'static str, body: Vec<u8>) -> String {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                read_request(&mut stream);
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        });
        format!("http://{address}")
    }

    /// Sends a large body slowly so a test can cancel mid-stream.
    fn serve_slowly(chunk_size: usize, chunks: usize) -> String {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                read_request(&mut stream);
                let total = chunk_size * chunks;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(header.as_bytes());
                let chunk = vec![0u8; chunk_size];
                for _ in 0..chunks {
                    if stream.write_all(&chunk).is_err() || stream.flush().is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        });
        format!("http://{address}")
    }

    fn direct_task(id: &str, url: &str, directory: &Path) -> DownloadTask {
        let mut task = task(id, url);
        task.kind = "direct".to_string();
        task.query = None;
        task.output_dir = directory.to_string_lossy().to_string();
        task.title = Some(format!("title {id}"));
        task
    }

    #[test]
    fn worker_downloads_direct_task_and_records_done() {
        let db = Mutex::new(conn());
        let directory = temp_dir("direct-done");
        let base = serve_once("audio/mpeg", b"ID3-test-body".to_vec());
        let queued = direct_task("direct-1", &format!("{base}/track.mp3"), &directory);
        {
            let conn = db.lock().unwrap();
            queue::enqueue(&conn, &queued).unwrap();
        }

        let processed = tauri::async_runtime::block_on(worker_step(&db, None, None, None))
            .expect("worker step");
        assert!(processed);

        let conn = db.lock().unwrap();
        let rows = queue::list(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "done");
        assert_eq!(rows[0].percent, 100.0);
        let path = rows[0].path.clone().expect("path");
        assert!(Path::new(&path).is_file());
        assert_eq!(fs::read(&path).unwrap(), b"ID3-test-body");

        let history = history::list(&conn).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "direct-1");
        assert_eq!(history[0].status, "done");
        assert_eq!(history[0].path.as_deref(), Some(path.as_str()));
        drop(conn);

        // Nothing left to do: the next step reports an empty queue.
        let processed = tauri::async_runtime::block_on(worker_step(&db, None, None, None))
            .expect("empty worker step");
        assert!(!processed);

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn worker_marks_pre_cancelled_task_without_touching_files() {
        let db = Mutex::new(conn());
        let directory = temp_dir("pre-cancel");
        let queued = direct_task("cancel-1", "http://127.0.0.1:9/track.mp3", &directory);
        {
            let conn = db.lock().unwrap();
            queue::enqueue(&conn, &queued).unwrap();
        }

        cancel_token("cancel-1").store(true, Ordering::SeqCst);
        let processed = tauri::async_runtime::block_on(worker_step(&db, None, None, None))
            .expect("worker step");
        assert!(processed);

        let conn = db.lock().unwrap();
        let rows = queue::list(&conn).unwrap();
        assert_eq!(rows[0].status, "cancelled");
        assert!(rows[0].path.is_none());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);

        let history = history::list(&conn).unwrap();
        assert_eq!(history[0].status, "cancelled");
        assert!(history[0].path.is_none());
        drop(conn);

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn direct_download_cancel_stops_stream_and_removes_partial_file() {
        let directory = temp_dir("cancel-stream");
        let bystander = directory.join("bystander.mp3");
        fs::write(&bystander, b"other job").unwrap();

        let base = serve_slowly(64 * 1024, 128);
        let token = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&token);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            flag.store(true, Ordering::SeqCst);
        });

        let result = tauri::async_runtime::block_on(crate::media::download_direct_impl(
            None,
            "cancel-stream".to_string(),
            format!("{base}/big.mp3"),
            directory.to_string_lossy().to_string(),
            None,
            None,
            None,
            Some(token),
        ));
        assert!(result.is_err(), "cancelled download must not succeed");

        let names: Vec<String> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["bystander.mp3".to_string()]);
        assert!(
            !names.iter().any(|name| name.starts_with(".nova-part")),
            "temp file must be removed on cancel: {names:?}"
        );
        assert_eq!(fs::read(&bystander).unwrap(), b"other job");

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn direct_download_removes_stale_partial_and_writes_single_final_file() {
        let directory = temp_dir("stale-part");
        // Simulates a killed attempt: the same id resumes and must not leave the
        // old temp behind or create `track (1).mp3` because of it.
        let stale = directory.join(".nova-part-stale-1");
        fs::write(&stale, b"dead partial").unwrap();
        let base = serve_once("audio/mpeg", b"fresh-body".to_vec());

        let result = tauri::async_runtime::block_on(crate::media::download_direct_impl(
            None,
            "stale-1".to_string(),
            format!("{base}/track.mp3"),
            directory.to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        ))
        .expect("download");
        assert_eq!(fs::read(&result.path).unwrap(), b"fresh-body");
        assert_eq!(
            Path::new(&result.path).file_name().unwrap().to_string_lossy(),
            "track.mp3"
        );
        assert!(!stale.exists(), "stale .nova-part must be deleted");

        let names: Vec<String> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["track.mp3".to_string()]);

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn cancel_queued_does_not_delete_a_row_the_worker_claimed() {
        let conn = conn();
        queue::enqueue(&conn, &task("queued", "https://example/q.mp3")).unwrap();
        queue::enqueue(&conn, &task("active", "https://example/a.mp3")).unwrap();
        queue::set_status(&conn, "active", "starting", None, None, None, None).unwrap();

        assert!(queue::cancel_queued(&conn, "queued").unwrap());
        assert!(!queue::cancel_queued(&conn, "active").unwrap());
        assert_eq!(queue::ids(&conn).unwrap(), vec!["active".to_string()]);
    }

    #[test]
    fn forgotten_cancel_token_does_not_kill_a_retry() {
        let first = cancel_token("retry-1");
        first.store(true, Ordering::SeqCst);
        forget_cancel_token("retry-1");

        let retry = cancel_token("retry-1");
        assert!(!retry.load(Ordering::SeqCst));
        assert!(!Arc::ptr_eq(&first, &retry));
        forget_cancel_token("retry-1");
    }

    #[test]
    fn worker_does_not_run_a_row_deleted_by_queued_cancel() {
        let db = Mutex::new(conn());
        let directory = temp_dir("queued-cancel");
        let queued = direct_task("queued-cancel-1", "http://127.0.0.1:9/track.mp3", &directory);
        {
            let conn = db.lock().unwrap();
            queue::enqueue(&conn, &queued).unwrap();
        }

        // Mirrors `download_queue_cancel` for a queued row: signal, delete, and
        // drop the token so a retry with the same id starts clean.
        cancel_token("queued-cancel-1").store(true, Ordering::SeqCst);
        {
            let conn = db.lock().unwrap();
            assert!(queue::cancel_queued(&conn, "queued-cancel-1").unwrap());
            assert!(queue::list(&conn).unwrap().is_empty());
        }
        forget_cancel_token("queued-cancel-1");

        let processed = tauri::async_runtime::block_on(worker_step(&db, None, None, None))
            .expect("worker step");
        assert!(!processed);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);

        let _ = fs::remove_dir_all(&directory);
    }
}
