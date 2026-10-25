use crate::models::{
    DownloadProgress, DownloadResult, ImportPlaylist, ImportTrack, MediaCandidate,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn emit_progress(app: &AppHandle, progress: DownloadProgress) {
    let _ = app.emit("download-progress", progress);
}

fn default_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("downloads");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn resolve_output_dir(app: &AppHandle, output_dir: &str) -> Result<PathBuf, String> {
    if output_dir.trim().is_empty() {
        default_download_dir(app)
    } else {
        let path = PathBuf::from(output_dir.trim());
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        Ok(path)
    }
}

async fn run_ytdlp(
    app: &AppHandle,
    args: Vec<String>,
    ytdlp_path: Option<String>,
) -> Result<(String, String), String> {
    let shell = app.shell();
    let command = match ytdlp_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => shell.command(path),
        None => shell
            .sidecar("yt-dlp")
            .map_err(|error| format!("yt-dlp не найден: {error}"))?,
    };

    let (mut receiver, _child) = command
        .args(args)
        .spawn()
        .map_err(|error| format!("Не удалось запустить yt-dlp: {error}"))?;

    let mut stdout = Vec::new();
    let mut stderr = String::new();
    let mut code: Option<i32> = None;

    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(line) => stdout.extend_from_slice(&line),
            CommandEvent::Stderr(line) => {
                stderr.push_str(&String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                stderr.push_str(&error);
                stderr.push('\n');
            }
            _ => {}
        }
    }

    if code != Some(0) {
        let message = stderr.trim();
        return Err(if message.is_empty() {
            "yt-dlp завершился с ошибкой".to_string()
        } else {
            message.to_string()
        });
    }

    Ok((String::from_utf8_lossy(&stdout).to_string(), stderr))
}

async fn run_ytdlp_with_progress(
    app: &AppHandle,
    id: &str,
    args: Vec<String>,
    ytdlp_path: Option<String>,
) -> Result<(String, String), String> {
    let shell = app.shell();
    let command = match ytdlp_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => shell.command(path),
        None => shell
            .sidecar("yt-dlp")
            .map_err(|error| format!("yt-dlp не найден: {error}"))?,
    };

    let (mut receiver, _child) = command
        .args(args)
        .spawn()
        .map_err(|error| format!("Не удалось запустить yt-dlp: {error}"))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code: Option<i32> = None;
    let mut last_percent = -1.0f64;

    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line).to_string();
                stdout.push_str(&text);
                stdout.push('\n');
                let percent = parse_percent(&text);
                if percent >= 0.0 && (percent - last_percent).abs() >= 0.5 {
                    last_percent = percent;
                    emit_progress(
                        app,
                        DownloadProgress {
                            id: id.to_string(),
                            percent,
                            line: text.trim().to_string(),
                            status: "downloading".to_string(),
                            path: None,
                            error: None,
                        },
                    );
                }
            }
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line).to_string();
                stderr.push_str(&text);
                stderr.push('\n');
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                stderr.push_str(&error);
                stderr.push('\n');
            }
            _ => {}
        }
    }

    if code != Some(0) {
        let message = stderr
            .lines()
            .filter(|line| !line.trim().is_empty())
            .last()
            .unwrap_or("yt-dlp завершился с ошибкой")
            .to_string();
        return Err(message);
    }

    Ok((stdout, stderr))
}

fn parse_percent(line: &str) -> f64 {
    let Some(start) = line.find("[download]") else {
        return -1.0;
    };
    let rest = &line[start + 10..];
    let Some(percent_index) = rest.find('%') else {
        return -1.0;
    };
    rest[..percent_index]
        .trim()
        .parse::<f64>()
        .map(|value| value.clamp(0.0, 100.0))
        .unwrap_or(-1.0)
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<MediaCandidate>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Введите название или исполнителя".to_string());
    }
    let limit = limit.clamp(1, 30);
    let client = reqwest::Client::builder()
        .user_agent("Nova/0.1 (local music player)")
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|error| error.to_string())?;

    let mut results: Vec<MediaCandidate> = Vec::new();

    let mut itunes_url = reqwest::Url::parse("https://itunes.apple.com/search")
        .map_err(|error| error.to_string())?;
    itunes_url
        .query_pairs_mut()
        .append_pair("term", query)
        .append_pair("media", "music")
        .append_pair("entity", "song")
        .append_pair("limit", &limit.to_string());
    if let Ok(response) = client.get(itunes_url).send().await {
        if let Ok(json) = response.json::<serde_json::Value>().await {
            if let Some(items) = json.get("results").and_then(|value| value.as_array()) {
                for item in items {
                    let title = item
                        .get("trackName")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if title.is_empty() {
                        continue;
                    }
                    let artist = item
                        .get("artistName")
                        .and_then(|value| value.as_str())
                        .unwrap_or("Неизвестный исполнитель")
                        .to_string();
                    let album = item
                        .get("collectionName")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let artwork = item
                        .get("artworkUrl100")
                        .and_then(|value| value.as_str())
                        .map(|value| value.replace("100x100bb", "600x600bb"));
                    let preview = item
                        .get("previewUrl")
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    let webpage = item
                        .get("trackViewUrl")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let track_id = item
                        .get("trackId")
                        .and_then(|value| value.as_i64())
                        .unwrap_or_default();
                    results.push(MediaCandidate {
                        id: format!("itunes-{track_id}"),
                        title: title.clone(),
                        artist: artist.clone(),
                        album,
                        duration_ms: item
                            .get("trackTimeMillis")
                            .and_then(|value| value.as_i64())
                            .unwrap_or(0),
                        artwork_url: artwork,
                        source: "iTunes".to_string(),
                        webpage_url: webpage,
                        preview_url: preview.clone(),
                        download_url: preview,
                        query: format!("{artist} {title}"),
                    });
                }
            }
        }
    }

    let mut deezer_url = reqwest::Url::parse("https://api.deezer.com/search")
        .map_err(|error| error.to_string())?;
    deezer_url
        .query_pairs_mut()
        .append_pair("q", query)
        .append_pair("limit", &limit.to_string());
    if let Ok(response) = client.get(deezer_url).send().await {
        if let Ok(json) = response.json::<serde_json::Value>().await {
            if let Some(items) = json.get("data").and_then(|value| value.as_array()) {
                for item in items {
                    let title = item
                        .get("title")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if title.is_empty() {
                        continue;
                    }
                    let artist = item
                        .get("artist")
                        .and_then(|value| value.get("name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("Неизвестный исполнитель")
                        .to_string();
                    let album = item
                        .get("album")
                        .and_then(|value| value.get("title"))
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let preview = item
                        .get("preview")
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    let link = item
                        .get("link")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let track_id = item
                        .get("id")
                        .and_then(|value| value.as_i64())
                        .unwrap_or_default();
                    results.push(MediaCandidate {
                        id: format!("deezer-{track_id}"),
                        title: title.clone(),
                        artist: artist.clone(),
                        album,
                        duration_ms: item
                            .get("duration")
                            .and_then(|value| value.as_i64())
                            .unwrap_or(0)
                            * 1000,
                        artwork_url: item
                            .get("album")
                            .and_then(|value| value.get("cover_big"))
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                        source: "Deezer".to_string(),
                        webpage_url: link,
                        preview_url: preview.clone(),
                        download_url: preview,
                        query: format!("{artist} {title}"),
                    });
                }
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    results.retain(|item| {
        let key = format!(
            "{}|{}",
            item.title.to_lowercase(),
            item.artist.to_lowercase()
        );
        seen.insert(key)
    });

    if results.is_empty() {
        return Err("Ничего не найдено. Проверьте сеть или запрос.".to_string());
    }

    results.truncate(limit * 2);
    Ok(results)
}

pub async fn resolve_playlist(
    app: &AppHandle,
    url: &str,
    ytdlp_path: Option<String>,
) -> Result<ImportPlaylist, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Вставьте ссылку на плейлист".to_string());
    }
    let lower = url.to_lowercase();

    if lower.contains("deezer.com") {
        return resolve_deezer(url).await;
    }

    if lower.contains("youtube.com") || lower.contains("youtu.be") {
        return resolve_youtube(app, url, ytdlp_path).await;
    }

    if lower.contains("spotify.com") {
        return Err(
            "Spotify: для списка треков нужен Client ID и Secret в настройках. Прямые ссылки на аудио можно скачать на вкладке «Загрузки»."
                .to_string(),
        );
    }

    if lower.contains("music.apple.com") || lower.contains("itunes.apple.com") {
        return Err(
            "Apple Music: публичная страница не даёт список треков без API. Используйте Deezer или YouTube-ссылку."
                .to_string(),
        );
    }

    if lower.contains("music.yandex.") || lower.contains("vk.com") {
        return Err(
            "Яндекс Музыка и VK требуют авторизации. Публичные ссылки Deezer и YouTube поддерживаются без ключей."
                .to_string(),
        );
    }

    if is_audio_url(url) {
        let title = url
            .rsplit('/')
            .next()
            .unwrap_or("Аудиофайл")
            .split('?')
            .next()
            .unwrap_or("Аудиофайл")
            .to_string();
        return Ok(ImportPlaylist {
            title: title.clone(),
            source: "Прямая ссылка".to_string(),
            tracks: vec![ImportTrack {
                title,
                artist: "Неизвестный исполнитель".to_string(),
                album: String::new(),
                duration_ms: 0,
                source_url: url.to_string(),
                preview_url: None,
                download_url: Some(url.to_string()),
                query: String::new(),
            }],
        });
    }

    Err("Поддерживаются Deezer, YouTube, прямые аудио-ссылки. Spotify/Apple/Яндекс/VK требуют ключей или авторизации.".to_string())
}

async fn resolve_deezer(url: &str) -> Result<ImportPlaylist, String> {
    let kind = if url.contains("/playlist/") {
        "playlist"
    } else if url.contains("/album/") {
        "album"
    } else {
        return Err("Не удалось определить тип ссылки Deezer".to_string());
    };

    let parts: Vec<&str> = url.split('/').collect();
    let index = parts
        .iter()
        .position(|part| *part == kind)
        .ok_or_else(|| "Не удалось найти ID Deezer".to_string())?;
    let raw_id = parts
        .get(index + 1)
        .ok_or_else(|| "Не удалось найти ID Deezer".to_string())?;
    let id = raw_id.split('?').next().unwrap_or(raw_id);
    if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Некорректный ID Deezer".to_string());
    }

    let api = format!("https://api.deezer.com/{kind}/{id}");
    let client = reqwest::Client::builder()
        .user_agent("Nova/0.1")
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|error| error.to_string())?;
    let json = client
        .get(api)
        .send()
        .await
        .map_err(|error| format!("Deezer недоступен: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Deezer вернул ошибку: {error}"))?;

    if let Some(error) = json.get("error").and_then(|value| value.get("message")) {
        return Err(format!(
            "Deezer: {}",
            error.as_str().unwrap_or("неизвестная ошибка")
        ));
    }

    let title = json
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Deezer")
        .to_string();
    let source_artist = json
        .get("artist")
        .and_then(|value| value.get("name"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let tracks_json = json
        .get("tracks")
        .and_then(|value| value.get("data"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let album_name = if kind == "album" {
        title.clone()
    } else {
        String::new()
    };

    let mut tracks = Vec::new();
    for item in tracks_json {
        let track_title = item
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if track_title.is_empty() {
            continue;
        }
        let artist = item
            .get("artist")
            .and_then(|value| value.get("name"))
            .and_then(|value| value.as_str())
            .unwrap_or(&source_artist)
            .to_string();
        let album = item
            .get("album")
            .and_then(|value| value.get("title"))
            .and_then(|value| value.as_str())
            .unwrap_or(&album_name)
            .to_string();
        let preview = item
            .get("preview")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let link = item
            .get("link")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        tracks.push(ImportTrack {
            title: track_title.clone(),
            artist: artist.clone(),
            album,
            duration_ms: item
                .get("duration")
                .and_then(|value| value.as_i64())
                .unwrap_or(0)
                * 1000,
            source_url: link,
            preview_url: preview.clone(),
            download_url: preview,
            query: format!("{artist} {track_title}"),
        });
    }

    if tracks.is_empty() {
        return Err("В плейлисте Deezer не найдено треков".to_string());
    }

    Ok(ImportPlaylist {
        title,
        source: "Deezer".to_string(),
        tracks,
    })
}

async fn resolve_youtube(
    app: &AppHandle,
    url: &str,
    ytdlp_path: Option<String>,
) -> Result<ImportPlaylist, String> {
    let args = vec![
        "--flat-playlist".to_string(),
        "--dump-single-json".to_string(),
        "--skip-download".to_string(),
        "--no-warnings".to_string(),
        url.to_string(),
    ];
    let (stdout, stderr) = run_ytdlp(app, args, ytdlp_path).await?;
    let json: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("Не удалось разобрать ответ YouTube: {error} · {stderr}"))?;

    let playlist_title = json
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("YouTube")
        .to_string();

    let entries = json
        .get("entries")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut tracks = Vec::new();
    if entries.is_empty() {
        let title = json
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("YouTube")
            .to_string();
        let uploader = json
            .get("uploader")
            .or_else(|| json.get("channel"))
            .and_then(|value| value.as_str())
            .unwrap_or("YouTube")
            .to_string();
        let webpage = json
            .get("webpage_url")
            .and_then(|value| value.as_str())
            .unwrap_or(url)
            .to_string();
        tracks.push(ImportTrack {
            title: title.clone(),
            artist: uploader.clone(),
            album: String::new(),
            duration_ms: json
                .get("duration")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0) as i64
                * 1000,
            source_url: webpage.clone(),
            preview_url: None,
            download_url: Some(webpage),
            query: format!("{uploader} {title}"),
        });
    } else {
        for entry in entries {
            if entry.is_null() {
                continue;
            }
            let title = entry
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            if title.is_empty() {
                continue;
            }
            let uploader = entry
                .get("uploader")
                .or_else(|| entry.get("channel"))
                .and_then(|value| value.as_str())
                .unwrap_or("YouTube")
                .to_string();
            let webpage = entry
                .get("webpage_url")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| {
                    entry
                        .get("id")
                        .and_then(|value| value.as_str())
                        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
                })
                .unwrap_or_else(|| url.to_string());
            tracks.push(ImportTrack {
                title: title.clone(),
                artist: uploader.clone(),
                album: String::new(),
                duration_ms: entry
                    .get("duration")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0) as i64
                    * 1000,
                source_url: webpage.clone(),
                preview_url: None,
                download_url: Some(webpage),
                query: format!("{uploader} {title}"),
            });
        }
    }

    if tracks.is_empty() {
        return Err("YouTube не вернул треков".to_string());
    }

    Ok(ImportPlaylist {
        title: playlist_title,
        source: "YouTube".to_string(),
        tracks,
    })
}

pub async fn download_media(
    app: &AppHandle,
    id: String,
    url: String,
    query: Option<String>,
    output_dir: String,
    ytdlp_path: Option<String>,
) -> Result<DownloadResult, String> {
    let directory = resolve_output_dir(app, &output_dir)?;
    let directory_string = directory.to_string_lossy().to_string();
    let started_at = now_secs();

    let target = match query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(search) => format!("ytsearch1:{search}"),
        None => url,
    };

    let output_template = directory
        .join("%(artist,uploader,channel,creator)s - %(title)s.%(ext)s")
        .to_string_lossy()
        .to_string();

    let args = vec![
        "--no-playlist".to_string(),
        "--newline".to_string(),
        "--windows-filenames".to_string(),
        "-f".to_string(),
        "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio".to_string(),
        "-o".to_string(),
        output_template,
        "--print".to_string(),
        "after_move:filepath".to_string(),
        target,
    ];

    match run_ytdlp_with_progress(app, &id, args, ytdlp_path).await {
        Ok((stdout, _stderr)) => {
            let path = stdout
                .lines()
                .map(str::trim)
                .filter(|line| line.starts_with(&directory_string) && Path::new(line).is_file())
                .last()
                .map(str::to_string)
                .or_else(|| newest_file(&directory, started_at))
                .ok_or_else(|| "Файл скачан, но не найден в папке загрузок".to_string())?;
            let title = Path::new(&path)
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Новый трек".to_string());
            emit_progress(
                app,
                DownloadProgress {
                    id,
                    percent: 100.0,
                    line: "Готово".to_string(),
                    status: "done".to_string(),
                    path: Some(path.clone()),
                    error: None,
                },
            );
            Ok(DownloadResult {
                path,
                title,
                directory: directory_string,
            })
        }
        Err(error) => {
            emit_progress(
                app,
                DownloadProgress {
                    id,
                    percent: 0.0,
                    line: error.clone(),
                    status: "error".to_string(),
                    path: None,
                    error: Some(error.clone()),
                },
            );
            Err(error)
        }
    }
}

pub async fn download_direct(
    app: &AppHandle,
    id: String,
    url: String,
    output_dir: String,
    file_name: Option<String>,
) -> Result<DownloadResult, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Ссылка должна начинаться с http:// или https://".to_string());
    }
    let directory = resolve_output_dir(app, &output_dir)?;
    let client = reqwest::Client::builder()
        .user_agent("Nova/0.1")
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Не удалось скачать файл: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Источник вернул HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Ошибка чтения файла: {error}"))?;

    let extension = guess_extension(&url, &content_type);
    let base_name = file_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            url.rsplit('/')
                .next()
                .unwrap_or("track")
                .split('?')
                .next()
                .unwrap_or("track")
                .to_string()
        });
    let base_name = sanitize_filename(&base_name);
    let mut path = directory.join(format!("{base_name}.{extension}"));
    let mut counter = 1;
    while path.exists() {
        path = directory.join(format!("{base_name} ({counter}).{extension}"));
        counter += 1;
    }

    fs::write(&path, &bytes).map_err(|error| format!("Не удалось записать файл: {error}"))?;
    let path_string = path.to_string_lossy().to_string();
    emit_progress(
        app,
        DownloadProgress {
            id,
            percent: 100.0,
            line: "Готово".to_string(),
            status: "done".to_string(),
            path: Some(path_string.clone()),
            error: None,
        },
    );
    Ok(DownloadResult {
        path: path_string,
        title: base_name,
        directory: directory.to_string_lossy().to_string(),
    })
}

fn newest_file(directory: &Path, since_secs: u64) -> Option<String> {
    let mut candidates: Vec<(SystemTime, PathBuf)> = fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .find(|(modified, _)| {
            modified
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_secs() >= since_secs.saturating_sub(2))
                .unwrap_or(false)
        })
        .map(|(_, path)| path.to_string_lossy().to_string())
}

fn is_audio_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "webm"]
        .iter()
        .any(|extension| lower.contains(&format!(".{extension}")))
}

fn guess_extension(url: &str, content_type: &str) -> String {
    let lower = url.to_lowercase();
    for extension in ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "webm"] {
        if lower.contains(&format!(".{extension}")) {
            return extension.to_string();
        }
    }
    if content_type.contains("mpeg") {
        "mp3".to_string()
    } else if content_type.contains("mp4") || content_type.contains("m4a") {
        "m4a".to_string()
    } else if content_type.contains("ogg") {
        "ogg".to_string()
    } else if content_type.contains("wav") {
        "wav".to_string()
    } else if content_type.contains("flac") {
        "flac".to_string()
    } else {
        "m4a".to_string()
    }
}

fn sanitize_filename(name: &str) -> String {
    let mut value: String = name
        .chars()
        .map(|character| {
            if "\\/:*?\"<>|".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    value = value.trim().trim_matches('.').to_string();
    if value.chars().count() > 110 {
        value = value.chars().take(110).collect();
    }
    if value.is_empty() {
        value = "track".to_string();
    }
    value
}

pub async fn recognize_shazam() -> Result<crate::models::RecognitionResult, String> {
    let (samples, sample_rate) =
        tauri::async_runtime::spawn_blocking(record_pcm_8s)
            .await
            .map_err(|error| format!("Не удалось записать микрофон: {error}"))??;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let songrec = songrec::SongRec::new(songrec::Config::default());
        songrec.recognize_from_samples(&samples, sample_rate)
    })
    .await
    .map_err(|error| format!("Ошибка распознавания: {error}"))?
    .map_err(|error| error.to_string())?;

    Ok(map_shazam_result(result))
}

pub async fn recognize_shazam_file(
    path: String,
) -> Result<crate::models::RecognitionResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let songrec = songrec::SongRec::new(songrec::Config::default());
        songrec.recognize_from_file(&path)
    })
    .await
    .map_err(|error| format!("Ошибка чтения файла: {error}"))?
    .map_err(|error| error.to_string())?;

    Ok(map_shazam_result(result))
}

fn map_shazam_result(
    result: songrec::RecognitionResult,
) -> crate::models::RecognitionResult {
    let raw = result
        .raw_response
        .get("track")
        .unwrap_or(&result.raw_response);
    let artwork = raw
        .get("images")
        .and_then(|value| value.get("coverart"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let source_url = raw
        .get("url")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            raw.get("share")
                .and_then(|value| value.get("href"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    let query = format!("{} {}", result.artist_name, result.song_name);
    crate::models::RecognitionResult {
        title: result.song_name,
        artist: result.artist_name,
        album: result.album_name.unwrap_or_default(),
        artwork_url: artwork,
        source_url,
        query,
        provider: "Shazam".to_string(),
    }
}

pub async fn recognize_audd(api_token: String) -> Result<crate::models::RecognitionResult, String> {
    let token = api_token.trim().to_string();
    if token.is_empty() {
        return Err("Укажите API-ключ AudD в настройках".to_string());
    }
    let wav = tauri::async_runtime::spawn_blocking(record_wav_8s)
        .await
        .map_err(|error| format!("Не удалось записать микрофон: {error}"))??;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("nova-sample.wav")
        .mime_str("audio/wav")
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("api_token", token)
        .text("return", "apple_music,spotify")
        .part("audio", part);

    let response = client
        .post("https://api.audd.io/")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("AudD недоступен: {error}"))?;
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("AudD вернул ошибку: {error}"))?;

    if json.get("status").and_then(|value| value.as_str()) != Some("success") {
        let message = json
            .get("error")
            .and_then(|value| value.get("error_message"))
            .and_then(|value| value.as_str())
            .unwrap_or("AudD не смог обработать запрос");
        return Err(message.to_string());
    }

    let result = json.get("result").unwrap_or(&serde_json::Value::Null);
    if result.is_null() {
        return Err("Не удалось распознать трек. Попробуйте громче или ближе к источнику.".to_string());
    }

    let title = result
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Неизвестный трек")
        .to_string();
    let artist = result
        .get("artist")
        .and_then(|value| value.as_str())
        .unwrap_or("Неизвестный исполнитель")
        .to_string();
    let album = result
        .get("album")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();

    let artwork = result
        .get("apple_music")
        .and_then(|value| value.get("artwork"))
        .and_then(|value| value.get("url"))
        .and_then(|value| value.as_str())
        .map(|value| value.replace("{w}", "600").replace("{h}", "600"))
        .or_else(|| {
            result
                .get("spotify")
                .and_then(|value| value.get("album"))
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .and_then(|images| images.first())
                .and_then(|image| image.get("url"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    let source_url = result
        .get("song_link")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            result
                .get("spotify")
                .and_then(|value| value.get("external_urls"))
                .and_then(|value| value.get("spotify"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    Ok(crate::models::RecognitionResult {
        title: title.clone(),
        artist: artist.clone(),
        album,
        artwork_url: artwork,
        source_url,
        query: format!("{artist} {title}"),
        provider: "AudD".to_string(),
    })
}

fn record_pcm_8s() -> Result<(Vec<i16>, u32), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::{Arc, Mutex};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "Микрофон не найден".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|error| format!("Не удалось открыть микрофон: {error}"))?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;

    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let error_slot = Arc::new(Mutex::new(None::<String>));

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let samples = samples.clone();
            let error_slot = error_slot.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    if let Ok(mut guard) = samples.lock() {
                        guard.extend(data.iter().copied());
                    }
                },
                move |error| {
                    if let Ok(mut guard) = error_slot.lock() {
                        *guard = Some(error.to_string());
                    }
                },
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let samples = samples.clone();
            let error_slot = error_slot.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    if let Ok(mut guard) = samples.lock() {
                        guard.extend(data.iter().map(|value| *value as f32 / 32768.0));
                    }
                },
                move |error| {
                    if let Ok(mut guard) = error_slot.lock() {
                        *guard = Some(error.to_string());
                    }
                },
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let samples = samples.clone();
            let error_slot = error_slot.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    if let Ok(mut guard) = samples.lock() {
                        guard.extend(
                            data.iter()
                                .map(|value| (*value as f32 - 32768.0) / 32768.0),
                        );
                    }
                },
                move |error| {
                    if let Ok(mut guard) = error_slot.lock() {
                        *guard = Some(error.to_string());
                    }
                },
                None,
            )
        }
        other => {
            return Err(format!(
                "Формат микрофона {:?} не поддерживается",
                other
            ))
        }
    }
    .map_err(|error| format!("Не удалось начать запись: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Не удалось включить микрофон: {error}"))?;
    std::thread::sleep(Duration::from_secs(8));
    drop(stream);

    if let Ok(guard) = error_slot.lock() {
        if let Some(message) = guard.as_ref() {
            return Err(format!("Ошибка микрофона: {message}"));
        }
    }

    let collected = samples
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    if collected.is_empty() {
        return Err("Микрофон не записал ни одного сэмпла".to_string());
    }

    let mono: Vec<f32> = collected
        .chunks(channels.max(1))
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();

    let pcm = mono
        .into_iter()
        .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect();
    Ok((pcm, sample_rate))
}

fn record_wav_8s() -> Result<Vec<u8>, String> {
    let (samples, sample_rate) = record_pcm_8s()?;
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|error| format!("Не удалось создать WAV: {error}"))?;
        for sample in samples {
            writer
                .write_sample(sample)
                .map_err(|error| format!("Не удалось записать WAV: {error}"))?;
        }
        writer
            .finalize()
            .map_err(|error| format!("Не удалось завершить WAV: {error}"))?;
    }
    Ok(cursor.into_inner())
}
