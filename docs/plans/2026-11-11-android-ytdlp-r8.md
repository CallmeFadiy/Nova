# Nova — Android yt-dlp R8 Crash Fix

**Goal:** Fix the release-only Android crash after opening a Yandex Music
playlist link in the download field.

**Date:** 2026-11-11
**Branch:** `fix/android-ytdlp-r8`
**Reported link:** `https://music.yandex.ru/playlists/...`

## Diagnosis

`adb logcat -b crash` showed a fatal `ExceptionInInitializerError` in
`NovaDownloadPlugin`, coming from `com.yausername.youtubedl_android.YoutubeDL`
and then `org.apache.commons.compress.archivers.zip.ExtraFieldUtils`:

```
RuntimeException: class d9 is not a concrete class
  at su.c (ExtraFieldUtils)
  at ff1.b (ZipFile)
  at te1.c (YoutubeDL)
  at app.nova.download.NovaDownloadPlugin.i
```

The R8 mapping confirmed `d9 = AsiExtraField`, `su = ExtraFieldUtils`,
`ff1 = ZipFile`, `te1 = YoutubeDL`. R8 removed/merged the zip extra-field
classes that Commons Compress creates reflectively. The queued yt-dlp task was
persisted, so every relaunch repeated the crash.

## Changes

- Added ProGuard keep rules for Apache Commons Compress, youtubedl-android,
  ffmpeg and youtubedl-common, plus the `ZipExtraField` implementations.
- Changed the plugin worker catches from `Exception` to `Throwable`, so a
  `LinkageError`/`ExceptionInInitializerError` is reported as a failed download
  instead of killing the app.
- Rebuilt the signed APK and replaced the broken GitHub Release asset.

## Verification

- [x] Fixed APK installed over the crashing build; app launches to Home with the
      queued Yandex task still persisted.
- [x] No new `FATAL EXCEPTION`/`ExceptionInInitializerError` in `logcat` after
      launch.
- [x] Downloads page is reachable: current downloads 0, history 1; the bad
      Yandex task failed gracefully instead of killing the process.
- [x] APK: 67 746 915 bytes,
      SHA-256 `35501FFDE455B8D07F5709572F047CE36A90364DAA4FD847A72D26E2FD71E969`.
- [x] GitHub Release asset replaced; digest matches the uploaded file.
- [x] Yandex playlist itself is not resolved by the “Скачать по ссылке” field;
      playlists should use “Импорт ссылки”. The failure is now safe.
