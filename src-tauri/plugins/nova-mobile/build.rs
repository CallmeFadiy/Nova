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
    "audioSetEq",
    "audioState",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
