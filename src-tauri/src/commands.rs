use crate::models::{
    DeleteTracksResult, DownloadHistoryItem, DownloadProgress, DownloadResult, DownloadTask, Folder,
    ImportPlaylist, LyricsFile, LyricsResult, MediaCandidate, Playlist, RecognitionResult,
    ScanResult, Snapshot, TagEncodingIssue, TagEncodingResult, Track, TrackHash,
};
use crate::text_encoding::repair_mojibake;
use crate::{lyrics, media, recognition, scanner, AppState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

pub fn snapshot(conn: &Connection) -> Result<Snapshot, String> {
    Ok(Snapshot {
        tracks: read_tracks(conn).map_err(|e| e.to_string())?,
        playlists: read_playlists(conn).map_err(|e| e.to_string())?,
        folders: read_folders(conn).map_err(|e| e.to_string())?,
    })
}

fn read_tracks(conn: &Connection) -> rusqlite::Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            t.id, t.path, t.folder_id, t.filename, t.title, t.artist, t.album,
            t.album_artist, t.duration_ms, t.track_no, t.year, t.genre,
            t.cover_path, t.custom_cover_path, t.format, t.size, t.added_at,
            (f.track_id IS NOT NULL) AS favorite,
            (h.track_id IS NOT NULL) AS hidden,
            t.missing,
            t.group_key_override,
            t.group_name_override
        FROM tracks t
        LEFT JOIN favorites f ON f.track_id = t.id
        LEFT JOIN hidden_tracks h ON h.track_id = t.id
        ORDER BY t.added_at DESC, t.title COLLATE NOCASE
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(Track {
            id: row.get(0)?,
            path: row.get(1)?,
            folder_id: row.get(2)?,
            filename: row.get(3)?,
            title: row.get(4)?,
            artist: row.get(5)?,
            album: row.get(6)?,
            album_artist: row.get(7)?,
            duration_ms: row.get(8)?,
            track_no: row.get(9)?,
            year: row.get(10)?,
            genre: row.get(11)?,
            cover_path: row.get(12)?,
            custom_cover_path: row.get(13)?,
            format: row.get(14)?,
            size: row.get(15)?,
            added_at: row.get(16)?,
            favorite: row.get::<_, i64>(17)? != 0,
            hidden: row.get::<_, i64>(18)? != 0,
            missing: row.get::<_, i64>(19)? != 0,
            group_key_override: row.get(20)?,
            group_name_override: row.get(21)?,
        })
    })?;

    rows.collect()
}

fn read_playlists(conn: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at FROM playlists ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;

    let mut playlists = Vec::new();
    for row in rows {
        let (id, name, created_at, updated_at) = row?;
        let mut item_stmt = conn.prepare(
            "SELECT track_id FROM playlist_items WHERE playlist_id = ?1 ORDER BY position ASC, added_at ASC",
        )?;
        let track_ids = item_stmt
            .query_map(params![id], |item| item.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        playlists.push(Playlist {
            id,
            name,
            track_ids,
            created_at,
            updated_at,
        });
    }
    Ok(playlists)
}

fn read_folders(conn: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, recursive, added_at, last_scan_at FROM folders ORDER BY added_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            path: row.get(1)?,
            recursive: row.get::<_, i64>(2)? != 0,
            added_at: row.get(3)?,
            last_scan_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[cfg(target_os = "android")]
fn run_mobile_command<T, P>(app: &AppHandle, command: &str, payload: P) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    P: Serialize,
{
    let state = app.state::<tauri_plugin_nova_mobile::NovaMobile<tauri::Wry>>();
    state
        .0
        .run_mobile_plugin(command, payload)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn run_download_command<T, P>(app: &AppHandle, command: &str, payload: P) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    P: Serialize,
{
    let state = app.state::<tauri_plugin_nova_mobile::NovaDownloads<tauri::Wry>>();
    state
        .0
        .run_mobile_plugin(command, payload)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
async fn run_download_command_async<T, P>(
    app: &AppHandle,
    command: &str,
    payload: P,
) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    P: Serialize,
{
    let handle = app
        .state::<tauri_plugin_nova_mobile::NovaDownloads<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn android_permission_state(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let value: serde_json::Value = run_mobile_command(&app, "hasAllFilesAccess", ())?;
        return Ok(
            if value
                .get("granted")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
            {
                "granted".to_string()
            } else {
                "denied".to_string()
            },
        );
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok("granted".to_string())
    }
}

#[tauri::command]
pub fn android_open_all_files_settings(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(&app, "openAllFilesSettings", ())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}

#[tauri::command]
pub fn android_request_notifications(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(&app, "requestNotifications", ())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}

#[tauri::command]
pub fn android_minimize_app(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(&app, "minimizeApp", ())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn mobile_pick_path(app: &AppHandle, command: &str) -> Result<Option<String>, String> {
    #[derive(serde::Deserialize)]
    struct PickPathResult {
        #[serde(default)]
        path: Option<String>,
    }

    let result: PickPathResult = run_mobile_command(app, command, ())?;
    Ok(result.path)
}

#[tauri::command]
pub fn android_pick_image(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return mobile_pick_path(&app, "pickImage");
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
pub fn android_pick_audio(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return mobile_pick_path(&app, "pickAudio");
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
pub fn android_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return mobile_pick_path(&app, "pickFolder");
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioItem {
    pub id: i64,
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_path: Option<String>,
    pub duration_ms: i64,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioQueuePayload {
    items: Vec<NativeAudioItem>,
    start_index: usize,
    position_ms: i64,
    autoplay: bool,
    repeat: String,
}

#[tauri::command]
pub fn android_audio_set_queue(
    app: AppHandle,
    items: Vec<NativeAudioItem>,
    start_index: usize,
    position_ms: i64,
    autoplay: bool,
    repeat: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(
            &app,
            "audioSetQueue",
            AudioQueuePayload {
                items,
                start_index,
                position_ms,
                autoplay,
                repeat,
            },
        )?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, items, start_index, position_ms, autoplay, repeat);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_play(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(&app, "audioPlay", ())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_pause(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = run_mobile_command(&app, "audioPause", ())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_seek(app: AppHandle, position_ms: i64) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Payload {
            position_ms: i64,
        }
        let _: serde_json::Value = run_mobile_command(&app, "audioSeek", Payload { position_ms })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, position_ms);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_set_volume(app: AppHandle, value: f64) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            value: f64,
        }
        let _: serde_json::Value = run_mobile_command(&app, "audioSetVolume", Payload { value })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, value);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_set_muted(app: AppHandle, muted: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            muted: bool,
        }
        let _: serde_json::Value = run_mobile_command(&app, "audioSetMuted", Payload { muted })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, muted);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_set_repeat(app: AppHandle, mode: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            mode: String,
        }
        let _: serde_json::Value = run_mobile_command(&app, "audioSetRepeat", Payload { mode })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, mode);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_set_eq(
    app: AppHandle,
    enabled: bool,
    bands: Vec<f64>,
    preamp: f64,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            enabled: bool,
            bands: Vec<f64>,
            preamp: f64,
        }
        let _: serde_json::Value = run_mobile_command(
            &app,
            "audioSetEq",
            Payload {
                enabled,
                bands,
                preamp,
            },
        )?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, enabled, bands, preamp);
    }
    Ok(())
}

#[tauri::command]
pub fn android_audio_state(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_mobile_command(&app, "audioState", ());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::json!({
            "currentIndex": -1,
            "positionMs": 0,
            "durationMs": 0,
            "isPlaying": false,
            "ended": false,
        }))
    }
}


#[tauri::command]
pub fn android_download_probe(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            url: String,
        }
        return run_download_command(&app, "downloadProbe", Payload { url });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Err("Встроенный yt-dlp доступен только на Android".to_string())
    }
}

#[tauri::command]
pub async fn android_download_info(app: AppHandle, url: String) -> Result<ImportPlaylist, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            url: String,
        }
        return run_download_command_async(&app, "downloadInfo", Payload { url }).await;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Err("Встроенный yt-dlp доступен только на Android".to_string())
    }
}

#[tauri::command]
pub async fn android_download_start(
    app: AppHandle,
    id: String,
    url: String,
    output_dir: String,
    query: Option<String>,
) -> Result<DownloadResult, String> {
    #[cfg(target_os = "android")]
    {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        #[derive(Serialize)]
        struct Payload<'a> {
            id: &'a str,
            url: &'a str,
            #[serde(rename = "outputDir")]
            output_dir: &'a str,
            query: &'a str,
        }

        let query = query.unwrap_or_default();
        let stop = Arc::new(AtomicBool::new(false));
        let poll_app = app.clone();
        let poll_id = id.clone();
        let poll_stop = Arc::clone(&stop);
        let poller = tauri::async_runtime::spawn_blocking(move || {
            let mut last = String::new();
            loop {
                let running = !poll_stop.load(Ordering::Relaxed);
                forward_mobile_progress(&poll_app, &poll_id, &mut last);
                if !running {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });

        let result = run_download_command_async(
            &app,
            "downloadStart",
            Payload {
                id: &id,
                url: &url,
                output_dir: &output_dir,
                query: &query,
            },
        )
        .await;

        stop.store(true, Ordering::Relaxed);
        let _ = poller.await;
        result
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, id, url, output_dir, query);
        Err("Встроенный yt-dlp доступен только на Android".to_string())
    }
}

#[tauri::command]
pub fn android_download_cancel(app: AppHandle, id: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct Payload {
            id: String,
        }
        let value: serde_json::Value =
            run_download_command(&app, "downloadCancel", Payload { id })?;
        return Ok(value
            .get("cancelled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, id);
        Err("Встроенный yt-dlp доступен только на Android".to_string())
    }
}

/// Persistent queue/history commands.
///
/// These only take the app DB mutex around the SQL call. The worker and the
/// progress listener live outside this layer (Tasks 2-4).
#[tauri::command]
pub fn download_queue_list(state: State<'_, AppState>) -> Result<Vec<DownloadProgress>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_history_list(
    state: State<'_, AppState>,
) -> Result<Vec<DownloadHistoryItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::history::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_enqueue(state: State<'_, AppState>, task: DownloadTask) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::enqueue(&conn, &task).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_queue_pause(state: State<'_, AppState>, paused: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::set_paused(&conn, paused).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_queue_cancel(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::cancel(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_queue_move(
    state: State<'_, AppState>,
    id: String,
    direction: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::move_item(&conn, &id, direction).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_history_clear(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::history::clear(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

/// Called once on startup by Task 4. Rows a killed process left in
/// `starting`/`downloading` go back to `queued` with their progress cleared.
#[tauri::command]
pub fn download_queue_resume(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::downloads::queue::resume(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

/// Forwards the embedded yt-dlp progress snapshot to the webview as the regular
/// `download-progress` event. The Kotlin plugin also calls `trigger`, but plugin
/// events need `addPluginListener` and the second Tauri plugin (`nova-download`)
/// has no generated ACL manifest, so the Rust poller is what the JS listener sees.
#[cfg(target_os = "android")]
fn forward_mobile_progress(app: &AppHandle, id: &str, last: &mut String) {
    use tauri::Emitter as _;

    #[derive(Serialize)]
    struct Payload<'a> {
        id: &'a str,
    }

    let Ok(value): Result<serde_json::Value, String> =
        run_download_command(app, "downloadState", Payload { id })
    else {
        return;
    };
    if value.get("status").and_then(|value| value.as_str()) == Some("idle") {
        return;
    }
    let signature = serde_json::to_string(&value).unwrap_or_default();
    if signature == *last {
        return;
    }
    *last = signature;
    let _ = app.emit("download-progress", value);
}

#[tauri::command]
pub fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    scanner::scan(&app, &conn, &state.app_dir)
}

#[tauri::command]
pub fn add_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Snapshot, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_dir() {
        return Err("Папка не найдена".to_string());
    }
    let normalized = dunce::canonicalize(&source).unwrap_or(source);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO folders (path, recursive, added_at) VALUES (?1, 1, ?2)",
        params![
            normalized.to_string_lossy().to_string(),
            crate::db::now_secs()
        ],
    )
    .map_err(|e| e.to_string())?;
    let _ = app
        .asset_protocol_scope()
        .allow_directory(&normalized, true);
    snapshot(&conn)
}

#[tauri::command]
pub fn remove_folder(state: State<'_, AppState>, id: i64) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn create_playlist(state: State<'_, AppState>, name: String) -> Result<Snapshot, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Название плейлиста не может быть пустым".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = crate::db::now_secs();
    conn.execute(
        "INSERT INTO playlists (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![name, now],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn rename_playlist(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<Snapshot, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Название плейлиста не может быть пустым".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, crate::db::now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn delete_playlist(state: State<'_, AppState>, id: i64) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn add_to_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let now = crate::db::now_secs();
    for track_id in track_ids {
        let position: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_items WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO playlist_items (playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, track_id, position, now],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
        params![now, playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn remove_from_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_id: i64,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
        params![crate::db::now_secs(), playlist_id],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn reorder_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (position, track_id) in track_ids.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_items SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![position as i64, playlist_id, track_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
        params![crate::db::now_secs(), playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, AppState>, track_id: i64) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT track_id FROM favorites WHERE track_id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_some() {
        conn.execute(
            "DELETE FROM favorites WHERE track_id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT OR IGNORE INTO favorites (track_id, added_at) VALUES (?1, ?2)",
            params![track_id, crate::db::now_secs()],
        )
        .map_err(|e| e.to_string())?;
    }
    snapshot(&conn)
}

#[tauri::command]
pub fn hide_track(state: State<'_, AppState>, track_id: i64) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO hidden_tracks (track_id, hidden_at, reason) VALUES (?1, ?2, 'album')",
        params![track_id, crate::db::now_secs()],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn restore_track(state: State<'_, AppState>, track_id: i64) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM hidden_tracks WHERE track_id = ?1",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn set_track_cover(
    state: State<'_, AppState>,
    track_id: i64,
    source_path: String,
) -> Result<Snapshot, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Файл обложки не найден".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let dest = state
        .app_dir
        .join("covers")
        .join("custom")
        .join(format!("{}.{}", track_id, extension));
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET custom_cover_path = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            dest.to_string_lossy().to_string(),
            crate::db::now_secs(),
            track_id
        ],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn clear_track_cover(
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let old: Option<String> = conn
        .query_row(
            "SELECT custom_cover_path FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    if let Some(path) = old {
        let _ = fs::remove_file(path);
    }
    conn.execute(
        "UPDATE tracks SET custom_cover_path = NULL, updated_at = ?1 WHERE id = ?2",
        params![crate::db::now_secs(), track_id],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn update_track_metadata(
    state: State<'_, AppState>,
    track_id: i64,
    title: String,
    artist: String,
    album: Option<String>,
    album_artist: Option<String>,
) -> Result<Snapshot, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() {
        return Err("Название трека не может быть пустым".to_string());
    }
    if artist.is_empty() {
        return Err("Исполнитель не может быть пустым".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current: Option<(String, String)> = conn
        .query_row(
            "SELECT album, album_artist FROM tracks WHERE id = ?1",
            params![track_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (old_album, old_album_artist) =
        current.ok_or_else(|| "Трек не найден".to_string())?;
    let album = album
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&old_album)
        .to_string();
    let album_artist = album_artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&old_album_artist)
        .to_string();
    conn.execute(
        "UPDATE tracks SET title = ?1, artist = ?2, album = ?3, album_artist = ?4, updated_at = ?5 WHERE id = ?6",
        params![title, artist, album, album_artist, crate::db::now_secs(), track_id],
    )
    .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn delete_track(
    state: State<'_, AppState>,
    track_id: i64,
    delete_file: bool,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Err("Трек не найден".to_string());
    };
    if delete_file {
        let file = std::path::Path::new(&path);
        if file.exists() {
            fs::remove_file(file)
                .map_err(|error| format!("Не удалось удалить файл: {error}"))?;
        }
    }
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])
        .map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn delete_tracks(
    state: State<'_, AppState>,
    track_ids: Vec<i64>,
    delete_files: bool,
) -> Result<DeleteTracksResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut deleted = 0usize;
    let mut failed = Vec::new();
    for track_id in track_ids {
        let path: Option<String> = conn
            .query_row(
                "SELECT path FROM tracks WHERE id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(path) = path else {
            continue;
        };
        if delete_files {
            let file = std::path::Path::new(&path);
            if file.exists() {
                if let Err(error) = fs::remove_file(file) {
                    failed.push(format!("{path}: {error}"));
                    continue;
                }
            }
        }
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])
            .map_err(|e| e.to_string())?;
        deleted += 1;
    }
    Ok(DeleteTracksResult {
        deleted,
        failed,
        snapshot: snapshot(&conn)?,
    })
}

fn sha1_file(path: &std::path::Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub fn delete_missing_tracks(
    state: State<'_, AppState>,
) -> Result<DeleteTracksResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute("DELETE FROM tracks WHERE missing = 1", [])
        .map_err(|e| e.to_string())?;
    Ok(DeleteTracksResult {
        deleted,
        failed: Vec::new(),
        snapshot: snapshot(&conn)?,
    })
}

const TAG_FIELDS: [&str; 4] = ["title", "artist", "album", "album_artist"];

fn tag_encoding_issues(conn: &Connection) -> Result<Vec<TagEncodingIssue>, String> {
    let mut stmt = conn
        .prepare("SELECT id, path, title, artist, album, album_artist FROM tracks")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut issues = Vec::new();
    for row in rows {
        let (track_id, path, title, artist, album, album_artist) =
            row.map_err(|e| e.to_string())?;
        let values = [title, artist, album, album_artist];
        for (field, value) in TAG_FIELDS.iter().zip(values.iter()) {
            if let Some(after) = repair_mojibake(value) {
                issues.push(TagEncodingIssue {
                    track_id,
                    path: path.clone(),
                    field: (*field).to_string(),
                    before: value.clone(),
                    after,
                });
            }
        }
    }
    Ok(issues)
}

#[tauri::command]
pub fn preview_tag_encoding(
    state: State<'_, AppState>,
) -> Result<Vec<TagEncodingIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    tag_encoding_issues(&conn)
}

#[tauri::command]
pub fn apply_tag_encoding(
    state: State<'_, AppState>,
) -> Result<TagEncodingResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let issues = tag_encoding_issues(&conn)?;
    let now = crate::db::now_secs();
    for issue in &issues {
        let sql = format!(
            "UPDATE tracks SET {} = ?1, updated_at = ?2 WHERE id = ?3",
            issue.field
        );
        conn.execute(&sql, params![issue.after, now, issue.track_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(TagEncodingResult {
        fixed: issues.len(),
        snapshot: snapshot(&conn)?,
    })
}

#[tauri::command]
pub async fn hash_tracks(
    state: State<'_, AppState>,
    track_ids: Vec<i64>,
) -> Result<Vec<TrackHash>, String> {
    let paths: Vec<(i64, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM tracks WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        for track_id in track_ids {
            let path: Option<String> = stmt
                .query_row(params![track_id], |row| row.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(path) = path {
                paths.push((track_id, path));
            }
        }
        paths
    };

    let hashes = tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|(track_id, path)| {
                let hash = sha1_file(std::path::Path::new(&path))
                    .unwrap_or_else(|_| format!("unreadable:{track_id}"));
                TrackHash { track_id, hash }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(hashes)
}

#[tauri::command]
pub fn merge_albums(
    state: State<'_, AppState>,
    track_ids: Vec<i64>,
    name: String,
) -> Result<Snapshot, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Введите название нового альбома".to_string());
    }
    if track_ids.is_empty() {
        return Err("Выберите хотя бы один альбом".to_string());
    }
    let key = format!(
        "merged:{}:{}",
        crate::db::now_millis(),
        track_ids.first().copied().unwrap_or(0)
    );
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for track_id in &track_ids {
        tx.execute(
            "UPDATE tracks SET group_key_override = ?1, group_name_override = ?2, updated_at = ?3 WHERE id = ?4",
            params![key, name, crate::db::now_secs(), track_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(&conn)
}

#[tauri::command]
pub fn set_background(
    state: State<'_, AppState>,
    kind: String,
    source_path: String,
) -> Result<String, String> {
    if kind != "app" && kind != "now" {
        return Err("Неизвестный тип фона".to_string());
    }
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Файл фона не найден".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let dir = state.app_dir.join("backgrounds");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("{kind}.")) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let dest = dir.join(format!("{kind}.{extension}"));
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_background(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    if kind != "app" && kind != "now" {
        return Err("Неизвестный тип фона".to_string());
    }
    let dir = state.app_dir.join("backgrounds");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("{kind}.")) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn search_media(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<MediaCandidate>, String> {
    media::search(&query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn resolve_playlist(
    app: AppHandle,
    url: String,
    ytdlp_path: Option<String>,
) -> Result<ImportPlaylist, String> {
    media::resolve_playlist(&app, &url, ytdlp_path).await
}

#[tauri::command]
pub async fn download_media(
    app: AppHandle,
    id: String,
    url: String,
    query: Option<String>,
    output_dir: String,
    ytdlp_path: Option<String>,
    expected_artist: Option<String>,
    expected_title: Option<String>,
) -> Result<DownloadResult, String> {
    media::download_media(
        &app,
        id,
        url,
        query,
        output_dir,
        ytdlp_path,
        expected_artist,
        expected_title,
    )
    .await
}

#[tauri::command]
pub async fn download_direct(
    app: AppHandle,
    id: String,
    url: String,
    output_dir: String,
    file_name: Option<String>,
    expected_artist: Option<String>,
    expected_title: Option<String>,
) -> Result<DownloadResult, String> {
    media::download_direct(
        &app,
        id,
        url,
        output_dir,
        file_name,
        expected_artist,
        expected_title,
    )
    .await
}

#[tauri::command]
pub async fn recognize_audd(
    app: AppHandle,
    api_token: String,
    source: Option<String>,
) -> Result<RecognitionResult, String> {
    recognition::recognize_audd(app, api_token, source).await
}

#[tauri::command]
pub async fn recognize_shazam(
    app: AppHandle,
    source: Option<String>,
) -> Result<RecognitionResult, String> {
    recognition::recognize_shazam(app, source).await
}

#[tauri::command]
pub async fn recognize_shazam_file(path: String) -> Result<RecognitionResult, String> {
    recognition::recognize_shazam_file(path).await
}

#[tauri::command]
pub async fn get_lyrics(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<LyricsResult, String> {
    lyrics::get_lyrics(app, state, track_id).await
}

#[tauri::command]
pub fn list_lyrics(app: AppHandle) -> Result<Vec<LyricsFile>, String> {
    lyrics::list(&app)
}

#[tauri::command]
pub fn save_lyrics(
    app: AppHandle,
    file_name: String,
    text: String,
) -> Result<String, String> {
    lyrics::save(&app, &file_name, &text)
}

#[tauri::command]
pub fn delete_lyrics(app: AppHandle, file_name: String) -> Result<(), String> {
    lyrics::delete(&app, &file_name)
}

#[tauri::command]
pub fn clear_lyrics(app: AppHandle) -> Result<usize, String> {
    lyrics::clear(&app)
}
