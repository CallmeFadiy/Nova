package app.nova.download

import android.app.Activity
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg
class DownloadProbeArgs {
    var url: String = ""
}

@InvokeArg
class DownloadInfoArgs {
    var url: String = ""
}

@InvokeArg
class DownloadStartArgs {
    var id: String = ""
    var url: String = ""
    var outputDir: String = ""
    var query: String = ""
}

@InvokeArg
class DownloadCancelArgs {
    var id: String = ""
}

@InvokeArg
class DownloadStateArgs {
    var id: String = ""
}

private data class DownloadSnapshot(
    val id: String,
    val percent: Double = 0.0,
    val line: String = "",
    val status: String = "starting",
    val path: String? = null,
    val error: String? = null,
    val networkLimited: Boolean = false,
)

/**
 * Embedded yt-dlp bridge. `YoutubeDL.init` unpacks the bundled Python runtime into
 * the app's no-backup dir on first use, so it runs lazily on a worker thread.
 *
 * Every command returns to the caller from a worker; `downloadStart` resolves only
 * when yt-dlp has finished so Rust can await the real `DownloadResult`. Progress is
 * pushed with `trigger("download-progress", …)` and mirrored in [snapshots] so the
 * Rust bridge can forward it to the webview as a normal Tauri event (the download
 * plugin lives under a different Tauri plugin name than the generated ACL entry,
 * so the webview cannot register a plugin listener for it).
 */
@TauriPlugin
class NovaDownloadPlugin(private val activity: Activity) : Plugin(activity) {
    private val initLock = Any()
    private val versionLock = Any()
    private var initialized = false
    private var cachedVersion: String? = null
    private var executor: ExecutorService? = null
    private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val snapshots = ConcurrentHashMap<String, DownloadSnapshot>()
    private val active = ConcurrentHashMap.newKeySet<String>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    override fun onDestroy(activity: AppCompatActivity) {
        active.forEach { YoutubeDL.destroyProcessById(it) }
        executor?.shutdownNow()
        executor = null
        timer.shutdownNow()
    }

    @Command
    fun downloadProbe(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadProbeArgs::class.java)
        val url = args.url.trim()
        if (url.isEmpty()) {
            rejectOnUi(invoke, "Не указана ссылка для проверки yt-dlp")
            return
        }
        worker().execute {
            try {
                val initStarted = System.currentTimeMillis()
                ensureInitialized()
                val initMs = System.currentTimeMillis() - initStarted

                val result = JSObject()
                result.put("ok", true)
                result.put("url", url)
                result.put("initMs", initMs)
                result.put("ffmpegReady", true)
                result.put("version", ytdlpVersion())
                result.put("networkLimited", false)

                try {
                    val infoStarted = System.currentTimeMillis()
                    val json = runInfo(url, probe = true)
                    result.put("title", json.optString("title", ""))
                    result.put("videoId", json.optString("id", ""))
                    result.put("extractor", json.optString("extractor_key", ""))
                    result.put("formats", json.optJSONArray("formats")?.length() ?: 0)
                    result.put("durationSec", json.optDouble("duration", 0.0))
                    result.put("infoMs", System.currentTimeMillis() - infoStarted)
                } catch (error: Exception) {
                    val message = describe(error)
                    result.put("ok", false)
                    result.put("formats", 0)
                    result.put("networkLimited", isNetworkError(message))
                    result.put("error", message)
                }

                resolveOnUi(invoke, result)
            } catch (error: Exception) {
                rejectOnUi(invoke, "yt-dlp probe failed: ${describe(error)}")
            }
        }
    }

    @Command
    fun downloadInfo(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadInfoArgs::class.java)
        val url = args.url.trim()
        if (url.isEmpty()) {
            rejectOnUi(invoke, "Вставьте ссылку на видео или плейлист")
            return
        }
        worker().execute {
            try {
                ensureInitialized()
                val json = runInfo(url, probe = false)
                resolveOnUi(invoke, playlistFromJson(json, url))
            } catch (error: Exception) {
                rejectOnUi(invoke, describeInfoError(error))
            }
        }
    }

    @Command
    fun downloadStart(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadStartArgs::class.java)
        val url = args.url.trim()
        if (url.isEmpty()) {
            rejectOnUi(invoke, "Не указана ссылка для скачивания")
            return
        }
        val outputDir = args.outputDir.trim()
        if (outputDir.isEmpty()) {
            rejectOnUi(invoke, "Не указана папка для скачивания")
            return
        }
        val id = args.id.trim().ifEmpty { UUID.randomUUID().toString() }
        val query = args.query.trim()
        val directory = File(outputDir)
        if (!directory.exists() && !directory.mkdirs()) {
            rejectOnUi(invoke, "Не удалось создать папку загрузок: $outputDir")
            return
        }

        active.add(id)
        cancelled.remove(id)
        publish(
            DownloadSnapshot(
                id = id,
                percent = 0.0,
                line = "Подготовка yt-dlp…",
                status = "starting",
            ),
        )

        worker().execute {
            runDownload(id, url, query, directory, invoke)
        }
    }

    @Command
    fun downloadCancel(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadCancelArgs::class.java)
        val id = args.id.trim()
        if (id.isEmpty()) {
            rejectOnUi(invoke, "Не указан идентификатор загрузки")
            return
        }
        val known = active.contains(id)
        cancelled.add(id)
        val destroyed = YoutubeDL.destroyProcessById(id)
        val snapshot = snapshots[id]
        if (snapshot != null && snapshot.status != "done" && snapshot.status != "error") {
            publish(
                snapshot.copy(
                    line = "Загрузка отменена",
                    status = "error",
                    error = "Загрузка отменена",
                    networkLimited = false,
                ),
            )
        }
        val result = JSObject()
        result.put("cancelled", known || destroyed)
        resolveOnUi(invoke, result)
    }

    @Command
    fun downloadState(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadStateArgs::class.java)
        val snapshot = snapshots[args.id.trim()]
        resolveOnUi(invoke, snapshotPayload(snapshot, args.id.trim()))
    }

    private fun runDownload(
        id: String,
        url: String,
        query: String,
        directory: File,
        invoke: Invoke,
    ) {
        val startedAt = System.currentTimeMillis()
        val existingNames = directory.list()?.toSet().orEmpty()
        try {
            ensureInitialized()
            if (cancelled.contains(id)) {
                throw YoutubeDL.CanceledException()
            }

            val template = File(directory, "%(title)s.%(ext)s").absolutePath
            val request = YoutubeDLRequest(url)
            request.addOption("--no-playlist")
            request.addOption("--newline")
            request.addOption("--no-warnings")
            request.addOption("--progress")
            request.addOption("-f", "bestaudio/best")
            request.addOption("-x")
            request.addOption("--audio-format", "mp3")
            request.addOption("--audio-quality", "0")
            request.addOption("-o", template)
            request.addOption("--print", "after_move:filepath")

            var lastPercent = 0.0
            val response = YoutubeDL.execute(request, id, false) { percent, _, line ->
                val text = line?.trim().orEmpty()
                val reported = if (percent.isFinite() && percent >= 0f) {
                    percent.toDouble().coerceIn(0.0, 100.0)
                } else {
                    lastPercent
                }
                val monotonic = reported.coerceAtLeast(lastPercent)
                val changed = monotonic - lastPercent >= 0.5 || monotonic >= 99.9
                if (text.isNotEmpty() || changed) {
                    lastPercent = monotonic
                    publish(
                        DownloadSnapshot(
                            id = id,
                            percent = monotonic,
                            line = text.ifEmpty { "Скачивание…" },
                            status = "downloading",
                        ),
                    )
                }
            }

            val path = response.out
                .lineSequence()
                .map(String::trim)
                .filter { it.isNotEmpty() }
                .filter { File(it).isFile }
                .lastOrNull()
                ?: newestFile(directory, existingNames)
                ?: throw IllegalStateException("Файл скачан, но не найден в папке загрузок")

            val title = File(path).nameWithoutExtension.ifBlank {
                query.ifBlank { "Новый трек" }
            }
            publish(
                DownloadSnapshot(
                    id = id,
                    percent = 100.0,
                    line = "Готово",
                    status = "done",
                    path = path,
                    networkLimited = false,
                ),
            )
            val result = JSObject()
            result.put("path", path)
            result.put("title", title)
            result.put("directory", directory.absolutePath)
            resolveOnUi(invoke, result)
        } catch (error: Exception) {
            cleanupPartial(directory, existingNames)
            val wasCancelled = error is YoutubeDL.CanceledException || cancelled.contains(id)
            val message = if (wasCancelled) {
                "Загрузка отменена"
            } else {
                describe(error)
            }
            publish(
                DownloadSnapshot(
                    id = id,
                    percent = snapshots[id]?.percent ?: 0.0,
                    line = message,
                    status = "error",
                    error = message,
                    networkLimited = !wasCancelled && isNetworkError(message),
                ),
            )
            rejectOnUi(invoke, message)
        } finally {
            active.remove(id)
            cancelled.remove(id)
            YoutubeDL.destroyProcessById(id)
        }
    }

    private fun runInfo(url: String, probe: Boolean): JSONObject {
        val processId = "${if (probe) "probe" else "info"}-${UUID.randomUUID()}"
        val timedOut = AtomicBoolean(false)
        val guard = timer.schedule({
            timedOut.set(true)
            destroyWithRetry(processId)
        }, INFO_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        try {
            val request = YoutubeDLRequest(url)
            request.addOption("--dump-single-json")
            request.addOption("--skip-download")
            request.addOption("--no-warnings")
            if (probe) {
                request.addOption("--no-playlist")
            } else {
                request.addOption("--flat-playlist")
            }
            val out = YoutubeDL.execute(request, processId, false, null).out.trim()
            if (out.isEmpty()) {
                throw IllegalStateException("yt-dlp не вернул данные")
            }
            return JSONObject(out)
        } catch (error: Exception) {
            if (timedOut.get() || error is YoutubeDL.CanceledException) {
                throw IllegalStateException(
                    "yt-dlp не ответил за $INFO_TIMEOUT_SECONDS с (сеть ограничена)",
                    error,
                )
            }
            throw error
        } finally {
            guard.cancel(false)
        }
    }

    private fun destroyWithRetry(processId: String) {
        repeat(5) {
            if (YoutubeDL.destroyProcessById(processId)) {
                return
            }
            try {
                Thread.sleep(200)
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    private fun playlistFromJson(json: JSONObject, url: String): JSObject {
        val entries = json.optJSONArray("entries")
        val source = sourceFromJson(json, url)
        val tracks = JSArray()

        if (entries != null && entries.length() > 0) {
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                val track = trackFromJson(entry, url, source)
                if (track != null) {
                    tracks.put(track)
                }
            }
        } else {
            trackFromJson(json, url, source)?.let { tracks.put(it) }
        }

        if (tracks.length() == 0) {
            throw IllegalStateException("Источник не вернул треков")
        }

        val result = JSObject()
        result.put("title", json.optString("title").ifBlank { source })
        result.put("source", source)
        result.put("tracks", tracks)
        return result
    }

    private fun trackFromJson(json: JSONObject, fallbackUrl: String, source: String): JSObject? {
        val rawTitle = firstString(json, "track", "title").trim()
        if (rawTitle.isEmpty()) {
            return null
        }
        val uploader = firstString(json, "artist", "creator", "uploader", "channel", "album_artist")
        val (artist, title) = splitMediaTitle(rawTitle, uploader)
        val webpage = firstString(json, "webpage_url", "original_url").ifBlank {
            val id = firstString(json, "id")
            if (id.isNotEmpty() && source == "YouTube") {
                "https://www.youtube.com/watch?v=$id"
            } else {
                firstString(json, "url").ifBlank { fallbackUrl }
            }
        }
        val duration = when {
            json.has("duration") -> json.optDouble("duration", 0.0)
            json.has("duration_seconds") -> json.optDouble("duration_seconds", 0.0)
            else -> 0.0
        }

        val track = JSObject()
        track.put("title", title)
        track.put("artist", artist.ifBlank { "Неизвестный исполнитель" })
        track.put("album", firstString(json, "album"))
        track.put("durationMs", (duration * 1000).toLong())
        track.put("sourceUrl", webpage)
        track.put("previewUrl", JSONObject.NULL)
        track.put("downloadUrl", webpage)
        track.put("query", listOf(artist, title).filter { it.isNotBlank() }.joinToString(" "))
        return track
    }

    private fun sourceFromJson(json: JSONObject, url: String): String {
        val extractor = firstString(json, "extractor_key", "extractor")
        return when {
            url.contains("youtube.com") || url.contains("youtu.be") -> "YouTube"
            extractor.isNotEmpty() -> extractor
            else -> "yt-dlp"
        }
    }

    private fun publish(snapshot: DownloadSnapshot) {
        snapshots[snapshot.id] = snapshot
        trigger(PROGRESS_EVENT, snapshotPayload(snapshot, snapshot.id))
    }

    private fun snapshotPayload(snapshot: DownloadSnapshot?, id: String): JSObject {
        val payload = JSObject()
        payload.put("id", snapshot?.id ?: id)
        payload.put("percent", snapshot?.percent ?: 0.0)
        payload.put("line", snapshot?.line ?: "")
        payload.put("status", snapshot?.status ?: "idle")
        payload.put("path", snapshot?.path ?: JSONObject.NULL)
        payload.put("error", snapshot?.error ?: JSONObject.NULL)
        payload.put("networkLimited", snapshot?.networkLimited ?: false)
        return payload
    }

    private fun worker(): ExecutorService {
        synchronized(initLock) {
            val current = executor
            if (current != null && !current.isShutdown) {
                return current
            }
            val created = Executors.newSingleThreadExecutor()
            executor = created
            return created
        }
    }

    private fun ensureInitialized() {
        synchronized(initLock) {
            if (initialized) return
            YoutubeDL.getInstance().init(activity.applicationContext)
            FFmpeg.getInstance().init(activity.applicationContext)
            initialized = true
        }
    }

    private fun ytdlpVersion(): String {
        cachedVersion?.let { return it }
        synchronized(versionLock) {
            cachedVersion?.let { return it }
            val request = YoutubeDLRequest(emptyList())
            request.addOption("--version")
            val version = YoutubeDL.execute(request).out.trim()
            cachedVersion = version
            return version
        }
    }

    private fun newestFile(directory: File, existing: Set<String>): String? {
        val files = directory.listFiles() ?: return null
        return files
            .filter { it.isFile && it.name !in existing }
            .maxByOrNull { it.lastModified() }
            ?.absolutePath
    }

    private fun cleanupPartial(directory: File, existing: Set<String>) {
        val files = directory.listFiles() ?: return
        files.forEach { file ->
            if (file.isFile && file.name !in existing) {
                file.delete()
            }
        }
    }

    private fun splitMediaTitle(rawTitle: String, fallbackArtist: String): Pair<String, String> {
        val uploader = fallbackArtist.trim().removeSuffix(" - Topic").trim()
        for (separator in listOf(" - ", " – ", " — ")) {
            val index = rawTitle.indexOf(separator)
            if (index > 0) {
                val left = rawTitle.substring(0, index).trim()
                val right = rawTitle.substring(index + separator.length).trim()
                if (left.isNotEmpty() && right.isNotEmpty()) {
                    return left to right
                }
            }
        }
        return (uploader.ifBlank { "Неизвестный исполнитель" }) to rawTitle.trim()
    }

    private fun firstString(json: JSONObject, vararg keys: String): String {
        for (key in keys) {
            val value = json.opt(key)
            if (value == null || value == JSONObject.NULL) {
                continue
            }
            val text = value.toString().trim()
            if (text.isNotEmpty()) {
                return text
            }
        }
        return ""
    }

    private fun describeInfoError(error: Exception): String {
        val message = describe(error)
        return if (isNetworkError(message)) {
            "Сеть ограничивает доступ к yt-dlp: $message"
        } else {
            message
        }
    }

    private fun describe(error: Exception): String {
        val parts = mutableListOf<String>()
        var current: Throwable? = error
        var depth = 0
        while (current != null && depth < 4) {
            val message = current.message?.trim().orEmpty()
            val label = current.javaClass.simpleName
            parts.add(if (message.isEmpty()) label else "$label: $message")
            current = current.cause
            depth += 1
        }
        val text = parts.joinToString(" <- ")
        return if (text.length > 1500) text.takeLast(1500) else text
    }

    private fun isNetworkError(message: String): Boolean =
        NETWORK_ERROR_HINTS.any { message.contains(it, ignoreCase = true) }

    private fun resolveOnUi(invoke: Invoke, result: JSObject) {
        activity.runOnUiThread { invoke.resolve(result) }
    }

    private fun rejectOnUi(invoke: Invoke, message: String) {
        activity.runOnUiThread { invoke.reject(message) }
    }

    companion object {
        private const val PROGRESS_EVENT = "download-progress"
        private const val INFO_TIMEOUT_SECONDS = 30L
        private val NETWORK_ERROR_HINTS = listOf(
            "handshake",
            "timed out",
            "timeout",
            "transport",
            "unable to download",
            "connection",
            "network",
            "ssl",
            "сеть ограничена",
        )
    }
}
