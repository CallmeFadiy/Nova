//! Persistent download queue and history.
//!
//! All SQL lives here. Tauri commands in `commands.rs` only take the app DB
//! mutex and delegate, so the same helpers are unit-tested against an in-memory
//! SQLite database without a running app.

use crate::db::now_secs;
use crate::models::{DownloadHistoryItem, DownloadQueueRow, DownloadTask};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::atomic::{AtomicU64, Ordering};

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
            let kind: String = row.get(1)?;
            Ok(DownloadQueueRow {
                id: row.get(0)?,
                kind: kind.clone(),
                title: row.get(2)?,
                percent: row.get(3)?,
                line: row.get(4)?,
                status: row.get(5)?,
                path: row.get(6)?,
                error: row.get(7)?,
                order_index: row.get(8)?,
                // Mirrors the JS rule: only yt-dlp runs can be stopped by the
                // Android plugin; direct HTTP downloads cannot.
                cancellable: kind == "ytdlp",
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

    /// Updates worker-owned columns. `None` keeps the stored value for percent,
    /// line and path; `error` is always written so a retry can clear it.
    /// Used by the native worker in Task 2.
    #[allow(dead_code)]
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
                    WHEN ?2 IN ('done', 'error') THEN COALESCE(finished_at, ?7)
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

    /// Read by the worker in Task 4 before it picks the next row.
    #[allow(dead_code)]
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

    /// Removes a row that has not finished. Returns whether a row was removed.
    pub fn cancel(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
        let removed = conn.execute(
            "DELETE FROM download_queue
             WHERE id = ?1 AND status IN ('queued', 'starting', 'downloading')",
            params![id],
        )?;
        Ok(removed > 0)
    }

    /// Re-queues rows a previous process left mid-flight. Called on startup.
    pub fn resume(conn: &Connection) -> rusqlite::Result<usize> {
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
            "#,
            params![now_secs()],
        )
    }
}

pub mod history {
    use super::*;

    /// Records a finished download. A retry replaces the earlier entry with the
    /// same download id so history shows one row per task. Called by the worker
    /// in Task 2.
    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
        assert!(!items[2].cancellable);
    }

    #[test]
    fn cancel_removes_only_queued_rows_and_reports_result() {
        let conn = conn();
        queue::enqueue(&conn, &task("a", "https://example/a.mp3")).unwrap();
        queue::enqueue(&conn, &task("b", "https://example/b.mp3")).unwrap();

        assert!(queue::cancel(&conn, "a").unwrap());
        assert_eq!(queue::ids(&conn).unwrap(), vec!["b".to_string()]);

        assert!(!queue::cancel(&conn, "a").unwrap());
        assert!(!queue::cancel(&conn, "missing").unwrap());

        let items = queue::list(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "b");
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
}
