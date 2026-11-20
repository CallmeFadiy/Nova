#[cfg(target_os = "android")]
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[cfg(target_os = "android")]
const REPO: &str = "CallmeFadiy/Nova";
const RELEASE_PREFIX: &str = "https://github.com/CallmeFadiy/Nova/releases/download/";
const USER_AGENT: &str = "Nova-Updater";

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    pub tag: String,
    pub notes: String,
    pub asset_name: String,
    pub asset_url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: u64,
}

#[cfg(target_os = "android")]
fn version_of(tag: &str) -> Option<semver::Version> {
    semver::Version::parse(tag.trim().trim_start_matches('v')).ok()
}

#[cfg(target_os = "android")]
fn pick_apk(release: &Release) -> Option<&ReleaseAsset> {
    release
        .assets
        .iter()
        .filter(|asset| {
            let name = asset.name.to_ascii_lowercase();
            name.ends_with(".apk")
                && (name.contains("android") || name.contains("arm64"))
        })
        .max_by_key(|asset| asset.size)
}

/// Checks the latest stable GitHub release. Android-only; Windows keeps the
/// installer flow.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Ok(None);
    }

    #[cfg(target_os = "android")]
    {
        let current = app.package_info().version.to_string();
        let client = crate::http::client_builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| format!("Не удалось создать HTTP-клиент: {error}"))?;
        let release: Release = client
            .get(format!(
                "https://api.github.com/repos/{REPO}/releases/latest"
            ))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| format!("Не удалось проверить обновления: {error}"))?
            .error_for_status()
            .map_err(|error| format!("GitHub вернул ошибку: {error}"))?
            .json()
            .await
            .map_err(|error| format!("Не удалось разобрать ответ GitHub: {error}"))?;

        if release.draft || release.prerelease {
            return Ok(None);
        }
        let Some(latest) = version_of(&release.tag_name) else {
            return Ok(None);
        };
        let Some(installed) = semver::Version::parse(&current).ok() else {
            return Ok(None);
        };
        if latest <= installed {
            return Ok(None);
        }
        let Some(asset) = pick_apk(&release) else {
            return Err("В последнем релизе нет APK для Android".to_string());
        };
        let sha256 = asset.digest.as_deref().and_then(|digest| {
            digest
                .strip_prefix("sha256:")
                .map(|value| value.to_ascii_lowercase())
        });

        Ok(Some(UpdateInfo {
            current_version: current,
            version: latest.to_string(),
            tag: release.tag_name.clone(),
            notes: release.body.clone().unwrap_or_default(),
            asset_name: asset.name.clone(),
            asset_url: asset.browser_download_url.clone(),
            size: asset.size,
            sha256,
        }))
    }
}

/// Downloads an APK into the app cache, reports progress and verifies the
/// published SHA-256 digest when GitHub provides one.
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    url: String,
    name: String,
    sha256: Option<String>,
) -> Result<String, String> {
    if !url.starts_with(RELEASE_PREFIX) {
        return Err("Обновление должно скачиваться из GitHub Releases Nova".to_string());
    }
    let safe_name = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if !safe_name.to_ascii_lowercase().ends_with(".apk") {
        return Err("В релизе нет APK-файла".to_string());
    }

    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Не удалось получить кэш: {error}"))?
        .join("updates");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("Не удалось создать папку обновлений: {error}"))?;
    let path = directory.join(&safe_name);
    let temp_path = directory.join(format!("{safe_name}.part"));

    let client = crate::http::client_builder()
        .user_agent(USER_AGENT)
        // The APK is tens of megabytes; a weak Wi-Fi link may need minutes.
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|error| format!("Не удалось создать HTTP-клиент: {error}"))?;
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Не удалось скачать обновление: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub вернул ошибку загрузки: {error}"))?;
    let total = response.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|error| format!("Не удалось создать файл обновления: {error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Ошибка загрузки обновления: {error}"))?
    {
        if let Err(error) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(format!("Не удалось записать обновление: {error}"));
        }
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "update-progress",
            UpdateProgress {
                downloaded,
                total,
            },
        );
    }
    if let Err(error) = file.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Не удалось сохранить обновление: {error}"));
    }
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if let Some(expected) = sha256 {
        if actual != expected.to_ascii_lowercase() {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err("SHA-256 обновления не совпадает".to_string());
        }
    }
    if let Err(error) = tokio::fs::rename(&temp_path, &path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Не удалось подготовить обновление: {error}"));
    }

    // Keep only the APK that was just verified; old downloads are large.
    if let Ok(mut entries) = tokio::fs::read_dir(&directory).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let candidate = entry.path();
            let is_apk = candidate
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("apk"));
            if is_apk && candidate != path {
                let _ = tokio::fs::remove_file(candidate).await;
            }
        }
    }

    Ok(path.to_string_lossy().to_string())
}

/// Verifies the package/version/signing certificate in Kotlin, then opens the
/// Android installer. Returns `{ needsPermission: true }` when the user must
/// allow installs from Nova in system settings first.
#[tauri::command]
pub fn update_install(
    app: AppHandle,
    path: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(serde::Serialize)]
        struct InstallPayload<'a> {
            path: &'a str,
        }

        let value: serde_json::Value = crate::commands::run_mobile_command(
            &app,
            "installApk",
            InstallPayload { path: &path },
        )?;
        Ok(value)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        Err("Автообновление доступно только на Android".to_string())
    }
}
