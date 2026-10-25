use crate::models::{
    DownloadResult, Folder, ImportPlaylist, MediaCandidate, Playlist, RecognitionResult, ScanResult,
    Snapshot, Track,
};
use crate::{media, scanner, AppState};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
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
            t.missing
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
) -> Result<DownloadResult, String> {
    media::download_media(&app, id, url, query, output_dir, ytdlp_path).await
}

#[tauri::command]
pub async fn download_direct(
    app: AppHandle,
    id: String,
    url: String,
    output_dir: String,
    file_name: Option<String>,
) -> Result<DownloadResult, String> {
    media::download_direct(&app, id, url, output_dir, file_name).await
}

#[tauri::command]
pub async fn recognize_audd(api_token: String) -> Result<RecognitionResult, String> {
    media::recognize_audd(api_token).await
}

#[tauri::command]
pub async fn recognize_shazam() -> Result<RecognitionResult, String> {
    media::recognize_shazam().await
}

#[tauri::command]
pub async fn recognize_shazam_file(path: String) -> Result<RecognitionResult, String> {
    media::recognize_shazam_file(path).await
}
