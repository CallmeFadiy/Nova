package app.nova.mobile

import android.content.Context
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.tauri.plugin.JSObject
import java.io.File

class NovaAudioController(private val context: Context) {
    private var player: ExoPlayer? = null
    private var items: List<AudioItemArg> = emptyList()
    private var volume = 0.78f
    private var muted = false
    private var repeatMode = "off"

    private fun ensurePlayer(): ExoPlayer {
        val existing = player
        if (existing != null) return existing
        val created = ExoPlayer.Builder(context).build()
        created.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        created.repeatMode = Player.REPEAT_MODE_OFF
        created.volume = if (muted) 0f else volume
        player = created
        return created
    }

    fun setQueue(args: AudioQueueArgs) {
        val exo = ensurePlayer()
        items = args.items.toList()
        repeatMode = args.repeat
        exo.repeatMode = repeatMode(args.repeat)

        if (items.isEmpty()) {
            exo.clearMediaItems()
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

        val startIndex = args.startIndex.coerceIn(0, mediaItems.lastIndex)
        exo.setMediaItems(mediaItems, startIndex, args.positionMs.coerceAtLeast(0))
        exo.prepare()
        exo.playWhenReady = args.autoplay
    }

    fun play() {
        ensurePlayer().play()
    }

    fun pause() {
        player?.pause()
    }

    fun seek(positionMs: Long) {
        player?.seekTo(positionMs.coerceAtLeast(0))
    }

    fun setVolume(value: Double) {
        volume = value.coerceIn(0.0, 1.0).toFloat()
        if (!muted) {
            player?.volume = volume
        }
    }

    fun setMuted(value: Boolean) {
        muted = value
        player?.volume = if (muted) 0f else volume
    }

    fun setRepeat(mode: String) {
        repeatMode = mode
        player?.repeatMode = repeatMode(mode)
    }

    fun state(): JSObject {
        val exo = player
        val result = JSObject()
        if (exo == null) {
            result.put("currentIndex", -1)
            result.put("positionMs", 0L)
            result.put("durationMs", 0L)
            result.put("isPlaying", false)
            result.put("ended", false)
            return result
        }

        val index = exo.currentMediaItemIndex
        val itemDuration = items.getOrNull(index)?.durationMs ?: 0L
        val duration = if (exo.duration != C.TIME_UNSET && exo.duration > 0) {
            exo.duration
        } else {
            itemDuration
        }
        result.put("currentIndex", index)
        result.put("positionMs", exo.currentPosition.coerceAtLeast(0))
        result.put("durationMs", duration)
        result.put("isPlaying", exo.isPlaying)
        result.put("ended", exo.playbackState == Player.STATE_ENDED)
        result.put("repeat", repeatMode)
        return result
    }

    private fun repeatMode(mode: String): Int = when (mode) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
    }
}
