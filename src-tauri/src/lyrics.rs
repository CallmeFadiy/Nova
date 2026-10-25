use crate::models::{LyricsFile, LyricsResult};
use crate::AppState;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

fn source_suffix_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\s*[\(\[]\s*[^\)\]]*(?:musmore|topde|sefon|muzish|drive\s*music|drivemusic|telegram|слив|zvuk|zaycev|mp3)[^\)\]]*[\)\]]",
        )
        .expect("valid source suffix regex")
    })
}

fn trailing_number_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\s*\(\d{1,2}\)\s*$").expect("valid trailing number regex"))
}

fn clean_metadata(value: &str) -> String {
    let mut cleaned = value.replace('_', " ").replace('\u{00a0}', " ");
    for _ in 0..3 {
        let next = source_suffix_regex()
            .replace_all(&cleaned, " ")
            .to_string();
        if next == cleaned {
            break;
        }
        cleaned = next;
    }
    cleaned = trailing_number_regex().replace(&cleaned, "").to_string();
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn sanitize_file_stem(value: &str) -> String {
    let mut output: String = value
        .chars()
        .map(|character| {
            if "\\/:*?\"<>|".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    output = output.trim().trim_matches('.').to_string();
    if output.chars().count() > 150 {
        output = output.chars().take(150).collect();
    }
    if output.is_empty() {
        output = "track".to_string();
    }
    output
}

fn lyrics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("lyrics");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

pub async fn get_lyrics(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<LyricsResult, String> {
    let (raw_title, raw_artist) = {
        let conn = state.db.lock().map_err(|error| error.to_string())?;
        conn.query_row(
            "SELECT title, artist FROM tracks WHERE id = ?1",
            [track_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|error| format!("Трек не найден: {error}"))?
    };

    let title = clean_metadata(&raw_title);
    let artist = clean_metadata(&raw_artist);
    let display_title = if title.is_empty() {
        raw_title.trim().to_string()
    } else {
        title.clone()
    };
    let display_artist = if artist.is_empty() {
        raw_artist.trim().to_string()
    } else {
        artist.clone()
    };
    let stem = if display_artist.is_empty() {
        display_title.clone()
    } else {
        format!("{display_artist} - {display_title}")
    };
    let file_name = format!("{}.txt", sanitize_file_stem(&stem));
    let directory = lyrics_dir(&app)?;
    let path = directory.join(&file_name);

    if path.is_file() {
        if let Ok(text) = fs::read_to_string(&path) {
            if !text.trim().is_empty() {
                return Ok(LyricsResult {
                    track_id,
                    title: display_title,
                    artist: display_artist,
                    file_name,
                    path: path.to_string_lossy().to_string(),
                    text,
                    source_url: None,
                    cached: true,
                });
            }
        }
    }

    let (text, source_url) = genius_lookup(&display_artist, &display_title).await?;
    fs::write(&path, &text).map_err(|error| format!("Не удалось сохранить текст: {error}"))?;

    Ok(LyricsResult {
        track_id,
        title: display_title,
        artist: display_artist,
        file_name,
        path: path.to_string_lossy().to_string(),
        text,
        source_url,
        cached: false,
    })
}

async fn genius_lookup(
    artist: &str,
    title: &str,
) -> Result<(String, Option<String>), String> {
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(28))
        .build()
        .map_err(|error| error.to_string())?;

    let query = format!("{artist} {title}")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut search_url = reqwest::Url::parse("https://genius.com/api/search/multi")
        .map_err(|error| error.to_string())?;
    search_url.query_pairs_mut().append_pair("q", &query);
    let response = client
        .get(search_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Genius недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Genius вернул HTTP {}", response.status()));
    }
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Genius вернул некорректный ответ: {error}"))?;

    let mut candidates: Vec<(i64, String)> = Vec::new();
    if let Some(sections) = json
        .get("response")
        .and_then(|value| value.get("sections"))
        .and_then(|value| value.as_array())
    {
        for section in sections {
            let Some(hits) = section.get("hits").and_then(|value| value.as_array()) else {
                continue;
            };
            for hit in hits {
                let Some(result) = hit.get("result") else {
                    continue;
                };
                let Some(url) = result.get("url").and_then(|value| value.as_str()) else {
                    continue;
                };
                if !url.starts_with("https://genius.com/") {
                    continue;
                }
                let result_title = result
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                let result_artist = result
                    .get("primary_artist")
                    .and_then(|value| value.get("name"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                let mut score = 0i64;
                let artist_key = match_key(artist);
                let result_artist_key = match_key(result_artist);
                if !artist_key.is_empty() && !result_artist_key.is_empty() {
                    if artist_key == result_artist_key {
                        score += 40;
                    } else if artist_key.contains(&result_artist_key)
                        || result_artist_key.contains(&artist_key)
                    {
                        score += 22;
                    }
                }
                let title_key = match_key(title);
                let result_title_key = match_key(result_title);
                if !title_key.is_empty() && !result_title_key.is_empty() {
                    if title_key == result_title_key {
                        score += 30;
                    } else if title_key.contains(&result_title_key)
                        || result_title_key.contains(&title_key)
                    {
                        score += 15;
                    }
                }
                if score <= 0 {
                    score = 1;
                }
                if !candidates.iter().any(|(_, existing)| existing == url) {
                    candidates.push((score, url.to_string()));
                }
            }
        }
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let chosen = candidates
        .first()
        .map(|(_, url)| url.clone())
        .ok_or_else(|| "Genius не нашёл текст этой песни".to_string())?;

    let page = client
        .get(&chosen)
        .header(reqwest::header::REFERER, "https://genius.com/")
        .header(reqwest::header::ACCEPT_LANGUAGE, "ru,en;q=0.8")
        .send()
        .await
        .map_err(|error| format!("Не удалось открыть страницу Genius: {error}"))?;
    if !page.status().is_success() {
        return Err(format!("Genius вернул HTTP {}", page.status()));
    }
    let html = page
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать страницу Genius: {error}"))?;
    let text = extract_lyrics(&html)
        .ok_or_else(|| "Genius нашёл страницу, но текст песни не распознан".to_string())?;

    Ok((text, Some(chosen)))
}

fn match_key(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn extract_lyrics(html: &str) -> Option<String> {
    let marker = "data-lyrics-container=\"true\"";
    let mut search_from = 0usize;
    let mut parts: Vec<String> = Vec::new();

    while let Some(relative) = html[search_from..].find(marker) {
        let marker_start = search_from + relative;
        let open_end = match html[marker_start..].find('>') {
            Some(value) => marker_start + value,
            None => break,
        };
        let content_start = open_end + 1;
        let Some(content) = matching_div_content(&html[content_start..]) else {
            break;
        };
        let text = lyrics_html_to_text(content);
        if !text.is_empty() {
            parts.push(text);
        }
        search_from = content_start + content.len();
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn matching_div_content(fragment: &str) -> Option<&str> {
    let mut depth = 1i32;
    let mut position = 0usize;
    while position < fragment.len() {
        let Some(relative) = fragment[position..].find('<') else {
            return None;
        };
        let tag_start = position + relative;
        let Some(relative_end) = fragment[tag_start..].find('>') else {
            return None;
        };
        let tag_end = tag_start + relative_end;
        let tag = &fragment[tag_start + 1..tag_end];
        let lower = tag.to_lowercase();
        if lower.starts_with("div") && !lower.ends_with('/') {
            depth += 1;
        } else if lower.starts_with("/div") {
            depth -= 1;
            if depth == 0 {
                return Some(&fragment[..tag_start]);
            }
        }
        position = tag_end + 1;
    }
    None
}

fn lyrics_html_to_text(fragment: &str) -> String {
    let mut output = String::new();
    let mut position = 0usize;
    let mut skip_depth = 0usize;

    while position < fragment.len() {
        if fragment.as_bytes()[position] == b'<' {
            let Some(relative_end) = fragment[position..].find('>') else {
                break;
            };
            let tag_end = position + relative_end;
            let tag = &fragment[position + 1..tag_end];
            let lower = tag.to_lowercase();
            let is_closing_div = lower.starts_with("/div");
            let is_div = !is_closing_div && lower.starts_with("div");

            if is_div {
                if lower.contains("data-exclude-from-selection=\"true\"") {
                    skip_depth += 1;
                } else if skip_depth > 0 {
                    skip_depth += 1;
                } else {
                    output.push('\n');
                }
            } else if is_closing_div {
                if skip_depth > 0 {
                    skip_depth -= 1;
                } else {
                    output.push('\n');
                }
            } else if skip_depth == 0 {
                if lower.starts_with("br") {
                    output.push('\n');
                } else if lower.starts_with("p") || lower.starts_with("/p") {
                    output.push('\n');
                }
            }
            position = tag_end + 1;
        } else {
            let next = fragment[position..]
                .find('<')
                .map(|relative| position + relative)
                .unwrap_or(fragment.len());
            if skip_depth == 0 {
                output.push_str(&fragment[position..next]);
            }
            position = next;
        }
    }

    normalize_lyrics(&decode_html_entities(&output))
}

fn normalize_lyrics(value: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blank = 0usize;
    for line in value.replace('\r', "").replace('\u{200b}', "").split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blank += 1;
            if blank == 1 && !lines.is_empty() {
                lines.push(String::new());
            }
            continue;
        }
        if trimmed == "You might also like" || trimmed == "Embed" {
            continue;
        }
        blank = 0;
        lines.push(trimmed.to_string());
    }
    while lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    let mut result = lines.join("\n");
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    result.trim().to_string()
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
                } else if let Some(decimal) = entity.strip_prefix('#') {
                    decimal.parse::<u32>().ok().and_then(char::from_u32)
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

pub fn list(app: &AppHandle) -> Result<Vec<LyricsFile>, String> {
    let directory = lyrics_dir(app)?;
    let mut files = Vec::new();
    let entries = match fs::read_dir(&directory) {
        Ok(value) => value,
        Err(_) => return Ok(files),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file()
            || path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("txt"))
                .unwrap_or(true)
        {
            continue;
        }
        let Some(file_name) = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
        else {
            continue;
        };
        let metadata = entry.metadata().ok();
        let size = metadata.as_ref().map(|value| value.len() as i64).unwrap_or(0);
        let modified = metadata
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs() as i64)
            .unwrap_or(0);
        let title = path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        files.push(LyricsFile {
            file_name,
            title,
            path: path.to_string_lossy().to_string(),
            size,
            modified,
        });
    }
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

pub fn delete(app: &AppHandle, file_name: &str) -> Result<(), String> {
    let Some(name) = Path::new(file_name).file_name() else {
        return Err("Некорректное имя файла".to_string());
    };
    if Path::new(file_name).components().count() != 1 {
        return Err("Некорректное имя файла".to_string());
    }
    if !name
        .to_string_lossy()
        .to_lowercase()
        .ends_with(".txt")
    {
        return Err("Можно удалять только текстовые файлы кэша".to_string());
    }
    let path = lyrics_dir(app)?.join(name);
    if path.is_file() {
        fs::remove_file(&path).map_err(|error| format!("Не удалось удалить файл: {error}"))?;
    }
    Ok(())
}

pub fn clear(app: &AppHandle) -> Result<usize, String> {
    let directory = lyrics_dir(app)?;
    let mut removed = 0usize;
    let entries = match fs::read_dir(&directory) {
        Ok(value) => value,
        Err(_) => return Ok(0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("txt"))
                .unwrap_or(false)
        {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_lyrics_and_skips_header() {
        let html = r#"<div data-lyrics-container="true" class="x"><div data-exclude-from-selection="true"><h2>Song Lyrics</h2><span>1 Contributor</span></div>[Куплет 1]<br/>Первая строка<br/><br/>Вторая строка</div>"#;
        let text = extract_lyrics(html).expect("lyrics");
        assert!(text.contains("Первая строка"));
        assert!(text.contains("Вторая строка"));
        assert!(!text.contains("Contributor"));
        assert!(!text.contains("Song Lyrics"));
    }

    #[test]
    fn cleans_source_suffixes_from_track_name() {
        assert_eq!(
            clean_metadata("Ван Хельсинг (Sefon.Pro)"),
            "Ван Хельсинг"
        );
        assert_eq!(
            clean_metadata("Asper_X_-_Sgorayu_(musmore.org)"),
            "Asper X - Sgorayu"
        );
        assert_eq!(clean_metadata("Галопериод (СЛИВ Telegram) (1)"), "Галопериод");
    }
}
