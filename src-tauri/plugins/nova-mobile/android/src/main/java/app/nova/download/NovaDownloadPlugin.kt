package app.nova.download

import android.app.Activity
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.util.concurrent.Executors

@InvokeArg
class DownloadProbeArgs {
    var url: String = ""
}

/**
 * Embedded yt-dlp bridge. `YoutubeDL.init` unpacks the bundled Python runtime into
 * the app's no-backup dir on first use, so it runs lazily on a worker thread.
 */
@TauriPlugin
class NovaDownloadPlugin(private val activity: Activity) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()
    private val initLock = Any()
    private var initialized = false

    override fun onDestroy(activity: AppCompatActivity) {
        executor.shutdownNow()
    }

    @Command
    fun downloadProbe(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadProbeArgs::class.java)
        val url = args.url.trim().ifEmpty { DEFAULT_PROBE_URL }
        executor.execute {
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

                try {
                    val infoStarted = System.currentTimeMillis()
                    val json = probeInfo(url)
                    result.put("title", json.optString("title", ""))
                    result.put("videoId", json.optString("id", ""))
                    result.put("extractor", json.optString("extractor_key", ""))
                    result.put("formats", json.optJSONArray("formats")?.length() ?: 0)
                    result.put("durationSec", json.optDouble("duration", 0.0))
                    result.put("infoMs", System.currentTimeMillis() - infoStarted)
                } catch (error: Throwable) {
                    val message = describe(error)
                    result.put("ok", false)
                    result.put("formats", 0)
                    result.put("networkLimited", isNetworkError(message))
                    result.put("error", message)
                }

                resolveOnUi(invoke, result)
            } catch (error: Throwable) {
                rejectOnUi(invoke, "yt-dlp probe failed: ${describe(error)}")
            }
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
        val request = YoutubeDLRequest(emptyList())
        request.addOption("--version")
        return YoutubeDL.execute(request).out.trim()
    }

    private fun probeInfo(url: String): JSONObject {
        val request = YoutubeDLRequest(url)
        request.addOption("--dump-single-json")
        request.addOption("--skip-download")
        request.addOption("--no-playlist")
        request.addOption("--no-warnings")
        val out = YoutubeDL.execute(request).out.trim()
        if (out.isEmpty()) {
            throw IllegalStateException("yt-dlp returned no JSON")
        }
        return JSONObject(out)
    }

    private fun describe(error: Throwable): String {
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
        private const val DEFAULT_PROBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        private val NETWORK_ERROR_HINTS = listOf(
            "handshake",
            "timed out",
            "timeout",
            "transport",
            "unable to download",
            "connection",
            "network",
            "ssl",
        )
    }
}
