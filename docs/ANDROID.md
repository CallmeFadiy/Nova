# Nova Android

Первая рабочая Android-версия Nova: локальная библиотека, нативный плеер,
фон, медиа-уведомление и 10-полосный эквалайзер. Это этап 1 из нескольких;
полный паритет с Windows добавляется следующими планами.

## Что уже работает

- Tauri Android APK, пакет `app.nova.player`, minSdk 29, targetSdk 36.
- Разрешение «Все файлы» (`MANAGE_EXTERNAL_STORAGE`) и автоматическое
  добавление `/storage/emulated/0/Music`.
- Сканирование, метаданные, обложки, кириллические имена.
- Мобильная оболочка: нижняя навигация, компактный player bar, полноэкранный
  «Сейчас играет», очередь, drawer, back по Android.
- Нативный ExoPlayer: play/pause, seek, next/prev, очередь, repeat, shuffle,
  автопереход между треками.
- Фоновое воспроизведение через `MediaSessionService`, foreground service,
  медиа-уведомление с обложкой и кнопками, управление медиа-кнопками.
- 10-полосный эквалайзер (31–16000 Гц) и preamp через нативный
  `AudioProcessor`.
- Пять тем, Polaroid-альбомы, обложки, адаптивная вёрстка без горизонтального
  скролла на 411 CSS px.

## Требования

- Windows 11.
- Android Studio с SDK, platform-tools и эмулятором.
- JDK из Android Studio: `C:\Program Files\Android\Android Studio\jbr`.
- Android SDK Platform 36 и Build-Tools 36.0.0.
- NDK `27.2.12479018`.
- Rust targets:
  `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`.
- `cmdline-tools/latest` в `%LOCALAPPDATA%\Android\Sdk`.
- Node.js и зависимости проекта (`npm.cmd ci`).
- Для сборки на этой машине нужен elevated PowerShell: Tauri создаёт
  символьную ссылку на `libnova_lib.so`, а Windows Developer Mode выключен.
  Альтернатива — включить Developer Mode и запускать сборку без elevation.

## Окружение

```powershell
. .\scripts\android-env.ps1
```

Скрипт выставляет `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`,
`ANDROID_API_LEVEL=29` и, если существует, `CARGO_HOME=C:\Projects\cargo-home`.

Проверить:

```powershell
& "$env:JAVA_HOME\bin\java.exe" -version
adb version
Test-Path "$env:NDK_HOME\ndk-build.cmd"
rustup target list --installed
```

## Сборка

Android-проект лежит в `src-tauri/gen/android` и хранится в Git.
`src-tauri/gen/schemas`, `build`, `.gradle`, `local.properties` и
сгенерированные исходники плагина игнорируются.

```powershell
# эмулятор x86_64
.\scripts\android-build.ps1 -Target x86_64

# телефон arm64
.\scripts\android-build.ps1 -Target aarch64
```

На этой машине запускать из elevated PowerShell:

```powershell
Start-Process powershell.exe -Verb RunAs -ArgumentList `
  '-NoProfile','-ExecutionPolicy','Bypass','-File', `
  'C:\path\to\Nova\scripts\android-build.ps1','-Target','x86_64'
```

Результат:

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Debug APK большой, потому что содержит отладочные символы и несколько ABI.
Для установки на телефон используйте `-Target aarch64`.

## Установка и первый запуск

```powershell
adb devices -l
adb -s <serial> install -r <path-to-apk>
adb -s <serial> shell am start -n app.nova.player/.MainActivity
```

При первом запуске Nova просит разрешение «Все файлы». После включения
приложение автоматически добавляет `/storage/emulated/0/Music` и запускает
сканирование. Для уведомлений разрешите `POST_NOTIFICATIONS`.

Для автоматического теста на эмуляторе:

```powershell
adb -s emulator-5554 shell appops set app.nova.player MANAGE_EXTERNAL_STORAGE allow
adb -s emulator-5554 shell pm grant app.nova.player android.permission.POST_NOTIFICATIONS
```

Проверка данных:

```powershell
adb -s emulator-5554 shell 'run-as app.nova.player ls'
adb -s emulator-5554 shell 'run-as app.nova.player find . -name nova.db'
```

Внутренние данные приложения находятся в `/data/user/0/app.nova.player`.
Пользовательская музыка остаётся в `/storage/emulated/0/Music`.

## Беспроводной ADB

Если USB отваливается:

```powershell
adb tcpip 5555
adb connect 192.168.0.145:5555
adb devices -l
```

`adb tcpip 5555` требует одного успешного USB-подключения. Если на телефоне
включена «Беспроводная отладка» с другим портом, используйте порт из настроек
телефона; при сопряжении нужен код.

## Проверка на эмуляторе

Устройство: `Medium_Phone_API_37.0`, Android 16, x86_64.

```powershell
adb -s emulator-5554 shell input keyevent 3          # Home
adb -s emulator-5554 shell cmd media_session dispatch pause
adb -s emulator-5554 shell cmd media_session dispatch play
adb -s emulator-5554 shell dumpsys media_session
adb -s emulator-5554 shell dumpsys activity services app.nova.player
adb -s emulator-5554 shell dumpsys notification --noredact
```

## Acceptance (2026-11-07 — 2026-11-08)

- Чистая установка debug APK: успешно.
- Permission gate: отображается, после разрешения автоматически сканируется
  `/storage/emulated/0/Music`.
- Эмулятор: 6 треков, 4 альбома, 1 папка; кириллица сохранена.
- Нативный ExoPlayer: play/pause, seek, next/prev, автопереход.
- Автопереход после seek за 5 секунд до конца трека: переключается на следующий.
- Фон: playback продолжается после Home; `NovaPlaybackService` в foreground.
- Медиа-сессия: `state=PLAYING`, metadata с названием/исполнителем, медиа-кнопки
  pause/play работают.
- Уведомление: MediaStyle с обложкой, play/pause, prev/next и seek; канал
  `nova_playback`.
- EQ: команды boost/cut применяются, playback не прерывается.
- Мобильная оболочка: 411 CSS px, `scrollWidth=411`, нижняя навигация и player
  bar не перекрываются; back закрывает NowPlaying, очередь и drawer, а на
  корневом экране сворачивает приложение через `moveTaskToBack`.
- В мобильной строке трека видны обложка, название, исполнитель и длительность.
- Темы: Nocturne, Лёд, Огонь, Пепел, Киберпанк переключаются.
- Repeat: off → all → one → off; shuffle включается и восстанавливается.
- Windows: `npm.cmd run build:web` и
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` проходят.
- Проверка на эмуляторе `Medium_Phone_API_37.0` (Android 16, x86_64) с 6 файлами
  и на POCO F4 GT `21121210G` (Android 13, arm64-v8a): 78 треков, 24 альбома,
  1 папка, 70 треков с кириллицей, `missing=0`, 392 CSS px. На телефоне
  проверены play/pause/seek/next/prev, автопереход, фон, уведомление, EQ, темы,
  repeat/shuffle, clear queue и back-на-корне.

## Заметка по EQ

`EqualizerAudioProcessor` построен на `BaseAudioProcessor`. Выходной буфер
обязательно нужно `flip()`-нуть, а на пустом входе нельзя вызывать
`replaceOutputBuffer`: иначе `AudioProcessingPipeline` не увидит конец потока,
позиция уедет за `durationMs`, а автопереход остановится. Обрабатываются
PCM16 и PCM float; другие кодировки проходят без обработки.

## Ограничения этапа 1

- WMA/AIFF: Media3 их не декодирует; транскод через ffmpeg ещё не подключён.
- Обложка в системном ImageLoader может не читаться на локскрине из-за
  app-private пути; в медиа-уведомлении обложка отображается.
- На MIUI карточка медиа-уведомления использует светлую обложку как фон; на
  светлых обложках белый текст и кнопки малоконтрастны. Действия функционально
  доступны; кастомная разметка уведомления — phase 2.
- `MANAGE_EXTERNAL_STORAGE` — sideload-разрешение, не Play Store.
- `MediaProjection` для системного распознавания, загрузки, импорт, Shazam,
  тексты, редактирование тегов, дубликаты и полный touch-паритет — следующие
  этапы.
- `yt-dlp` на Android пока не встроен; `externalBin` отключён в
  `tauri.android.conf.json`.
- APK debug; подписанный release-APK будет на этапе релиза.
- Состояние плеера синхронизируется опросом `android_audio_state` каждые
  250 мс; нативные события Media3 — следующий этап.

## Следующие планы

1. Библиотечные функции: плейлисты, избранное, поиск, папки, редактирование,
   удаление, дубликаты, кодировка, фоны.
2. Загрузки/импорт: прямые источники, youtubedl-android, очередь в SQLite,
   foreground dataSync, история.
3. Распознавание/тексты: микрофон, файл, MediaProjection, AudD/Shazam,
   Genius/LRC.
4. Мобильная полировка и release APK.
