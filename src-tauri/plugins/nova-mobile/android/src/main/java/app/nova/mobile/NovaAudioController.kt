package app.nova.mobile

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.plugin.JSObject
import java.io.File
import java.util.concurrent.Executor

class NovaAudioController(private val context: Context) {
    private var controller: MediaController? = null
    private val pending = mutableListOf<(MediaController) -> Unit>()
    private var items: List<AudioItemArg> = emptyList()
    private var volume = 0.78f
    private var muted = false
    private var repeatMode = "off"

    init {
        val token = SessionToken(
            context,
            ComponentName(context, NovaPlaybackService::class.java),
        )
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener(
            {
                try {
                    controller = future.get()
                    pending.forEach { it(controller!!) }
                    pending.clear()
                } catch (error: Exception) {
                    android.util.Log.e("NovaAudio", "MediaController failed", error)
                }
            },
            Executor { it.run() },
        )
    }

    private fun withController(action: (MediaController) -> Unit) {
        val current = controller
        if (current != null) {
            action(current)
        } else {
            pending.add(action)
        }
    }

    fun setQueue(args: AudioQueueArgs) {
        items = args.items.toList()
        repeatMode = args.repeat
        if (items.isEmpty()) {
            withController {
                it.clearMediaItems()
                it.stop()
            }
            return
        }

        val mediaItems = items.map { item ->
            val metadata = MediaMetadata.Builder()
                .setTitle(item.title)
                .setArtist(item.artist)
                .setAlbumTitle(item.album)
            val artwork = item.artworkPath
            if (!artwork.isNullOrBlank() && File(artwork).isFile) {
                metadata.setArtworkUri(Uri.fromFile(File(artwork)))
            }
            MediaItem.Builder()
                .setMediaId(item.id.toString())
                .setUri(Uri.fromFile(File(item.uri)))
                .setMediaMetadata(metadata.build())
                .build()
        }

        withController { player ->
            val startIndex = args.startIndex.coerceIn(0, mediaItems.lastIndex)
            player.setMediaItems(mediaItems, startIndex, args.positionMs.coerceAtLeast(0))
            player.repeatMode = repeatMode(args.repeat)
            player.prepare()
            player.playWhenReady = args.autoplay
        }
    }

    fun play() {
        withController { it.play() }
    }

    fun pause() {
        withController { it.pause() }
    }

    fun seek(positionMs: Long) {
        withController { it.seekTo(positionMs.coerceAtLeast(0)) }
    }

    fun setVolume(value: Double) {
        volume = value.coerceIn(0.0, 1.0).toFloat()
        if (!muted) {
            withController { it.volume = volume }
        }
    }

    fun setMuted(value: Boolean) {
        muted = value
        withController { it.volume = if (muted) 0f else volume }
    }

    fun setRepeat(mode: String) {
        repeatMode = mode
        withController { it.repeatMode = repeatMode(mode) }
    }

    fun state(): JSObject {
        val result = JSObject()
        val player = controller
        if (player == null) {
            result.put("currentIndex", -1)
            result.put("queueLength", 0)
            result.put("positionMs", 0L)
            result.put("durationMs", 0L)
            result.put("isPlaying", false)
            result.put("ended", false)
            return result
        }

        val index = if (player.mediaItemCount == 0) -1 else player.currentMediaItemIndex
        val itemDuration = items.getOrNull(index)?.durationMs ?: 0L
        val duration = if (player.duration > 0) player.duration else itemDuration
        result.put("currentIndex", index)
        result.put("queueLength", player.mediaItemCount)
        result.put("positionMs", player.currentPosition.coerceAtLeast(0))
        result.put("durationMs", duration)
        result.put("isPlaying", player.isPlaying)
        result.put("ended", player.playbackState == Player.STATE_ENDED)
        result.put("repeat", repeatMode)
        return result
    }

    private fun repeatMode(mode: String): Int = when (mode) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
    }
}
