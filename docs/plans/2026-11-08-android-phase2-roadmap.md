# Nova Android Phase 2 — Roadmap

> Этот документ разбивает оставшийся паритет с Windows на четыре независимые
> подсистемы. Детальный план пишется на каждую подсистему отдельно, чтобы
> каждая часть давала рабочий и проверяемый результат.

**Спецификация:** `docs/specs/2026-11-07-nova-android-design.md`  
**Phase 1:** `docs/plans/2026-11-07-android-foundation.md` (завершена, слита в `master`)

## Порядок

| Этап | Подсистема | План | Зависит от |
|---|---|---|---|
| 2A | Библиотека и touch | `docs/plans/2026-11-08-android-library.md` | Phase 1 |
| 2B | Загрузки и импорт | `docs/plans/2026-11-08-android-downloads.md` (2B-1 готов, 2B-2 следующий) | 2A (пикеры, файловые пути) |
| 2C | Распознавание и тексты | будет создан после 2A | 2A (пикеры), 2B (ffmpeg/кодек) |
| 2D | Полировка и релиз | будет создан после 2A–2C | 2A–2C |

2B и 2C можно вести параллельно после 2A. 2D — только после того, как все
функции проверены на телефоне.

## 2A. Библиотека и touch

Детальный план: `docs/plans/2026-11-08-android-library.md`.

- Android-пикеры: файл, изображение, папка; `content://` → реальный путь.
- Long-press: контекстное меню и режим выделения; back снимает выделение.
- Плейлисты, избранное, поиск, папки, редактирование, удаление, дубликаты,
  кодировка, обложки, фоны, объединение альбомов — на реальной библиотеке.
- Destructive-тесты только на копии `/sdcard/Download/NovaTest`.
- Критерий: все пункты 6 и 7 из раздела 9 спецификации, Windows-сборка зелёная.

## 2B. Загрузки и импорт

Детальный план 2B-1: `docs/plans/2026-11-08-android-downloads.md`.

**2B-1 — готово (2026-11-08).**

- `youtubedl-android:library:0.18.1` + ffmpeg в APK; `NovaDownloadPlugin`;
  `jniLibs.useLegacyPackaging = true`.
- Прямые загрузки Zaycev/Muzofond/DriveMusic остаются в Rust.
- Прямые ссылки и одиночное видео YouTube, прогресс, отмена yt-dlp, история,
  повтор ошибок, добавление в библиотеку.
- 392 px/44 px, arm64 debug APK 156.9 MB (149.6 MiB), `/sdcard/Music` не
  изменён.
- Скачивание YouTube-плейлистов в текущей сети отдаёт HTTP 403, одиночное
  видео работает; ограничение и точный текст ошибки записаны в
  `docs/ANDROID.md`.

**2B-2 — готово (2026-11-08).**

- `NovaTaskService` с `dataSync` и уведомлением `nova_downloads`; сервис
  стартует из foreground-команд enqueue/start/resume/pause, worker обновляет
  уведомление и останавливает сервис на пустой очереди.
- Очередь и история в SQLite (`download_queue`, `download_history`), миграция
  истории из `localStorage`, `download_queue_state`/`clear_finished`.
- Нативный worker: direct и yt-dlp, `.nova-part`, отмена обеих веток, скан в
  библиотеку, восстановление после force-stop с тем же id.
- UI: pause/resume/move/cancel по нативным командам, история из SQLite,
  `download-complete` обновляет библиотеку.
- 392 px/44 px, 48/48 device checks, 33 Rust tests; `/sdcard/Music` не изменён.
- Android 15 `onTimeout(int, int)` обрабатывается; timeout оставляет сохранённую
  паузу без отдельного уведомления. Прогресс в БД обновляется событиями, а после
  перезапуска загрузка начинается с 0 %.

## 2C. Распознавание и тексты

- `NovaRecognitionPlugin`: `AudioRecord` для микрофона, `AudioPlaybackCapture` +
  `MediaProjection` для системного звука, WAV для Rust.
- Runtime-разрешение `RECORD_AUDIO`; согласие на `MediaProjection` на каждую
  сессию; предупреждение о защищённых приложениях.
- AudD и встроенный Shazam; fallback, если `songrec-lib` не собирается под
  Android (решение фиксируется по результатам spike).
- Файловое распознавание через пикер из 2A.
- Тексты Genius/LRC: существующие `get_lyrics`, `save_lyrics`, `list_lyrics`,
  `delete_lyrics`, `clear_lyrics`; проверка на телефоне.
- Критерий: микрофон, файл, системный звук (в пределах Android), AudD/Shazam,
  тексты и LRC.

## 2D. Полировка и релиз

- Кастомная разметка медиа-уведомления для MIUI: тёмный фон/контраст на
  светлых обложках (текущее ограничение).
- Нативные события Media3 вместо опроса `android_audio_state` каждые 250 мс.
- Share/Open with для «Показать в папке»; `ACTION_VIEW` для аудио/видео.
- Запрос отключения оптимизации батареи MIUI; проверка foreground service.
- Release APK: signing config, versionName, ABI splits (arm64), R8, размер,
  checksums; `release/Android/`.
- Доступность: 44 px, контраст, TalkBack-метки, safe area, поворот.
- Финальный прогон по разделу 9 спецификации на `7ac47954`; Windows smoke.
- Документация: `docs/ANDROID.md`, `README.md`, `docs/DECISIONS.md`.

## Общие критерии готовности phase 2

1. Все пункты 1–11 из раздела 9 спецификации пройдены на телефоне.
2. `/sdcard/Music` не изменялась destructive-тестами; проверка по sha256.
3. Windows: `npm.cmd run build:web` и
   `cargo test --manifest-path src-tauri/Cargo.toml --lib` проходят.
4. Release APK устанавливается на чистый телефон, запускается без крашей,
   музыка играет в фоне, уведомление и локскрин работают.
5. Известные ограничения Android (WMA/AIFF, защищённые приложения,
   MIUI-контраст) явно описаны в `docs/ANDROID.md`.
