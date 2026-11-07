use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DATA_ENTRIES: [&str; 3] = ["covers", "backgrounds", "lyrics"];

pub fn migrate_if_needed(app_dir: &Path) -> Result<(), String> {
    if std::env::var_os("NOVA_DATA_DIR").is_some() {
        return Ok(());
    }
    if app_dir.join("nova.db").is_file() {
        return Ok(());
    }

    let Some(appdata) = std::env::var_os("APPDATA") else {
        return Ok(());
    };
    if let Some(legacy) = find_legacy_dir(Path::new(&appdata), app_dir) {
        copy_legacy_data(&legacy, app_dir)?;
    }
    Ok(())
}

fn find_legacy_dir(appdata: &Path, target: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(appdata).ok()?;
    let mut best: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path == target || !path.join("nova.db").is_file() {
            continue;
        }
        if !DATA_ENTRIES
            .iter()
            .any(|name| path.join(name).is_dir())
        {
            continue;
        }
        let modified = fs::metadata(path.join("nova.db"))
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        if best
            .as_ref()
            .map(|(current, _)| modified > *current)
            .unwrap_or(true)
        {
            best = Some((modified, path));
        }
    }

    best.map(|(_, path)| path)
}

fn copy_legacy_data(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("Не удалось создать папку данных: {error}"))?;

    for name in ["nova.db", "nova.db-wal", "nova.db-shm"] {
        let from = source.join(name);
        if from.is_file() {
            fs::copy(&from, target.join(name))
                .map_err(|error| format!("Не удалось перенести {name}: {error}"))?;
        }
    }

    for name in DATA_ENTRIES {
        let from = source.join(name);
        if from.is_dir() {
            copy_dir(&from, &target.join(name))?;
        }
    }

    Ok(())
}

fn copy_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("Не удалось создать {}: {error}", target.display()))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", source.display()))?;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else if from.is_file() {
            fs::copy(&from, &to)
                .map_err(|error| format!("Не удалось скопировать {}: {error}", from.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("nova-{name}-{stamp}"))
    }

    #[test]
    fn copies_database_and_assets() {
        let appdata = temp_dir("appdata");
        let legacy = appdata.join("legacy-app");
        let target = appdata.join("new-app");
        fs::create_dir_all(legacy.join("covers")).unwrap();
        fs::create_dir_all(legacy.join("lyrics")).unwrap();
        fs::write(legacy.join("nova.db"), b"db").unwrap();
        fs::write(legacy.join("covers").join("cover.jpg"), b"cover").unwrap();
        fs::write(legacy.join("lyrics").join("song.txt"), b"text").unwrap();

        let found = find_legacy_dir(&appdata, &target).expect("legacy dir");
        assert_eq!(found, legacy);
        copy_legacy_data(&found, &target).unwrap();

        assert_eq!(fs::read(target.join("nova.db")).unwrap(), b"db");
        assert_eq!(
            fs::read(target.join("covers").join("cover.jpg")).unwrap(),
            b"cover"
        );
        assert_eq!(
            fs::read(target.join("lyrics").join("song.txt")).unwrap(),
            b"text"
        );

        fs::remove_dir_all(appdata).ok();
    }
}
