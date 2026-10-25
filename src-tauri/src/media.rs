use crate::models::{
    DownloadProgress, DownloadResult, ImportPlaylist, ImportTrack, MediaCandidate,
};
use base64::Engine as _;
use lofty::prelude::*;
use regex::Regex;
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
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
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(22))
        .build()
        .map_err(|error| error.to_string())?;

    let mut results: Vec<MediaCandidate> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    match search_zaycev(&client, query).await {
        Ok(mut items) => {
            items.truncate(limit);
            results.append(&mut items);
        }
        Err(error) => failures.push(format!("Zaycev.net: {error}")),
    }
    match search_muzofond(&client, query).await {
        Ok(mut items) => {
            items.truncate(limit);
            results.append(&mut items);
        }
        Err(error) => failures.push(format!("Muzofond.fm: {error}")),
    }
    match search_drivemusic(&client, query).await {
        Ok(mut items) => {
            items.truncate(limit);
            results.append(&mut items);
        }
        Err(error) => failures.push(format!("DriveMusic.me: {error}")),
    }

    let mut seen = HashSet::new();
    results.retain(|item| {
        let key = format!(
            "{}|{}|{}",
            item.title.to_lowercase(),
            item.artist.to_lowercase(),
            item.source
        );
        seen.insert(key)
    });

    if results.is_empty() {
        let details = if failures.is_empty() {
            String::new()
        } else {
            format!(" Причина: {}.", failures.join(" · "))
        };
        return Err(format!(
            "Ничего не найдено на Zaycev, Muzofond и DriveMusic.{details}"
        ));
    }

    // Best available quality first: 320 kbps sources are offered before
    // unknown/128 kbps ones, so a download started from the top row is the
    // highest-quality variant we could find.
    results.sort_by(|a, b| {
        b.bitrate
            .cmp(&a.bitrate)
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.artist.cmp(&b.artist))
            .then_with(|| a.title.cmp(&b.title))
    });
    results.truncate(limit * 3);
    Ok(results)
}

fn media_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(22))
        .build()
        .map_err(|error| error.to_string())
}

async fn search_zaycev(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<MediaCandidate>, String> {
    let mut url = reqwest::Url::parse("https://zaycev.net/search")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("query_search", query)
        .append_pair("type", "all");
    let response = client
        .get(url)
        .header(reqwest::header::REFERER, "https://zaycev.net/")
        .send()
        .await
        .map_err(|error| format!("поиск недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("не удалось прочитать ответ: {error}"))?;

    let link_re = Regex::new(
        r#"(?s)<a href="([^"]+)" title="([^"]*)"[^>]*data-qa="track-link""#,
    )
    .map_err(|error| error.to_string())?;
    let artist_re = Regex::new(
        r#"(?s)<a href="([^"]+)" title="([^"]*)"[^>]*data-qa="artist-link""#,
    )
    .map_err(|error| error.to_string())?;
    let bitrate_re = Regex::new(r#"(?i)content="(\d+)\s*kbps""#)
        .map_err(|error| error.to_string())?;
    let duration_re = Regex::new(r#"(?s)data-qa="track-duration">([^<]+)</time>"#)
        .map_err(|error| error.to_string())?;
    let image_re = Regex::new(r#"(?s)content="([^"]+)" itemProp="thumbnailUrl""#)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for block in html.split(r#"data-qa="track""#).skip(1) {
        let Some(caps) = link_re.captures(block) else {
            continue;
        };
        let path = decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
        if !path.starts_with("/pages/") {
            continue;
        }
        let full_title = decode_html_entities(caps.get(2).map(|m| m.as_str()).unwrap_or_default());
        let artist_hint = artist_re
            .captures(block)
            .and_then(|caps| caps.get(2))
            .map(|m| decode_html_entities(m.as_str()))
            .unwrap_or_default();
        let (artist, mut title) = match full_title.split_once(" - ") {
            Some((left, right)) => (left.trim().to_string(), right.trim().to_string()),
            None => (artist_hint.trim().to_string(), full_title.trim().to_string()),
        };
        if title.is_empty() {
            title = artist_hint.trim().to_string();
        }
        if title.is_empty() {
            continue;
        }
        let artist = if artist.is_empty() {
            "Неизвестный исполнитель".to_string()
        } else {
            artist
        };
        let bitrate = bitrate_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .unwrap_or(320);
        let duration_ms = duration_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| parse_clock_ms(m.as_str()))
            .unwrap_or(0);
        let artwork = image_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| decode_html_entities(m.as_str()));
        let webpage = format!("https://zaycev.net{path}");
        let id = path
            .rsplit('/')
            .next()
            .unwrap_or("track")
            .trim_end_matches(".shtml")
            .to_string();

        items.push(MediaCandidate {
            id: format!("zaycev-{id}"),
            title: title.clone(),
            artist: artist.clone(),
            album: String::new(),
            duration_ms,
            artwork_url: artwork,
            source: "Zaycev.net".to_string(),
            webpage_url: webpage.clone(),
            preview_url: None,
            download_url: Some(webpage),
            query: format!("{artist} {title}"),
            quality: format!("{bitrate} kbps"),
            bitrate,
        });
    }

    if items.is_empty() {
        return Err("поиск не вернул треков".to_string());
    }
    Ok(items)
}

async fn search_muzofond(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<MediaCandidate>, String> {
    let mut url = reqwest::Url::parse("https://muzofond.fm/search")
        .map_err(|error| error.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "не удалось собрать адрес поиска".to_string())?
        .push(query);
    let response = client
        .get(url)
        .header(reqwest::header::REFERER, "https://muzofond.fm/")
        .send()
        .await
        .map_err(|error| format!("поиск недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("не удалось прочитать ответ: {error}"))?;

    let play_re = Regex::new(r#"(?s)class="play"[^>]*data-url="([^"]+)""#)
        .map_err(|error| error.to_string())?;
    let artist_re = Regex::new(r#"(?s)<span class="artist">(.*?)</span>"#)
        .map_err(|error| error.to_string())?;
    let title_re = Regex::new(r#"(?s)<span class="track">(.*?)</span>"#)
        .map_err(|error| error.to_string())?;
    let id_re = Regex::new(r#"data-id="(\d+)""#).map_err(|error| error.to_string())?;
    let duration_re = Regex::new(r#"data-duration="(\d+)""#)
        .map_err(|error| error.to_string())?;
    let image_re = Regex::new(r#"data-img="([^"]+)""#).map_err(|error| error.to_string())?;
    let link_title_re =
        Regex::new(r#"(?s)<a href="https://muzofond\.fm/track/[^"]+"[^>]*title="([^"]*)""#)
            .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for block in html.split(r#"<li class="item""#).skip(1) {
        let Some(caps) = play_re.captures(block) else {
            continue;
        };
        let encoded = decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
        let direct = if encoded.starts_with("http://") || encoded.starts_with("https://") {
            // Muzofond serves the file through its own dl host; the base64
            // suffix is only a routing token, not a URL we need to decode.
            encoded
        } else {
            let Ok(bytes) =
                base64::engine::general_purpose::STANDARD.decode(encoded.trim())
            else {
                continue;
            };
            let Ok(decoded) = String::from_utf8(bytes) else {
                continue;
            };
            decoded
        };
        if !direct.starts_with("http://") && !direct.starts_with("https://") {
            continue;
        }

        let mut title = title_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| clean_html(m.as_str()))
            .unwrap_or_default();
        let artist = artist_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| clean_html(m.as_str()))
            .unwrap_or_default();
        if title.is_empty() {
            if let Some(full) = link_title_re
                .captures(block)
                .and_then(|caps| caps.get(1))
                .map(|m| clean_html(m.as_str()))
            {
                title = full
                    .split_once(" - ")
                    .map(|(_, right)| right.trim().to_string())
                    .unwrap_or(full);
            }
        }
        if title.is_empty() {
            continue;
        }
        let id = id_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        let duration_ms = duration_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .map(|seconds| seconds * 1000)
            .unwrap_or(0);
        let artwork = image_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| {
                let path = decode_html_entities(m.as_str());
                if path.starts_with("http") {
                    path
                } else {
                    format!("https://muzofond.fm{path}")
                }
            });
        let artist = if artist.is_empty() {
            "Неизвестный исполнитель".to_string()
        } else {
            artist
        };

        items.push(MediaCandidate {
            id: if id.is_empty() {
                format!("muzofond-{}", items.len())
            } else {
                format!("muzofond-{id}")
            },
            title: title.clone(),
            artist: artist.clone(),
            album: String::new(),
            duration_ms,
            artwork_url: artwork,
            source: "Muzofond.fm".to_string(),
            webpage_url: if id.is_empty() {
                direct.clone()
            } else {
                format!("https://muzofond.fm/track/{id}")
            },
            preview_url: Some(direct.clone()),
            download_url: Some(direct),
            query: format!("{artist} {title}"),
            quality: "320 kbps".to_string(),
            bitrate: 320,
        });
    }

    if items.is_empty() {
        return Err("поиск не вернул треков".to_string());
    }
    Ok(items)
}

async fn search_drivemusic(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<MediaCandidate>, String> {
    let mut url = reqwest::Url::parse("https://ru.drivemusic.me/")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("do", "search")
        .append_pair("subaction", "search")
        .append_pair("story", query);
    let response = client
        .get(url)
        .header(reqwest::header::REFERER, "https://ru.drivemusic.me/")
        .send()
        .await
        .map_err(|error| format!("поиск недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("не удалось прочитать ответ: {error}"))?;

    let url_re = Regex::new(r#"(?s)data-url="([^"]+)""#).map_err(|error| error.to_string())?;
    let title_re = Regex::new(r#"(?s)class="popular-play-author"[^>]*>(.*?)</a>"#)
        .map_err(|error| error.to_string())?;
    let artist_re =
        Regex::new(r#"(?s)<div class=['"]popular-play-composition['"]>(.*?)</div>"#)
            .map_err(|error| error.to_string())?;
    let quality_re = Regex::new(r#"(?s)class="popular-download-date"[^>]*>(.*?)</div>"#)
        .map_err(|error| error.to_string())?;
    let duration_re = Regex::new(r#"(?s)class="popular-download-number"[^>]*>(.*?)</div>"#)
        .map_err(|error| error.to_string())?;
    let link_re = Regex::new(
        r#"(?s)<a href="([^"]+)" class="popular-download-link""#,
    )
    .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for block in html.split(r#"<div class="music-popular__item">"#).skip(1) {
        let Some(caps) = url_re.captures(block) else {
            continue;
        };
        let direct = decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
        if !direct.starts_with("http") {
            continue;
        }
        let title = title_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| clean_html(m.as_str()))
            .unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        let artist = artist_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| clean_html(m.as_str()))
            .unwrap_or_default();
        let quality = quality_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| clean_html(m.as_str()))
            .unwrap_or_default();
        let bitrate = quality
            .split_whitespace()
            .find_map(|part| part.parse::<i64>().ok())
            .unwrap_or(320);
        let duration_ms = duration_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| parse_clock_ms(&clean_html(m.as_str())))
            .unwrap_or(0);
        let webpage = link_re
            .captures(block)
            .and_then(|caps| caps.get(1))
            .map(|m| decode_html_entities(m.as_str()))
            .map(|path| {
                if path.starts_with("http") {
                    path
                } else {
                    format!("https://ru.drivemusic.me{path}")
                }
            })
            .unwrap_or_else(|| direct.clone());
        let artist = if artist.is_empty() {
            "Неизвестный исполнитель".to_string()
        } else {
            artist
        };

        items.push(MediaCandidate {
            id: format!("drivemusic-{}", items.len()),
            title: title.clone(),
            artist: artist.clone(),
            album: String::new(),
            duration_ms,
            artwork_url: None,
            source: "DriveMusic.me".to_string(),
            webpage_url: webpage,
            preview_url: Some(direct.clone()),
            download_url: Some(direct),
            query: format!("{artist} {title}"),
            quality: if quality.is_empty() {
                format!("{bitrate} kbps")
            } else {
                quality
            },
            bitrate,
        });
    }

    if items.is_empty() {
        return Err("поиск не вернул треков".to_string());
    }
    Ok(items)
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
}

fn clean_html(value: &str) -> String {
    decode_html_entities(&strip_html_tags(value))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(position) = rest.find('&') {
        output.push_str(&rest[..position]);
        let after = &rest[position + 1..];
        if let Some(semicolon) = after.find(';') {
            let entity = &after[..semicolon];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "#39" => Some('\''),
                "#x27" | "#X27" => Some('\''),
                "nbsp" => Some(' '),
                _ => None,
            }
            .or_else(|| {
                if let Some(hex) = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                {
                    u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse::<u32>().ok().and_then(char::from_u32)
                } else {
                    None
                }
            });
            if let Some(character) = decoded {
                output.push(character);
                rest = &after[semicolon + 1..];
                continue;
            }
        }
        output.push('&');
        rest = after;
    }
    output.push_str(rest);
    output
}

fn parse_clock_ms(value: &str) -> i64 {
    let parts: Vec<&str> = value.trim().split(':').collect();
    let seconds = match parts.as_slice() {
        [minutes, seconds] => {
            minutes.parse::<i64>().unwrap_or(0) * 60 + seconds.parse::<i64>().unwrap_or(0)
        }
        [hours, minutes, seconds] => {
            hours.parse::<i64>().unwrap_or(0) * 3600
                + minutes.parse::<i64>().unwrap_or(0) * 60
                + seconds.parse::<i64>().unwrap_or(0)
        }
        _ => 0,
    };
    seconds * 1000
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

    if lower.contains("music.yandex.") {
        return resolve_yandex(url).await;
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

    if lower.contains("vk.com") {
        return Err(
            "VK Музыка требует авторизации. Deezer, YouTube, Яндекс Музыка и прямые ссылки поддерживаются без ключей."
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

    Err("Поддерживаются Deezer, YouTube, Яндекс Музыка и прямые аудио-ссылки. Spotify/Apple/VK требуют ключей или авторизации.".to_string())
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

async fn resolve_yandex(url: &str) -> Result<ImportPlaylist, String> {
    let client = media_client()?;
    let page = client
        .get(url)
        .header(reqwest::header::REFERER, "https://music.yandex.ru/")
        .send()
        .await
        .map_err(|error| format!("Яндекс Музыка недоступна: {error}"))?;
    if !page.status().is_success() {
        return Err(format!("Яндекс Музыка вернула HTTP {}", page.status()));
    }
    let html = page
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать страницу Яндекс Музыки: {error}"))?;

    let meta = find_yandex_playlist_meta(&html).ok_or_else(|| {
        "Не удалось найти данные плейлиста на странице Яндекс Музыки. Проверьте, что ссылка публичная."
            .to_string()
    })?;

    let uid = meta
        .get("uid")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| "Яндекс Музыка: не удалось определить владельца плейлиста".to_string())?;
    let kind = meta
        .get("kind")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| "Яндекс Музыка: не удалось определить номер плейлиста".to_string())?;
    let fallback_title = meta
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Яндекс Музыка")
        .to_string();

    let api = format!("https://api.music.yandex.net/users/{uid}/playlists/{kind}");
    let response = client
        .get(&api)
        .header(reqwest::header::REFERER, "https://music.yandex.ru/")
        .send()
        .await
        .map_err(|error| format!("API Яндекс Музыки недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "API Яндекс Музыки вернул HTTP {}",
            response.status()
        ));
    }
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Яндекс Музыка вернула некорректный ответ: {error}"))?;
    let result = json
        .get("result")
        .ok_or_else(|| "Яндекс Музыка не вернула плейлист".to_string())?;
    let title = result
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or(&fallback_title)
        .to_string();
    let items = result
        .get("tracks")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "В плейлисте Яндекс Музыки нет треков".to_string())?;

    let mut tracks = Vec::new();
    for item in items {
        let track = item.get("track").unwrap_or(item);
        if track.is_null() {
            continue;
        }
        let track_title = track
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if track_title.is_empty() {
            continue;
        }
        let artist = track
            .get("artists")
            .and_then(|value| value.as_array())
            .map(|artists| {
                artists
                    .iter()
                    .filter_map(|artist| artist.get("name").and_then(|value| value.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let artist = if artist.is_empty() {
            "Неизвестный исполнитель".to_string()
        } else {
            artist
        };
        let album = track
            .get("albums")
            .and_then(|value| value.as_array())
            .and_then(|albums| albums.first())
            .and_then(|album| album.get("title"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        let album_id = track
            .get("albums")
            .and_then(|value| value.as_array())
            .and_then(|albums| albums.first())
            .and_then(|album| album.get("id"))
            .and_then(|value| value.as_i64());
        let track_id = track
            .get("id")
            .and_then(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| value.as_i64().map(|id| id.to_string()))
            })
            .unwrap_or_default();
        let source_url = match (album_id, track_id.is_empty()) {
            (Some(album), false) => {
                format!("https://music.yandex.ru/album/{album}/track/{track_id}")
            }
            (None, false) => format!("https://music.yandex.ru/track/{track_id}"),
            _ => url.to_string(),
        };
        tracks.push(ImportTrack {
            title: track_title.clone(),
            artist: artist.clone(),
            album,
            duration_ms: track
                .get("durationMs")
                .and_then(|value| value.as_i64())
                .unwrap_or(0),
            source_url,
            preview_url: None,
            download_url: None,
            query: format!("{artist} {track_title}"),
        });
    }

    if tracks.is_empty() {
        return Err("В плейлисте Яндекс Музыки не найдено доступных треков".to_string());
    }

    Ok(ImportPlaylist {
        title,
        source: "Яндекс Музыка".to_string(),
        tracks,
    })
}

fn state_patch_arrays(html: &str) -> Vec<serde_json::Value> {
    let mut arrays = Vec::new();
    let mut cursor = 0usize;
    while let Some(relative) = html[cursor..].find("__STATE_PATCHES__") {
        let after = cursor + relative;
        let Some(push) = html[after..].find("push(") else {
            break;
        };
        let mut start = after + push + 5;
        while start < html.len() && html.as_bytes()[start] != b'[' {
            start += 1;
        }
        if start >= html.len() {
            break;
        }
        let bytes = html.as_bytes();
        let mut depth = 0i32;
        let mut in_string = false;
        let mut escaped = false;
        let mut end = None;
        let mut index = start;
        while index < bytes.len() {
            let character = bytes[index];
            if in_string {
                if escaped {
                    escaped = false;
                } else if character == b'\\' {
                    escaped = true;
                } else if character == b'"' {
                    in_string = false;
                }
            } else {
                match character {
                    b'"' => in_string = true,
                    b'[' => depth += 1,
                    b']' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(index);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            index += 1;
        }
        let Some(end) = end else {
            break;
        };
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&html[start..end + 1]) {
            arrays.push(value);
        }
        cursor = end + 1;
    }
    arrays
}

fn find_yandex_playlist_meta(html: &str) -> Option<serde_json::Value> {
    for array in state_patch_arrays(html) {
        let Some(operations) = array.as_array() else {
            continue;
        };
        for operation in operations {
            if operation.get("path").and_then(|value| value.as_str())
                == Some("/playlist/meta")
            {
                return operation.get("value").cloned();
            }
        }
    }
    None
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

    let mut ytdlp_error = None;
    match run_ytdlp(app, args, ytdlp_path).await {
        Ok((stdout, stderr)) => match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            Ok(json) => {
                if let Some(playlist) = youtube_playlist_from_json(&json, url) {
                    return Ok(playlist);
                }
            }
            Err(error) => {
                ytdlp_error = Some(format!(
                    "Не удалось разобрать ответ YouTube: {error} · {stderr}"
                ));
            }
        },
        Err(error) => ytdlp_error = Some(error),
    }

    if is_single_youtube(url) {
        return resolve_youtube_noembed(url).await.map_err(|fallback_error| {
            match ytdlp_error {
                Some(primary) => format!("{primary} · {fallback_error}"),
                None => fallback_error,
            }
        });
    }

    Err(ytdlp_error.unwrap_or_else(|| "YouTube не вернул треков".to_string()))
}

fn youtube_playlist_from_json(
    json: &serde_json::Value,
    url: &str,
) -> Option<ImportPlaylist> {
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
        let raw_title = json.get("title").and_then(|value| value.as_str())?;
        if raw_title.trim().is_empty() {
            return None;
        }
        let uploader = json
            .get("uploader")
            .or_else(|| json.get("channel"))
            .and_then(|value| value.as_str())
            .unwrap_or("YouTube")
            .to_string();
        let (artist, title) = split_media_title(raw_title, &uploader);
        let webpage = json
            .get("webpage_url")
            .and_then(|value| value.as_str())
            .unwrap_or(url)
            .to_string();
        tracks.push(ImportTrack {
            title: title.clone(),
            artist: artist.clone(),
            album: String::new(),
            duration_ms: json
                .get("duration")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0) as i64
                * 1000,
            source_url: webpage.clone(),
            preview_url: None,
            download_url: Some(webpage),
            query: format!("{artist} {title}"),
        });
    } else {
        for entry in entries {
            if entry.is_null() {
                continue;
            }
            let raw_title = entry
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if raw_title.trim().is_empty() {
                continue;
            }
            let uploader = entry
                .get("uploader")
                .or_else(|| entry.get("channel"))
                .and_then(|value| value.as_str())
                .unwrap_or("YouTube")
                .to_string();
            let (artist, title) = split_media_title(raw_title, &uploader);
            let webpage = entry
                .get("webpage_url")
                .and_then(|value| value.as_str())
                .or_else(|| entry.get("url").and_then(|value| value.as_str()))
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
                artist: artist.clone(),
                album: String::new(),
                duration_ms: entry
                    .get("duration")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0) as i64
                    * 1000,
                source_url: webpage.clone(),
                preview_url: None,
                download_url: Some(webpage),
                query: format!("{artist} {title}"),
            });
        }
    }

    if tracks.is_empty() {
        return None;
    }

    Some(ImportPlaylist {
        title: playlist_title,
        source: "YouTube".to_string(),
        tracks,
    })
}

async fn resolve_youtube_noembed(url: &str) -> Result<ImportPlaylist, String> {
    let client = media_client()?;
    let mut api = reqwest::Url::parse("https://noembed.com/embed")
        .map_err(|error| error.to_string())?;
    api.query_pairs_mut().append_pair("url", url);
    let response = client
        .get(api)
        .send()
        .await
        .map_err(|error| format!("YouTube недоступен: {error}"))?;
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ YouTube: {error}"))?;
    if let Some(error) = json.get("error").and_then(|value| value.as_str()) {
        return Err(format!("YouTube: {error}"));
    }
    let raw_title = json
        .get("title")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "YouTube не вернул название видео".to_string())?;
    let uploader = json
        .get("author_name")
        .and_then(|value| value.as_str())
        .unwrap_or("YouTube");
    let (artist, title) = split_media_title(raw_title, uploader);
    let webpage = json
        .get("url")
        .and_then(|value| value.as_str())
        .unwrap_or(url)
        .to_string();

    Ok(ImportPlaylist {
        title: format!("{artist} – {title}"),
        source: "YouTube".to_string(),
        tracks: vec![ImportTrack {
            title: title.clone(),
            artist: artist.clone(),
            album: String::new(),
            duration_ms: 0,
            source_url: webpage.clone(),
            preview_url: None,
            download_url: Some(webpage),
            query: format!("{artist} {title}"),
        }],
    })
}

fn split_media_title(raw_title: &str, fallback_artist: &str) -> (String, String) {
    let uploader = fallback_artist
        .trim()
        .trim_end_matches(" - Topic")
        .trim()
        .to_string();
    for separator in [" - ", " \u{2013} ", " \u{2014} "] {
        if let Some((left, right)) = raw_title.split_once(separator) {
            let left = left.trim();
            let right = right.trim();
            if !left.is_empty() && !right.is_empty() {
                return (left.to_string(), right.to_string());
            }
        }
    }
    (
        if uploader.is_empty() {
            "Неизвестный исполнитель".to_string()
        } else {
            uploader
        },
        raw_title.trim().to_string(),
    )
}

fn is_single_youtube(url: &str) -> bool {
    let lower = url.to_lowercase();
    if lower.contains("list=") || lower.contains("/playlist") {
        return false;
    }
    lower.contains("youtu.be/")
        || lower.contains("youtube.com/watch")
        || lower.contains("youtube.com/shorts/")
        || lower.contains("youtube.com/live/")
}

fn normalize_match(value: &str) -> String {
    value
        .to_lowercase()
        .replace('ё', "е")
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn match_tokens(value: &str) -> HashSet<String> {
    normalize_match(value)
        .split(' ')
        .filter(|token| {
            token.chars().count() > 1
                && !matches!(
                    *token,
                    "the"
                        | "a"
                        | "an"
                        | "and"
                        | "amp"
                        | "feat"
                        | "ft"
                        | "prod"
                        | "by"
                        | "remix"
                        | "version"
                        | "edit"
                        | "official"
                        | "video"
                        | "audio"
                        | "lyrics"
                        | "topic"
                        | "music"
                        | "me"
                        | "of"
                        | "to"
                        | "in"
                        | "on"
                        | "for"
                        | "with"
                )
        })
        .map(str::to_string)
        .collect()
}

fn text_match_score(expected: &str, actual: &str) -> f64 {
    let left = normalize_match(expected);
    let right = normalize_match(actual);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right || left.contains(&right) || right.contains(&left) {
        return 1.0;
    }

    let left_tokens = match_tokens(&left);
    let right_tokens = match_tokens(&right);
    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }
    let common = left_tokens.intersection(&right_tokens).count();
    common as f64 / left_tokens.len().min(right_tokens.len()) as f64
}

fn verify_download(
    path: &Path,
    expected_artist: Option<&str>,
    expected_title: Option<&str>,
) -> Result<(), String> {
    let Some(expected_title) = expected_title.map(str::trim).filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let Ok(tagged) = lofty::read_from_path(path) else {
        return Ok(());
    };
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Ok(());
    };
    let actual_title = tag
        .title()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(actual_title) = actual_title else {
        return Ok(());
    };
    let actual_artist = tag
        .artist()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let title_score = text_match_score(expected_title, &actual_title);
    let artist_score = expected_artist
        .map(|artist| text_match_score(artist, actual_artist.as_deref().unwrap_or_default()))
        .unwrap_or(0.0);
    if title_score >= 0.55 || (artist_score >= 0.8 && title_score >= 0.3) {
        return Ok(());
    }

    let found = match actual_artist {
        Some(artist) => format!("{artist} – {actual_title}"),
        None => actual_title,
    };
    let _ = fs::remove_file(path);
    Err(format!(
        "Источник вернул другой трек: {found}. Файл не сохранён."
    ))
}

pub async fn download_media(
    app: &AppHandle,
    id: String,
    url: String,
    query: Option<String>,
    output_dir: String,
    ytdlp_path: Option<String>,
    expected_artist: Option<String>,
    expected_title: Option<String>,
) -> Result<DownloadResult, String> {
    let preferred_name = query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if url.contains("zaycev.net/pages/")
        || url.contains(".muzofond.fm/")
        || url.contains(".drivemusic.me/")
        || is_audio_url(&url)
    {
        return download_direct(
            app,
            id,
            url,
            output_dir,
            preferred_name,
            expected_artist,
            expected_title,
        )
        .await;
    }

    let directory = resolve_output_dir(app, &output_dir)?;
    let directory_string = directory.to_string_lossy().to_string();
    let started_at = now_secs();

    let target = match preferred_name.as_deref() {
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
        "bestaudio/best".to_string(),
        "-S".to_string(),
        "abr".to_string(),
        "--audio-quality".to_string(),
        "0".to_string(),
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
            if let Err(error) = verify_download(
                Path::new(&path),
                expected_artist.as_deref(),
                expected_title.as_deref(),
            ) {
                emit_progress(
                    app,
                    DownloadProgress {
                        id: id.clone(),
                        percent: 0.0,
                        line: error.clone(),
                        status: "error".to_string(),
                        path: None,
                        error: Some(error.clone()),
                    },
                );
                return Err(error);
            }
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
    expected_artist: Option<String>,
    expected_title: Option<String>,
) -> Result<DownloadResult, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Ссылка должна начинаться с http:// или https://".to_string());
    }
    let directory = resolve_output_dir(app, &output_dir)?;
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;

    let (target, referer) = if url.contains("zaycev.net/pages/") {
        (
            resolve_zaycev_stream(&client, &url).await?,
            Some("https://zaycev.net/"),
        )
    } else if url.contains("muzofond.fm") {
        (url.clone(), Some("https://muzofond.fm/"))
    } else if url.contains("drivemusic.me") {
        (url.clone(), Some("https://ru.drivemusic.me/"))
    } else {
        (url.clone(), None)
    };

    let mut request = client.get(&target);
    if let Some(referer) = referer {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let mut response = request
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
    let content_length = response.content_length();

    let extension = guess_extension(&target, &content_type);
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

    let mut file = fs::File::create(&path)
        .map_err(|error| format!("Не удалось создать файл: {error}"))?;
    let mut received = 0u64;
    let mut last_percent = -1.0f64;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(error) => {
                drop(file);
                let _ = fs::remove_file(&path);
                return Err(format!("Ошибка чтения файла: {error}"));
            }
        };
        if let Err(error) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(format!("Не удалось записать файл: {error}"));
        }
        received += chunk.len() as u64;
        if let Some(total) = content_length.filter(|value| *value > 0) {
            let percent = (received as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
            if percent - last_percent >= 2.0 || percent >= 99.9 {
                last_percent = percent;
                emit_progress(
                    app,
                    DownloadProgress {
                        id: id.clone(),
                        percent,
                        line: format!("Скачивание… {}%", percent.round()),
                        status: "downloading".to_string(),
                        path: None,
                        error: None,
                    },
                );
            }
        }
    }
    if let Err(error) = file.flush() {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("Не удалось завершить файл: {error}"));
    }
    drop(file);
    if let Err(error) = verify_download(
        &path,
        expected_artist.as_deref(),
        expected_title.as_deref(),
    ) {
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
        return Err(error);
    }
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

async fn resolve_zaycev_stream(
    client: &reqwest::Client,
    page_url: &str,
) -> Result<String, String> {
    let without_query = page_url.split('?').next().unwrap_or(page_url);
    let id = without_query
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .trim_end_matches(".shtml")
        .to_string();
    if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Не удалось определить ID трека Zaycev".to_string());
    }

    let meta = client
        .post("https://zaycev.net/api/external/track/filezmeta")
        .header(reqwest::header::REFERER, page_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&json!({
            "trackIds": [id],
            "subscription": false
        }))
        .send()
        .await
        .map_err(|error| format!("Zaycev: не удалось запросить поток: {error}"))?;
    if !meta.status().is_success() {
        return Err(format!("Zaycev вернул HTTP {}", meta.status()));
    }
    let meta_json = meta
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Zaycev: некорректный ответ: {error}"))?;
    let token = meta_json
        .get("tracks")
        .and_then(|value| value.as_array())
        .and_then(|tracks| tracks.first())
        .and_then(|track| track.get("streaming"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Zaycev не отдал поток для этого трека".to_string())?;

    let play = client
        .get(format!(
            "https://zaycev.net/api/external/track/play/{token}"
        ))
        .header(reqwest::header::REFERER, "https://zaycev.net/")
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Zaycev: не удалось получить ссылку: {error}"))?;
    if !play.status().is_success() {
        return Err(format!("Zaycev вернул HTTP {}", play.status()));
    }
    let play_json = play
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Zaycev: некорректный ответ со ссылкой: {error}"))?;
    play_json
        .get("url")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Zaycev не вернул ссылку на аудио".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_yandex_playlist_meta_in_state_patches() {
        let html = r#"<script>(window.__STATE_PATCHES__ = window.__STATE_PATCHES__ || []).push([{"op":"replace","path":"\u002Fplaylist\u002Fmeta","value":{"uid":955066455,"kind":3,"title":"Test"}}]);</script>"#;
        let meta = find_yandex_playlist_meta(html).expect("meta");
        assert_eq!(meta.get("uid").and_then(|value| value.as_i64()), Some(955066455));
        assert_eq!(meta.get("kind").and_then(|value| value.as_i64()), Some(3));
        assert_eq!(meta.get("title").and_then(|value| value.as_str()), Some("Test"));
    }

    #[test]
    fn splits_artist_and_title() {
        assert_eq!(
            split_media_title("Norma Tale - Ван Хельсинг", "YouTube"),
            ("Norma Tale".to_string(), "Ван Хельсинг".to_string())
        );
        assert_eq!(
            split_media_title("Ван Хельсинг", "Norma Tale - Topic"),
            ("Norma Tale".to_string(), "Ван Хельсинг".to_string())
        );
    }

    #[test]
    fn parses_clock_duration() {
        assert_eq!(parse_clock_ms("03:42"), 222_000);
        assert_eq!(parse_clock_ms("1:02:03"), 3_723_000);
    }

    #[test]
    fn recognizes_matching_download_metadata() {
        assert!(text_match_score("Stream", "NLO - Stream") > 0.9);
        assert!(text_match_score("Leave It All Behind", "Leave It All Behind (Remix)") > 0.9);
        assert!(text_match_score("MiyaGi & Andy Panda", "MiyaGi") > 0.9);
        assert!(text_match_score("Stream", "Leave It All Behind") < 0.2);
        assert!(text_match_score("NLO", "EBEN") < 0.2);
    }
}
