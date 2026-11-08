#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.nova.mobile";
#[cfg(target_os = "android")]
const DOWNLOAD_PLUGIN_IDENTIFIER: &str = "app.nova.download";

/// Handle to the Android core bridge (`app.nova.mobile` / `NovaMobilePlugin`).
pub struct NovaMobile<R: Runtime>(pub PluginHandle<R>);

impl<R: Runtime> Clone for NovaMobile<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

/// Handle to the Android download bridge (`app.nova.download` / `NovaDownloadPlugin`).
///
/// Tauri keys Android plugin instances by the Tauri plugin name, so the download
/// bridge must be registered by its own `TauriPlugin` instead of a second handle
/// on `NovaMobile`.
pub struct NovaDownloads<R: Runtime>(pub PluginHandle<R>);

impl<R: Runtime> Clone for NovaDownloads<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nova-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "NovaMobilePlugin")?;
                app.manage(NovaMobile(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

pub fn init_downloads<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nova-download")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(
                    DOWNLOAD_PLUGIN_IDENTIFIER,
                    "NovaDownloadPlugin",
                )?;
                app.manage(NovaDownloads(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
