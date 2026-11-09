# Nova Android

Android-версия Nova: локальная библиотека, нативный плеер, фон,
медиа-уведомление и 10-полосный эквалайзер (phase 1), плейлисты, избранное,
поиск, папки, редактирование, обложки, фоны, удаление, дубликаты, кодировка,
merge и long-press-выделение (phase 2A), а также загрузки и импорт со
встроенным yt-dlp: прямые источники, одиночное видео YouTube, прогресс,
отмена yt-dlp, история и добавление в библиотеку (phase 2B-1). Очередь в
SQLite, foreground-сервис и полный паритет с Windows добавляются следующими
планами.

## Что уже работает

- Tauri Android APK, пакет `app.nova.player`, minSdk 29, targetSdk 36.
- Разрешение «Все файлы» (`MANAGE_EXTERNAL_STORAGE`) и автоматическое
  добавление `/storage/emulated/0/Music`.
- Сканирование, метаданные, обложки, кириллические имена.
- Библиотека: треки, альбомы, папки, плейлисты, избранное, поиск и сортировка.
- SAF-выбор папки (файлы читаются на месте, без копирования) и выбор
  изображений для обложки/фона с копированием в приватное хранилище
  приложения.
- Long-press открывает выделение и меню действий; кнопка «Выбрать» в списке
  включает режим выделения; тап в режиме выделения переключает трек, back
  снимает выделение.
- Массовые действия «В плейлист» и «Удалить», действия над одним треком.
- Удаление трека из плейлиста кнопкой «Убрать» в строке плейлиста; файл на
  диске остаётся.
- Редактирование названия, исполнителя, альбома и album artist; объединение
  альбомов; кастомные обложки; фон приложения и экрана «Сейчас играет».
- Удаление трека вместе с файлом, поиск дубликатов по SHA-1, исправление
  кодировки, скрытые треки и их восстановление.
- Загрузки и импорт на Android: встроенный `youtubedl-android:library:0.18.1`
  с ffmpeg, прямые источники Zaycev/Muzofond/DriveMusic (сквозная загрузка
  проверена только на Muzofond) и прямые ссылки, разбор плейлистов и
  одиночных видео YouTube (скачивание зависит от доступности сети), прогресс,
  история, повтор ошибок и добавление скачанного в библиотеку.
- Отмена работает для загрузок через встроенный yt-dlp; прямые загрузки Rust
  пока не отменяются, и кнопка отмены для них скрыта. История загрузок
  хранится в `localStorage`; очередь — только в памяти и теряется при
  перезапуске. SQLite-очередь и foreground-сервис — phase 2B-2.
- В настройках Android поле «Путь к yt-dlp» скрыто, показана заметка
  «Встроенный yt-dlp входит в приложение, путь указывать не нужно.»
- Мобильная оболочка: нижняя навигация, компактный player bar, полноэкранный
  «Сейчас играет», очередь, drawer, back по Android.
- Нативный ExoPlayer: play/pause, seek, next/prev, очередь, repeat, shuffle,
  автопереход между треками.
- Фоновое воспроизведение через `MediaSessionService`, foreground service,
  медиа-уведомление с обложкой и кнопками, управление медиа-кнопками.
- 10-полосный эквалайзер (31–16000 Гц) и preamp через нативный
  `AudioProcessor`.
- Пять тем, Polaroid-альбомы, обложки, адаптивная вёрстка без горизонтального
  скролла на 392 CSS px. Touch-targets 44×44 проверены для player bar
  (prev/play/next/queue), hamburger, drawer-навигации, кнопок страниц и
  модальных окон, selection bar, кнопки «Выбрать» и действия «Убрать» в
  плейлисте. Часть остальных контролов оболочки (обложка и название трека в
  player bar, кнопки очереди и экрана «Сейчас играет») пока меньше 44 px — это
  полировка phase 2D, полный touch-паритет не заявлен.

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

## Приёмка phase 2A (2026-11-08)

Устройство: POCO F4 GT `21121210G`, serial `7ac47954`, Android 13, arm64-v8a,
392 CSS px. APK собран из `feat/android-library` и установлен поверх phase 1.

Проверено на телефоне:

- Phase 1 regression (`verify-task6.ps1`): Windows build/tests, SQLite-библиотека,
  мобильная оболочка, нативный ExoPlayer, фон/уведомление/EQ, темы,
  repeat/shuffle и review fixes — все проверки прошли.
- Библиотека и Task 2: тап по строке запускает трек и не включает выделение;
  long-press выбирает один трек и открывает меню; кнопка «Выбрать» включает
  режим выделения без long-press; тап в режиме выделения добавляет/убирает
  трек; back закрывает только меню, затем снимает выделение; вертикальный
  свайп отменяет long-press и скроллит список.
- Task 3: плейлист создан, переименован и удалён через UI; в него добавлены два
  трека из NovaTest; трек удалён из плейлиста кнопкой «Убрать», файл остался
  на диске; избранное сохранилось после перезапуска; поиск по кириллице
  «Галопериод» нашёл трек; папка NovaTest удалена из Nova без удаления файлов;
  12 записей остались с `folder_id = NULL`, ссылки в плейлисте не осиротели.
- Task 4: редактирование тегов с открытой клавиатурой, кастомная обложка,
  фон, дубликаты по SHA-1, исправление кодировки, merge альбомов,
  удаление трека вместе с файлом.
- 392 CSS px: `innerWidth = scrollWidth = 392`, горизонтального скролла нет;
  player bar остаётся 64 px. 44×44 проверены для player bar
  (prev/play/next/queue), hamburger, 10 пунктов drawer-навигации, кнопок
  страниц и модальных окон, selection bar, кнопки «Выбрать» и действия
  «Убрать». Остальные контролы оболочки (обложка/название в player bar,
  очередь 30–40 px, «Сейчас играет» 42×42) в эту проверку не входят: их
  полировка — phase 2D.
- Скриншоты ключевых экранов (библиотека, плейлист, модальное редактирование,
  настройки) сняты с устройства при 392 px.
- Финал: SQLite `integrity_check = ok`, `foreign_key_check` пуст, 78 треков
  Music, 0 NovaTest, 0 favorites, 0 hidden, 0 плейлистов, фон по умолчанию,
  приложение force-stopped. `/sdcard/Music` не изменён: SHA-256 совпал для
  12 из 12 контрольных файлов.
- Разрушительные тесты выполнялись только в `/sdcard/Download/NovaTest`,
  который создавался копированием 12 файлов из `/sdcard/Music` и удалялся
  после прогона; оригиналы не перезаписывались.

## Приёмка phase 2B-1 (2026-11-08)

Устройство: POCO F4 GT `21121210G`, serial `7ac47954`, Android 13, arm64-v8a,
392 CSS px. APK пересобран из `feat/android-downloads` после правки строки
импорта и установлен поверх phase 2A. В debug-APK встроен debug-бандл
фронтенда (`index-BUKJ2s8O.js`, с source map), поэтому его имя не совпадает с
production-сборкой `build:web`.

- В APK встроены `io.github.junkfood02.youtubedl-android:library:0.18.1` и
  `:ffmpeg:0.18.1`. `jniLibs.useLegacyPackaging = true` обязателен: иначе
  Python/ffmpeg-payload не распаковывается в `nativeLibraryDir` и
  `YoutubeDL.init` падает.
- Размер arm64 debug APK: 156 900 412 байт ≈ 156.9 MB (149.6 MiB). Сборка —
  обычный workaround: `tauri android build --debug --apk --target aarch64`
  собирает Rust-библиотеку, затем `libnova_lib.so` копируется в
  `jniLibs/arm64-v8a`, а `gradlew :app:assembleArm64Debug` запускается без
  rust-задач; `.so` после сборки удаляется из `jniLibs`. Чистый
  `:app:clean` перед упаковкой обязателен: инкрементальная упаковка один раз
  дала APK с 78 MB пустого padding.
- Прямые источники: поиск «Morandi Samba» вернул кандидатов Muzofond.fm
  (320 kbps). Скачан `Morandi – Samba` по реальному `downloadUrl`
  (4 723 983 байта, 3:16), прогресс шёл 0–100 %, файл появился в
  `/sdcard/Download/NovaDownloads`, история получила статус `done`, сканер
  добавил трек в библиотеку. Кнопка отмены для прямой загрузки не
  показывалась. Сквозная загрузка проверена только на Muzofond; Zaycev.net
  вернул кандидатов в отдельном probe-поиске, DriveMusic кандидатов не вернул.
  Скачивание с Zaycev/DriveMusic в этом прогоне не проверялось.
- YouTube: плейлист `phonk? - single` (2 трека) разобрался в `/import`,
  выбран 1 трек. Скачивание вернуло
  `YoutubeDLException: ERROR: unable to download video data: HTTP Error 403:
  Forbidden`. Это сетевое ограничение текущей сети, а не падение приложения:
  одиночное видео `Me at the zoo` (`jNQXAC9IVRw`) в том же прогоне
  разобралось, скачалось с прогрессом, файл добавлен в библиотеку. В Task 2
  YouTube сначала был заблокирован, затем заработал; в Task 3 одиночное
  видео скачалось. Для 2B-2 нужно проверить плейлисты на стабильной сети и
  обновить настройки форматов/po-token yt-dlp, если 403 повторяется.
- Отмена: загрузка 20 MB с `speed.cloudflare.com` через встроенный yt-dlp
  отменена кнопкой. Остались статусы `starting`, `error`; ни `done`, ни
  записи в истории, ни частичного файла. Кнопка отмены показывается только
  для `cancellable` загрузок.
- Ошибка и повтор: `https://invalid.nova.test/audio.mp3` дал реальный текст
  `Не удалось скачать файл: error sending request for url (...)`, запись
  `error` в истории и кнопку «Повторить» (44 px). Нажатие «Повторить» создало
  новую попытку с новым id и новую запись `error` (для недоступного URL это
  ожидаемо). Восстанавливаемый повтор проверен на локальном HTTP-сервере
  через `adb reverse`: первый ответ `HTTP 500` → `error`, «Повторить» →
  `downloading` → `done`, файл `retry.mp3` сохранён и добавлен сканером.
- Импорт и повтор: на прямом `track.mp3` первая попытка дала `HTTP 500` и
  строку «Ошибка», повторная загрузка того же трека — «Готово», без
  оставшейся ошибки в строке. Строка импорта теперь берёт самую новую попытку
  для индекса (по `order`), а не первую запись из store.
- 392 CSS px: `innerWidth = scrollWidth = 392` на «Загрузках», истории,
  запущенной отмене, «Импорте» и «Настройках»; горизонтального overflow нет,
  кнопки и поля 44×44 (чекбоксы — внутри кликабельной строки 50 px).
  Скриншоты (локально, вне Git, каталог в `.gitignore`):
  `.superpowers/sdd/2026-11-08-android-downloads/screens-task4/` —
  `01-settings-392.png`, `02-downloads-392.png`,
  `03-search-results-392.png`, `04-import-playlist-392.png`,
  `05-import-single-392.png`, `06-import-done-392.png`,
  `07-cancel-running.png`, `08-error-history-392.png`,
  `09-downloads-retry-error-392.png`, `10-downloads-retry-done-392.png`,
  `11-import-error-row-392.png`, `12-import-retry-done-392.png`.
- Fix 2B-1: каждая yt-dlp-загрузка идёт в `<outputDir>/.nova-<id>/`, готовый
  файл переносится в `outputDir` без перезаписи (суффикс ` (n)` при
  совпадении), а ошибка/отмена удаляет только staging. На телефоне
  `sentinel.txt` и `bystander.mp3` пережили падающую загрузку, staging удалён;
  прямой MP3 и YouTube `Me at the zoo` скачались в `outputDir`, история
  очищена и проверена (0). `gradlew` запускался как
  `:app:assembleArm64Debug -x rustBuildArm64Debug`.
- Финал: SQLite `integrity_check = ok`, `foreign_key_check` пуст, 78 записей
  `tracks`, все 78 — Music, тестовых строк и папки NovaDownloads нет, таблиц
  `download_queue`/`download_history` нет (2B-2 ещё не реализована).
  История загрузок очищена и проверена (0 записей; архивный
  `screens-task4/post-run-state.json` снят до очистки и содержал `history: 5`),
  `downloadDir` возвращён к значению по умолчанию, фон по умолчанию
  (`appBackground`/`nowBackground` = null), приложение force-stopped.
- `/sdcard/Music` не изменён: 104 файла, SHA-256 совпал до и после. Тестовые
  загрузки выполнялись только в `/sdcard/Download/NovaDownloads`, папка
  удалена после прогона.
- Windows: `npm.cmd run build:web` (EXIT 0) и
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 15 тестов passed
  (в плане ожидалось 13; набор вырос после phase 2A/2B-1).

## Приёмка phase 2B-2 (2026-11-08)

Устройство: POCO F4 GT `21121210G`, serial `7ac47954`, Android 13, arm64-v8a,
392 CSS px. APK собран из `feat/android-download-queue` (commit `8ebeced`):
`app-universal-debug.apk` (внутри только arm64-v8a), 236 308 929 байт,
SHA-256 `48E69E78C820BBA75E7F1F4BC3D4B446C26FD61B00F9E86FAFADA24A30287A8A`,
установлен поверх 2B-1.

- Очередь и история: `download_queue`/`download_history` в `nova.db` (WAL),
  команды `download_queue_list/history_list/state/clear_finished` и
  `download_history_import` для одноразовой миграции `localStorage`. Терминальные
  строки удаляются после записи истории.
- Нативный worker: direct и yt-dlp, pause/resume/move/cancel, `.nova-part-<id>`
  для прямых загрузок, staging для yt-dlp, скан папки и `download-complete`,
  отмена обеих веток.
- `NovaTaskService` (`dataSync`, канал `nova_downloads`, IMPORTANCE_LOW) стартует
  из `download_enqueue`/`download_queue_start`/`download_queue_pause(false)`/
  `download_queue_resume`, пока activity в foreground; worker обновляет
  уведомление, запускает сервис при взятии задачи, если он ещё не запущен, и
  останавливает его на пустой очереди. Android 15
  `onTimeout(int, int)` пишет маркер паузы и останавливает сервис; debug-команда
  `android_download_simulate_timeout` доступна только в debug-сборке.
- UI: Downloads/Import ставят `DownloadTask` в нативную очередь, прогресс идёт из
  `download-progress`, история — из SQLite; pause/resume/move/cancel вызывают
  нативные команды; `download-complete` перезагружает snapshot библиотеки.
- Проверено `verify-ui.py` на телефоне: 48/48. Прямая загрузка + скан; пауза,
  перемещение и продолжение; отмена активной загрузки (нет файла и `done`,
  в истории `cancelled`); Home + screen off (сервис `isForeground=true`,
  уведомление 17 % → 38 %, загрузка завершилась); force-stop на `.nova-part`,
  перезапуск и докачка с тем же id; очистка истории из UI; 392 px, нет
  горизонтального overflow, 44 px.
- Windows: `npm.cmd run build:web` и
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 36 passed.
- Финальный APK после правок review прошёл smoke: UI enqueue → `done` в
  SQLite, библиотека 79 треков, очистка вернула 78 и Music-only.
- `/sdcard/Music` не изменён: 104 файла, 78 треков в библиотеке, только Music;
  папка NovaDownloads удалена, очередь/история пусты, `stay_on` = 0.

## Известные ограничения phase 2B-2

- Прогресс в строке `download_queue` не обновляется во время передачи: UI получает
  процент из событий `download-progress`, а в БД остаётся 0 до завершения. После
  force-stop загрузка перезапускается с 0 % (старый `.nova-part` удаляется).
- Android 15 `onTimeout`: foreground-уведомление снимается системой, сохраняется
  только флаг паузы; отдельного уведомления «Пауза» после timeout нет.
- «Повторить» в истории доступно только в сессии, где задача поставлена: callback
  хранится в памяти. После перезапуска запись истории остаётся без кнопки.
- Импорт: для Яндекс Музыки поиск провайдеров идёт до постановки задачи; для
  остальных источник ставится сразу, а провайдеры и легальное превью пробуются
  при повторе.
- FGS стартует из foreground-команд. Если очередь возобновлена из фона, worker
  повторяет старт при взятии следующей задачи.
- Пользовательские CA не доверяются в Android HTTP-клиенте: Rust использует
  корни webpki, поэтому TLS-инспекция и самоподписанные прокси не работают.

## Приёмка phase 2C–2D (2026-11-08)

- Распознавание на Android идёт через AudD: `RECORD_AUDIO` запрашивается
  runtime-разрешением; микрофон пишет Rust/cpal, файл уходит в
  `recognize_audd_file`, системный звук — через `NovaProjectionService`
  (`MediaProjection` + `AudioPlaybackCapture`, 16 кГц mono WAV). Небольшие
  файлы уходят в AudD целиком; для файлов больше 10 МБ `symphonia` декодирует
  первые 12 секунд в 16 кГц mono WAV. Проверено публичным токеном `test`:
  8,9 МБ MP3 распознан целиком как Kosandra / Miyagi & Andy Panda, а 20,8 МБ
  FLAC — по 12-секундному фрагменту как «Санавабич» / Miyagi & Эндшпиль.
  Ключ пользователя валиден, но аккаунт отвечает `the limit was reached`; это
  показывается понятным сообщением про лимит AudD. Встроенный `songrec` на
  Android падает, поэтому UI переключает провайдера на AudD и показывает
  ошибку Windows-версии, если вызвать builtin напрямую.
- Тексты: Genius, при 403 — LRCLIB (`syncedLyrics` LRC или plain). На треке
  Kosandra получено 2953 символа LRC; кэш и редактор работают.
- Share/Open with: FileProvider, `ACTION_VIEW` audio/video, импорт в
  `/sdcard/Download/NovaInbox` и добавление папки в библиотеку. Проверено
  `content://` из MediaStore (79-й трек, переход в Library); «Поделиться»
  показывает системный chooser, «Открыть в другом приложении» запускает
  `ACTION_VIEW` напрямую.
- MIUI: состояние `PowerManager.isIgnoringBatteryOptimizations`, запрос
  исключения, настройки батареи и автозапуска в Settings.
- Release: `release/Android/Nova-0.1.0-arm64-release.apk`, 67 757 631 байт,
  SHA-256 `3BF8A05D0318222E7B61C412BFC7B1C69DEAC5127DEE17EB160454BD064D8A1A`,
  arm64-v8a, подписан локальным `nova-release.jks` (CN=Nova Local, cert
  SHA-256 `b4ec51312f56ae3cfd4c76912b7cf9aa41a24776301ef7715883eecd1e584958`).
  Установлен поверх предыдущего release (та же подпись): 78 треков и API-ключ
  AudD сохранились; скрытый трек вернулся после миграции. Иконка в лаунчере —
  десктопные наушники. Чистая установка проверялась на предыдущей сборке.
- Polish: 26/26 проверок на 392 px — 10 экранов без overflow, все controls
  ≥ 44 px, Now Playing, Lyrics, track actions с Share/Open with. Исправлены
  30 px переключатели источника на Shazam.
- Windows: `npm.cmd run build:web` и
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38 passed.
- `/sdcard/Music` — 104 файла, 78 треков, только Music; тестовые папки удалены.

## Удаление скрытия и мобильная полировка (2026-11-09)

- Скрытие треков удалено на десктопе и Android: убрано действие «Скрыть из
  альбома», раздел «Скрытые треки», store/API-методы и Rust-команды
  `hide_track`/`restore_track`. Осталось только «Удалить трек и файл».
- Миграция `DROP TABLE IF EXISTS hidden_tracks` возвращает ранее скрытые
  треки, не трогая файлы. Проверено на телефоне: скрытый «911 (4 Раунд)»
  вернулся после установки новой сборки поверх старой, файл
  `Тони Раут - 911.mp3` остался на месте; `/sdcard/Music` — 104 файла.
- Android-иконка сгенерирована из десктопного `src-tauri/icons/icon.png`
  (белые наушники): adaptive foreground, круглая версия и фон `#0B0B0D`.
  Иконка проверена в лаунчере телефона.
- Мобильная адаптация: `viewport-fit=cover`, safe-area для статус-бара,
  жестовой панели и боковых вырезов в main-scroll, меню, sidebar, player bar,
  нижней навигации, очереди, Now Playing, модальных окнах и тостах; переход
  между экранами сбрасывает прокрутку наверх. Проверены 10 экранов на
  392 CSS px и на телефоне: горизонтального overflow нет, controls ≥ 44 px,
  контент не уходит под статус-бар и системную навигацию.
- Windows: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 38 passed,
  `npm.cmd run build:web` — exit 0.

## Известные ограничения phase 2C–2D

- AudD требует API-ключ; без ключа распознавание показывает подсказку.
  Успешное совпадение зависит от тарифа AudD: у ключа пользователя на момент
  приёмки исчерпан лимит, приложение показывает это отдельным сообщением.
- Для больших файлов отправляются первые 12 секунд (`symphonia`). Форматы,
  которые `symphonia` не декодирует (например WMA), по-прежнему уходят целиком
  и ограничены 10 МБ стандартного endpoint AudD.
- Встроенный Shazam доступен только в Windows; на Android он отключён.
- `AudioPlaybackCapture` не захватывает звук самого Nova (ограничение Android);
  для проверки нужен другой плеер/видео.
- `file://` intents не импортируются; файловые менеджеры используют
  `content://`.
- Release подписан локальным ключом; для распространения заменить keystore.
- Кастомная разметка медиа-уведомления для MIUI не сделана: на светлых
  обложках локскрин-карточка остаётся малоконтрастной (действия доступны).
- Нативные события Media3 не подключены; состояние плеера по-прежнему
  синхронизируется опросом `android_audio_state` каждые 250 мс.
- Реальный Android 15 `dataSync` timeout не проверялся (телефон Android 13).

## Известные ограничения phase 2B-1

- Прямые загрузки Rust и история в `localStorage` заменены нативным worker'ом и
  SQLite в 2B-2; старые записи истории мигрируют один раз.
- Пользовательские CA не доверяются в Android HTTP-клиенте (см. 2B-2).

## Известные ограничения phase 2A

- `remove_folder` убирает папку из Nova, но оставляет её треки с
  `folder_id = NULL` (общее поведение с Windows). Записи и плейлисты
  сохраняются, файлы на диске не трогаются.
- Окно дубликатов заранее отмечает все копии во всей библиотеке, кроме
  рекомендованной. На реальной библиотеке перед удалением нужно вручную снять
  галочки с групп вне выбранной папки.
- Кастомная обложка не удаляется вместе с треком: `delete_tracks` не чистит
  `customCoverPath` (существовавшее поведение). Файл обложки удаляется
  отдельно.
- На MIUI карточка медиа-уведомления использует светлую обложку как фон; на
  светлых обложках белый текст и кнопки малоконтрастны. Действия функционально
  доступны; кастомная разметка уведомления — следующий этап.
- SAF-выбор папки ограничен томами, отображёнными в файловой системе
  (`/storage/emulated/0`, SD-карта). Облачные и виртуальные DocumentsProvider
  не индексируются, потому что сканер работает с путями файловой системы.

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
- `MANAGE_EXTERNAL_STORAGE` — sideload-разрешение, не Play Store.
- `MediaProjection` для системного распознавания реализован в 2C; он не
  захватывает звук самого Nova (ограничение Android). Редактирование тегов,
  дубликаты и 44 px targets для player bar, drawer, страниц, модальных окон и
  selection bar вошли в phase 2A; полный touch-паритет — в 2D.
- `yt-dlp` на Android встроен в APK (phase 2B-1); `externalBin` для
  desktop-сайдкара остаётся отключён в `tauri.android.conf.json`.
- Debug APK — для разработки; подписанный release-APK:
  `release/Android/Nova-0.1.0-arm64-release.apk`.
- Состояние плеера синхронизируется опросом `android_audio_state` каждые
  250 мс; нативные события Media3 — следующий этап.

## Следующие планы

Android phase 2 (2A–2D) завершена. Дальше: release-подпись для распространения
(заменить локальный keystore), ABI splits/Play Store-вариант, проверка реального
Android 15 timeout и внешние видео-интенты.
