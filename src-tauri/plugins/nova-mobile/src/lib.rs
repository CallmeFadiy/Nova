#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.nova.mobile";

/// Handle to the Android native bridge. Managed by the plugin on Android.
pub struct NovaMobile<R: Runtime>(pub PluginHandle<R>);

impl<R: Runtime> Clone for NovaMobile<R> {
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
