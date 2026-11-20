package app.nova.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

class NovaPlaybackService : MediaSessionService() {
    private var player: ExoPlayer? = null
    private var session: MediaSession? = null
    private lateinit var audioManager: AudioManager

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
            val exo = player ?: return
            if (!exo.playWhenReady) return
            // Pause ourselves instead of relying on ExoPlayer's own noisy
            // handler, so `lastNoisyAt` is set before the state change reaches
            // the listener below. That keeps the pending resume alive.
            lastNoisyAt = SystemClock.elapsedRealtime()
            pendingResume = true
            exo.pause()
        }
    }

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            if (addedDevices.none { isHeadphone(it.type) }) return
            val enabled = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getBoolean(KEY_RESUME_ON_HEADPHONES, false)
            if (!enabled) return
            if (pendingResume) {
                pendingResume = false
                player?.play()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setChannelId("nova_playback")
                .setChannelName(R.string.nova_playback_channel)
                .setNotificationId(1001)
                .build(),
        )
        val exo = ExoPlayer.Builder(this)
            .setRenderersFactory(NovaRenderersFactory(this))
            .build()
        exo.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        exo.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying &&
                    SystemClock.elapsedRealtime() - lastNoisyAt > MANUAL_PAUSE_GRACE_MS
                ) {
                    pendingResume = false
                }
            }
        })
        player = exo
        session = MediaSession.Builder(this, exo)
            .setId("nova-playback")
            .build()

        audioManager = getSystemService(AudioManager::class.java)
        audioManager.registerAudioDeviceCallback(
            deviceCallback,
            Handler(Looper.getMainLooper()),
        )
        ContextCompat.registerReceiver(
            this,
            noisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun onGetSession(
        controllerInfo: MediaSession.ControllerInfo,
    ): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val exo = player
        if (exo == null || !exo.playWhenReady) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        runCatching {
            audioManager.unregisterAudioDeviceCallback(deviceCallback)
        }
        runCatching { unregisterReceiver(noisyReceiver) }
        session?.release()
        session = null
        player?.release()
        player = null
        super.onDestroy()
    }

    companion object {
        const val PREFS = "nova_playback"
        const val KEY_RESUME_ON_HEADPHONES = "resume_on_headphones"
        private const val MANUAL_PAUSE_GRACE_MS = 1500L

        @Volatile
        private var pendingResume = false

        @Volatile
        private var lastNoisyAt = 0L

        /** A pause from Nova's own controls must not resume on a later plug. */
        fun onUserPause() {
            pendingResume = false
        }

        private fun isHeadphone(type: Int): Boolean = when (type) {
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_HEARING_AID,
            -> true
            else -> type == 31 // TYPE_BLE_HEADSET, API 31+
        }
    }
}
