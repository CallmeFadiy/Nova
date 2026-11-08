const COMMANDS: &[&str] = &[
    "hasAllFilesAccess",
    "openAllFilesSettings",
    "requestNotifications",
    "minimizeApp",
    "pickImage",
    "pickAudio",
    "pickFolder",
    "audioSetQueue",
    "audioPlay",
    "audioPause",
    "audioSeek",
    "audioSetVolume",
    "audioSetMuted",
    "audioSetRepeat",
    "audioSetEq",
    "audioState",
    "downloadProbe",
    "downloadInfo",
    "downloadStart",
    "downloadCancel",
    "downloadState",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
