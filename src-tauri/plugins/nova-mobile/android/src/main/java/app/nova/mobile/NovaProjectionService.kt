package app.nova.mobile

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

/**
 * One-shot MediaProjection capture for system-audio recognition.
 *
 * Android 14+ requires a foreground service with the `mediaProjection` type to
 * be running before `getMediaProjection` is called, so the consent result is
 * handed to this service and the capture happens here. The resulting 16 kHz
 * mono WAV is uploaded to AudD by Rust.
 */
class NovaProjectionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf(startId)
            return START_NOT_STICKY
        }

        ensureChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        @Suppress("DEPRECATION")
        val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        val seconds = intent.getIntExtra(EXTRA_SECONDS, 12)

        thread(name = "nova-projection-capture") {
            var path: String? = null
            var error: String? = null
            try {
                path = capture(resultCode, data, seconds)
            } catch (exception: Exception) {
                error = exception.message ?: "Не удалось записать системный звук"
                Log.w(TAG, "projection capture failed", exception)
            }
            NovaMobilePlugin.deliverSystemAudio(path, error)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun capture(resultCode: Int, data: Intent?, seconds: Int): String {
        if (resultCode != Activity.RESULT_OK || data == null) {
            throw IllegalStateException("Захват системного звука отменён")
        }
        val manager = getSystemService(MediaProjectionManager::class.java)
            ?: throw IllegalStateException("MediaProjection недоступен")
        val projection = manager.getMediaProjection(resultCode, data)
            ?: throw IllegalStateException("Не удалось получить MediaProjection")

        try {
            val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build()
            val bufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            ).coerceAtLeast(SAMPLE_RATE) * 2
            val record = AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setAudioPlaybackCaptureConfig(config)
                .build()

            val output = ByteArrayOutputStream()
            val buffer = ByteArray(bufferSize)
            try {
                if (record.state != AudioRecord.STATE_INITIALIZED) {
                    throw IllegalStateException("Микрофон системного звука не инициализировался")
                }
                record.startRecording()
                val deadline = System.currentTimeMillis() + seconds * 1000L
                var total = 0L
                while (System.currentTimeMillis() < deadline) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        output.write(buffer, 0, read)
                        total += read
                    } else if (read < 0) {
                        throw IllegalStateException("Ошибка чтения системного звука: $read")
                    }
                }
                if (total == 0L) {
                    throw IllegalStateException("Системный звук не дал ни одного сэмпла")
                }
            } finally {
                runCatching { record.stop() }
                record.release()
            }

            val directory = File(cacheDir, "recognition").apply { mkdirs() }
            val file = File(directory, "system-${System.currentTimeMillis()}.wav")
            writeWav(file, output.toByteArray())
            return file.absolutePath
        } finally {
            runCatching { projection.stop() }
        }
    }

    private fun writeWav(file: File, pcm: ByteArray) {
        FileOutputStream(file).use { stream ->
            val dataSize = pcm.size
            val byteRate = SAMPLE_RATE * 2
            val header = ByteArray(44)
            fun putAscii(offset: Int, value: String) {
                value.toByteArray(Charsets.US_ASCII).copyInto(header, offset)
            }
            fun putLeInt(offset: Int, value: Int) {
                header[offset] = (value and 0xff).toByte()
                header[offset + 1] = ((value shr 8) and 0xff).toByte()
                header[offset + 2] = ((value shr 16) and 0xff).toByte()
                header[offset + 3] = ((value shr 24) and 0xff).toByte()
            }
            fun putLeShort(offset: Int, value: Int) {
                header[offset] = (value and 0xff).toByte()
                header[offset + 1] = ((value shr 8) and 0xff).toByte()
            }
            putAscii(0, "RIFF")
            putLeInt(4, 36 + dataSize)
            putAscii(8, "WAVE")
            putAscii(12, "fmt ")
            putLeInt(16, 16)
            putLeShort(20, 1)
            putLeShort(22, 1)
            putLeInt(24, SAMPLE_RATE)
            putLeInt(28, byteRate)
            putLeShort(32, 2)
            putLeShort(34, 16)
            putAscii(36, "data")
            putLeInt(40, dataSize)
            stream.write(header)
            stream.write(pcm)
        }
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.nova_recognition_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.nova_recognition_channel_description)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.nova_recognition_notification_title))
            .setContentText(getString(R.string.nova_recognition_notification_text))
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pending)
            .build()
    }

    companion object {
        const val ACTION_CAPTURE = "app.nova.mobile.action.CAPTURE_SYSTEM_AUDIO"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_SECONDS = "seconds"
        private const val TAG = "NovaProjectionService"
        private const val CHANNEL_ID = "nova_recognition"
        private const val NOTIFICATION_ID = 3001
        private const val SAMPLE_RATE = 16_000
    }
}
