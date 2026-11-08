mod commands;
mod db;
mod downloads;
mod http;
mod legacy_migration;
mod lyrics;
mod media;
mod models;
mod recognition;
mod scanner;
mod text_encoding;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub app_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_nova_mobile::init())
        .plugin(tauri_plugin_nova_mobile::init_downloads())
        .setup(|app| {
            let app_dir = std::env::var_os("NOVA_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            if let Err(error) = legacy_migration::migrate_if_needed(&app_dir) {
                eprintln!("Legacy data migration skipped: {error}");
            }
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
            // Process rows persisted before a restart. The worker re-queues rows
            // left in starting/downloading before its first pick.
            downloads::start_worker(app.handle().clone());
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
            commands::android_permission_state,
            commands::android_open_all_files_settings,
            commands::android_request_notifications,
            commands::android_minimize_app,
            commands::android_pick_image,
            commands::android_pick_audio,
            commands::android_pick_folder,
            commands::android_audio_set_queue,
            commands::android_audio_play,
            commands::android_audio_pause,
            commands::android_audio_seek,
            commands::android_audio_set_volume,
            commands::android_audio_set_muted,
            commands::android_audio_set_repeat,
            commands::android_audio_set_eq,
            commands::android_audio_state,
            commands::android_download_probe,
            commands::android_download_info,
            commands::android_download_start,
            commands::android_download_cancel,
            commands::download_queue_list,
            commands::download_history_list,
            commands::download_enqueue,
            commands::download_queue_start,
            commands::download_queue_pause,
            commands::download_queue_cancel,
            commands::download_queue_move,
            commands::download_history_clear,
            commands::download_queue_resume,
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
            commands::delete_missing_tracks,
            commands::preview_tag_encoding,
            commands::apply_tag_encoding,
            commands::hash_tracks,
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
            commands::save_lyrics,
            commands::list_lyrics,
            commands::delete_lyrics,
            commands::clear_lyrics,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            downloads::stop_worker();
        }
    });
}
