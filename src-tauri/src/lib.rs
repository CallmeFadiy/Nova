mod commands;
mod db;
mod lyrics;
mod media;
mod models;
mod recognition;
mod scanner;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub app_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            let conn = db::init(&app_dir)?;
            let folders: Vec<String> = {
                let mut stmt = conn.prepare("SELECT path FROM folders")?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            app.manage(AppState {
                db: Mutex::new(conn),
                app_dir: app_dir.clone(),
            });
            let scope = app.asset_protocol_scope();
            let _ = scope.allow_directory(&app_dir, true);
            for folder in folders {
                let _ = scope.allow_directory(folder, true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::get_snapshot,
            commands::scan_library,
            commands::add_folder,
            commands::remove_folder,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::reorder_playlist,
            commands::toggle_favorite,
            commands::hide_track,
            commands::restore_track,
            commands::set_track_cover,
            commands::clear_track_cover,
            commands::update_track_metadata,
            commands::delete_track,
            commands::delete_tracks,
            commands::merge_albums,
            commands::set_background,
            commands::clear_background,
            commands::search_media,
            commands::resolve_playlist,
            commands::download_media,
            commands::download_direct,
            commands::recognize_audd,
            commands::recognize_shazam,
            commands::recognize_shazam_file,
            commands::get_lyrics,
            commands::list_lyrics,
            commands::delete_lyrics,
            commands::clear_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
