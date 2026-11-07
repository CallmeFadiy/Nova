const COMMANDS: &[&str] = &[
    "hasAllFilesAccess",
    "openAllFilesSettings",
    "requestNotifications",
    "audioSetQueue",
    "audioPlay",
    "audioPause",
    "audioSeek",
    "audioSetVolume",
    "audioSetMuted",
    "audioSetRepeat",
    "audioState",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
