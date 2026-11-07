const COMMANDS: &[&str] = &[
    "hasAllFilesAccess",
    "openAllFilesSettings",
    "requestNotifications",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
