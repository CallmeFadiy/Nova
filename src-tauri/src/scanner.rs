use crate::models::{ScanProgress, ScanResult};
use lofty::prelude::*;
use lofty::tag::ItemKey;
use rusqlite::{params, Connection, OptionalExtension};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "wma", "aiff", "aif",
];

const COVER_NAMES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "front.jpg",
    "front.jpeg",
    "front.png",
];

struct ParsedTrack {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    duration_ms: i64,
    track_no: Option<i64>,
    year: Option<i64>,
    genre: Option<String>,
    cover_path: Option<String>,
    format: String,
}

pub fn scan(app: &AppHandle, conn: &Connection, app_dir: &Path) -> Result<ScanResult, String> {
    let folders: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM folders ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut missing = 0usize;
    let mut total = 0usize;

    for (folder_id, folder_path) in folders {
        let root = PathBuf::from(&folder_path);
        if !root.is_dir() {
            continue;
        }

        let mut files: Vec<PathBuf> = WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_file() && is_audio(entry.path()))
            .map(|entry| entry.into_path())
            .collect();
        files.sort();

        total += files.len();
        conn.execute(
            "UPDATE tracks SET missing = 1 WHERE folder_id = ?1",
            params![folder_id],
        )
        .map_err(|e| e.to_string())?;

        for (index, path) in files.iter().enumerate() {
            let path_string = path.to_string_lossy().to_string();
            let metadata = match fs::metadata(path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let size = metadata.len() as i64;
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs() as i64)
                .unwrap_or(0);

            let existing: Option<(i64, i64, i64)> = conn
                .query_row(
                    "SELECT id, mtime, size FROM tracks WHERE path = ?1",
                    params![path_string],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some((id, old_mtime, old_size)) = existing {
                if old_mtime == mtime && old_size == size {
                    conn.execute(
                        "UPDATE tracks SET missing = 0, folder_id = ?1 WHERE id = ?2",
                        params![folder_id, id],
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    let parsed = parse_track(path, app_dir);
                    upsert(
                        conn,
                        &path_string,
                        folder_id,
                        path,
                        &parsed,
                        size,
                        mtime,
                    )?;
                    updated += 1;
                }
            } else {
                let parsed = parse_track(path, app_dir);
                upsert(
                    conn,
                    &path_string,
                    folder_id,
                    path,
                    &parsed,
                    size,
                    mtime,
                )?;
                added += 1;
            }

            if index % 5 == 0 || index + 1 == files.len() {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        current: index + 1,
                        total: files.len(),
                        path: path
                            .file_name()
                            .map(|name| name.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    },
                );
            }
        }

        let missing_in_folder: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tracks WHERE folder_id = ?1 AND missing = 1",
                params![folder_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        missing += missing_in_folder as usize;

        conn.execute(
            "UPDATE folders SET last_scan_at = ?1 WHERE id = ?2",
            params![crate::db::now_secs(), folder_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(ScanResult {
        added,
        updated,
        missing,
        total,
    })
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| AUDIO_EXTENSIONS.contains(&value.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn parse_track(path: &Path, app_dir: &Path) -> ParsedTrack {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let fallback_album = path
        .parent()
        .and_then(|value| value.file_name())
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "Без альбома".to_string());
    let (fallback_artist, fallback_title) = split_file_name(&stem);
    let format = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_uppercase())
        .unwrap_or_default();

    let mut parsed = ParsedTrack {
        title: fallback_title,
        artist: fallback_artist.clone(),
        album: fallback_album,
        album_artist: fallback_artist,
        duration_ms: 0,
        track_no: None,
        year: None,
        genre: None,
        cover_path: None,
        format,
    };

    let Ok(tagged) = lofty::read_from_path(path) else {
        parsed.cover_path = folder_cover(path, app_dir);
        return parsed;
    };

    parsed.duration_ms = tagged.properties().duration().as_millis() as i64;

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        if let Some(value) = tag.title() {
            if !value.trim().is_empty() {
                parsed.title = value.trim().to_string();
            }
        }
        if let Some(value) = tag.artist() {
            if !value.trim().is_empty() {
                parsed.artist = value.trim().to_string();
            }
        }
        if let Some(value) = tag.album() {
            if !value.trim().is_empty() {
                parsed.album = value.trim().to_string();
            }
        }
        if let Some(value) = tag.get_string(ItemKey::AlbumArtist) {
            if !value.trim().is_empty() {
                parsed.album_artist = value.trim().to_string();
            }
        } else {
            parsed.album_artist = parsed.artist.clone();
        }
        parsed.track_no = tag.track().map(|value| value as i64);
        parsed.year = tag
            .get_string(ItemKey::Year)
            .and_then(|value| value.parse::<i64>().ok());
        parsed.genre = tag.genre().map(|value| value.to_string());
        parsed.cover_path = embedded_cover(path, tag, app_dir);
    }

    if parsed.cover_path.is_none() {
        parsed.cover_path = folder_cover(path, app_dir);
    }

    parsed
}

fn split_file_name(stem: &str) -> (String, String) {
    if let Some((artist, title)) = stem.split_once(" - ") {
        let artist = artist.trim();
        let title = title.trim();
        if !artist.is_empty() && !title.is_empty() {
            return (artist.to_string(), title.to_string());
        }
    }
    let title = stem.replace('_', " ").trim().to_string();
    ("Неизвестный исполнитель".to_string(), title)
}

fn cover_hash(path: &Path) -> String {
    format!("{:x}", Sha1::digest(path.to_string_lossy().as_bytes()))
}

fn embedded_cover(path: &Path, tag: &lofty::tag::Tag, app_dir: &Path) -> Option<String> {
    let picture = tag.pictures().first()?;
    if picture.data().is_empty() {
        return None;
    }
    let mime = picture
        .mime_type()
        .map(|value| value.as_str())
        .unwrap_or("image/jpeg");
    let extension = if mime.contains("png") {
        "png"
    } else if mime.contains("webp") {
        "webp"
    } else if mime.contains("gif") {
        "gif"
    } else {
        "jpg"
    };
    let cover_path = app_dir
        .join("covers")
        .join(format!("{}.{}", cover_hash(path), extension));
    if !cover_path.exists() {
        fs::write(&cover_path, picture.data()).ok()?;
    }
    Some(cover_path.to_string_lossy().to_string())
}

fn folder_cover(path: &Path, app_dir: &Path) -> Option<String> {
    let parent = path.parent()?;
    for name in COVER_NAMES {
        let candidate = parent.join(name);
        if candidate.is_file() {
            let extension = candidate
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("jpg");
            let cover_path = app_dir
                .join("covers")
                .join(format!("{}.{}", cover_hash(path), extension));
            if !cover_path.exists() {
                fs::copy(&candidate, &cover_path).ok()?;
            }
            return Some(cover_path.to_string_lossy().to_string());
        }
    }
    None
}

fn upsert(
    conn: &Connection,
    path_string: &str,
    folder_id: i64,
    path: &Path,
    parsed: &ParsedTrack,
    size: i64,
    mtime: i64,
) -> Result<(), String> {
    let now = crate::db::now_secs();
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    conn.execute(
        r#"
        INSERT INTO tracks (
            path, folder_id, filename, title, artist, album, album_artist,
            duration_ms, track_no, year, genre, cover_path, format, size, mtime,
            added_at, updated_at, missing
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, 0
        )
        ON CONFLICT(path) DO UPDATE SET
            folder_id = excluded.folder_id,
            filename = excluded.filename,
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            album_artist = excluded.album_artist,
            duration_ms = excluded.duration_ms,
            track_no = excluded.track_no,
            year = excluded.year,
            genre = excluded.genre,
            cover_path = excluded.cover_path,
            format = excluded.format,
            size = excluded.size,
            mtime = excluded.mtime,
            updated_at = excluded.updated_at,
            missing = 0
        "#,
        params![
            path_string,
            folder_id,
            file_name,
            parsed.title,
            parsed.artist,
            parsed.album,
            parsed.album_artist,
            parsed.duration_ms,
            parsed.track_no,
            parsed.year,
            parsed.genre,
            parsed.cover_path,
            parsed.format,
            size,
            mtime,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
