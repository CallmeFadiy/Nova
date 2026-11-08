// The generated `nova-mobile` ACL entries for the download commands below are
// unused: JS calls the Rust wrappers (`android_download_*` / `download_media`),
// never the Kotlin plugin directly. They stay here because the second Tauri
// plugin registration (`nova-download`) builds from the same command list.
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
