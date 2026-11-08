package app.nova.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import app.nova.mobile.R
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Foreground service that keeps the native download worker alive while the app
 * is in the background, and mirrors queue progress in a low-importance
 * notification.
 *
 * The service intentionally owns no download state. Rust owns the queue; this
 * class only renders `{title, percent, status}` updates and, on the Android 14+
 * `dataSync` timeout, writes [TIMEOUT_MARKER] so the worker can pause the queue
 * before the system kills the process. The marker lives next to `nova.db` in
 * `dataDir`, which is exactly what Tauri resolves as `app_data_dir` on Android.
 */
class NovaTaskService : Service() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        ensureChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            // START_STICKY restart after a process kill: no live worker or task
            // state survives, so an empty notification would be an orphan.
            stopSelf(startId)
            return START_NOT_STICKY
        }

        when (intent.action) {
            ACTION_STOP -> {
                running = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
                return START_NOT_STICKY
            }

            ACTION_START, ACTION_UPDATE -> {
                val title = intent.getStringExtra(EXTRA_TITLE)
                val status = intent.getStringExtra(EXTRA_STATUS)
                synchronized(stateLock) {
                    if (!title.isNullOrBlank()) {
                        lastTitle = title
                    }
                    if (intent.hasExtra(EXTRA_PERCENT)) {
                        lastPercent = intent.getDoubleExtra(EXTRA_PERCENT, lastPercent)
                            .coerceIn(0.0, 100.0)
                    }
                    if (!status.isNullOrBlank()) {
                        lastStatus = status
                    }
                }
                ensureChannel()
                val notification = buildNotification()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                running = true
                return START_STICKY
            }
        }

        return START_STICKY
    }

    /**
     * Android 15 (`dataSync`) calls this when the foreground time budget is
     * exhausted. Pause the queue through the marker file, drop the foreground
     * notification, and stop without throwing: the process may stay alive and
     * the worker applies the pause on its next tick.
     *
     * Android 15 uses the two-argument overload for `dataSync`; the single-arg
     * one below stays for API 34 `shortService` and the debug simulation.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        handleTimeout()
        stopSelf(startId)
    }

    override fun onTimeout(startId: Int) {
        handleTimeout()
        stopSelf(startId)
    }

    override fun onDestroy() {
        running = false
        if (instance === this) {
            instance = null
        }
        super.onDestroy()
    }

    private fun handleTimeout() {
        writeTimeoutMarker()
        synchronized(stateLock) {
            lastStatus = STATUS_PAUSED
            lastPercent = 0.0
        }
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (error: Exception) {
            Log.w(TAG, "stopForeground after timeout failed", error)
        }
        running = false
    }

    private fun writeTimeoutMarker() {
        try {
            File(applicationContext.dataDir, TIMEOUT_MARKER).writeText("1")
        } catch (error: Exception) {
            Log.w(TAG, "cannot write $TIMEOUT_MARKER", error)
        }
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.nova_downloads_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.nova_downloads_channel_description)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val (title, percent, status) = synchronized(stateLock) {
            Triple(lastTitle, lastPercent, lastStatus)
        }
        val text = when {
            status == STATUS_PAUSED -> statusText(status)
            percent > 0.0 && status != STATUS_DONE ->
                "${statusText(status)} · ${percent.roundToInt()}%"
            else -> statusText(status)
        }

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title.ifBlank { getString(R.string.nova_downloads_default_title) })
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(status != STATUS_PAUSED)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)

        if (status == STATUS_PAUSED) {
            builder.setProgress(0, 0, false)
        } else if (percent > 0.0) {
            builder.setProgress(100, percent.roundToInt(), false)
        } else {
            builder.setProgress(0, 0, true)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }

        launchIntent()?.let { builder.setContentIntent(it) }
        return builder.build()
    }

    private fun launchIntent(): PendingIntent? {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun statusText(status: String): String = when (status) {
        STATUS_STARTING -> getString(R.string.nova_download_status_preparing)
        STATUS_DOWNLOADING -> getString(R.string.nova_download_status_downloading)
        STATUS_DONE -> getString(R.string.nova_download_status_done)
        STATUS_ERROR -> getString(R.string.nova_download_status_error)
        STATUS_PAUSED -> getString(R.string.nova_download_status_paused)
        else -> status.ifBlank { getString(R.string.nova_download_status_downloading) }
    }

    companion object {
        private const val TAG = "NovaTaskService"
        private const val CHANNEL_ID = "nova_downloads"
        private const val NOTIFICATION_ID = 2001
        private const val ACTION_START = "app.nova.download.action.START"
        private const val ACTION_UPDATE = "app.nova.download.action.UPDATE"
        private const val ACTION_STOP = "app.nova.download.action.STOP"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_PERCENT = "percent"
        private const val EXTRA_STATUS = "status"

        private const val STATUS_STARTING = "starting"
        private const val STATUS_DOWNLOADING = "downloading"
        private const val STATUS_DONE = "done"
        private const val STATUS_ERROR = "error"
        private const val STATUS_PAUSED = "paused"

        /** Read by the Rust worker; relative to `app_data_dir` (`dataDir`). */
        const val TIMEOUT_MARKER = "nova-task-timeout-pause"

        @Volatile
        private var running = false

        @Volatile
        private var instance: NovaTaskService? = null

        private val stateLock = Any()
        private var lastTitle = ""
        private var lastPercent = 0.0
        private var lastStatus = STATUS_STARTING
        private var lastPostAt = 0L

        /**
         * Starts (or reuses) the foreground service. Returns `false` when the
         * platform rejects the background start; the worker then retries on the
         * next task instead of assuming a service exists.
         */
        fun start(context: Context, title: String, percent: Double, status: String): Boolean {
            synchronized(stateLock) {
                if (title.isNotBlank()) lastTitle = title
                lastPercent = percent.coerceIn(0.0, 100.0)
                if (status.isNotBlank()) lastStatus = status
                lastPostAt = 0L
            }
            return try {
                val intent = Intent(context, NovaTaskService::class.java).apply {
                    action = ACTION_START
                    putExtra(EXTRA_TITLE, lastTitle)
                    putExtra(EXTRA_PERCENT, lastPercent)
                    putExtra(EXTRA_STATUS, lastStatus)
                }
                // A running foreground service may be addressed with a plain
                // `startService`; only the first start needs the FGS entry point
                // (and its background-start exemption).
                if (running) {
                    context.startService(intent)
                } else {
                    context.startForegroundService(intent)
                }
                true
            } catch (error: Exception) {
                // Android 12+ can refuse a foreground start from the background.
                Log.w(TAG, "cannot start foreground service", error)
                false
            }
        }

        /**
         * Posts a throttled progress update. No-op while the service is not
         * running so the legacy (pre-Task-4) JS path cannot spawn it by accident.
         * Updates are coalesced: at most one post per 500 ms for an unchanged
         * status, and terminal statuses are always applied immediately.
         */
        fun update(context: Context, title: String, percent: Double, status: String): Boolean {
            if (!running) {
                return false
            }
            val now = android.os.SystemClock.elapsedRealtime()
            synchronized(stateLock) {
                if (title.isNotBlank()) {
                    lastTitle = title
                }
                val nextPercent = percent.coerceIn(0.0, 100.0)
                val nextStatus = status.ifBlank { lastStatus }
                val terminal = nextStatus == STATUS_DONE || nextStatus == STATUS_ERROR
                val percentChanged = abs(nextPercent - lastPercent) >= 0.5
                if (nextStatus == lastStatus && !percentChanged) {
                    return true
                }
                if (!terminal && nextStatus == lastStatus && now - lastPostAt < UPDATE_INTERVAL_MS) {
                    return true
                }
                lastPercent = nextPercent
                lastStatus = nextStatus
                lastPostAt = now
            }
            return try {
                context.startService(
                    Intent(context, NovaTaskService::class.java).apply {
                        action = ACTION_UPDATE
                        putExtra(EXTRA_TITLE, title)
                        putExtra(EXTRA_PERCENT, percent.coerceIn(0.0, 100.0))
                        putExtra(EXTRA_STATUS, status)
                    },
                )
                true
            } catch (error: Exception) {
                Log.w(TAG, "cannot update notification", error)
                false
            }
        }

        fun stop(context: Context): Boolean {
            running = false
            return try {
                context.startService(
                    Intent(context, NovaTaskService::class.java).apply { action = ACTION_STOP },
                )
                true
            } catch (error: Exception) {
                Log.w(TAG, "cannot stop foreground service", error)
                false
            }
        }

        /**
         * Debug hook for API < 35 devices: runs the real timeout path on the
         * live instance so Android 13 test hardware can exercise pause/no-crash.
         * Falls back to the marker when the service is not running.
         */
        fun simulateTimeout(context: Context): Boolean {
            val service = instance
            if (service != null) {
                service.handleTimeout()
                try {
                    service.stopSelf()
                } catch (error: Exception) {
                    Log.w(TAG, "simulated timeout stop failed", error)
                }
                return true
            }
            return try {
                File(context.dataDir, TIMEOUT_MARKER).writeText("1")
                true
            } catch (error: Exception) {
                Log.w(TAG, "cannot simulate timeout", error)
                false
            }
        }

        private const val UPDATE_INTERVAL_MS = 500L
    }
}
