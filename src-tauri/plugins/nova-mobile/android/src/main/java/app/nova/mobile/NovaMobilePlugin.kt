package app.nova.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

@TauriPlugin(
    permissions = [
        Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO],
        ),
    ],
)
class NovaMobilePlugin(private val activity: Activity) : Plugin(activity) {
    private var audioController: NovaAudioController? = null
    private val importExecutor = Executors.newSingleThreadExecutor()

    override fun onDestroy(activity: AppCompatActivity) {
        importExecutor.shutdownNow()
    }

    private var coldIntentHandled = false

    override fun onNewIntent(intent: Intent) {
        activity.intent = intent
        handleOpenIntent(intent)
    }

    override fun onResume(activity: AppCompatActivity) {
        if (coldIntentHandled) return
        coldIntentHandled = true
        handleOpenIntent(activity.intent)
    }

    private fun handleOpenIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        importExecutor.execute {
            try {
                val inbox = File(
                    Environment.getExternalStorageDirectory(),
                    "Download/NovaInbox",
                ).apply { mkdirs() }
                val file = copyContentToFile(
                    activity.applicationContext,
                    uri,
                    inbox,
                )
                val payload = JSObject()
                payload.put("path", file.absolutePath)
                pendingOpenPath = file.absolutePath
                pendingOpenError = null
                trigger("open-file", payload)
            } catch (error: Exception) {
                val message = error.message ?: "Не удалось открыть файл"
                pendingOpenError = message
                val payload = JSObject()
                payload.put("error", message)
                trigger("open-file-error", payload)
            }
        }
    }

    private fun audio(): NovaAudioController =
        audioController ?: NovaAudioController(activity.applicationContext).also {
            audioController = it
        }

    @Command
    fun audioSetQueue(invoke: Invoke) {
        audio().setQueue(invoke.parseArgs(AudioQueueArgs::class.java))
        invoke.resolve()
    }

    @Command
    fun audioPlay(invoke: Invoke) {
        audio().play()
        invoke.resolve()
    }

    @Command
    fun audioPause(invoke: Invoke) {
        audio().pause()
        invoke.resolve()
    }

    @Command
    fun audioSeek(invoke: Invoke) {
        audio().seek(invoke.parseArgs(AudioSeekArgs::class.java).positionMs)
        invoke.resolve()
    }

    @Command
    fun audioSetVolume(invoke: Invoke) {
        audio().setVolume(invoke.parseArgs(AudioVolumeArgs::class.java).value)
        invoke.resolve()
    }

    @Command
    fun audioSetMuted(invoke: Invoke) {
        audio().setMuted(invoke.parseArgs(AudioMutedArgs::class.java).muted)
        invoke.resolve()
    }

    @Command
    fun audioSetRepeat(invoke: Invoke) {
        audio().setRepeat(invoke.parseArgs(AudioRepeatArgs::class.java).mode)
        invoke.resolve()
    }

    @Command
    fun audioSetEq(invoke: Invoke) {
        val args = invoke.parseArgs(AudioEqArgs::class.java)
        NovaEq.update(args.enabled, args.bands, args.preamp)
        invoke.resolve()
    }

    @Command
    fun audioState(invoke: Invoke) {
        invoke.resolve(audio().state())
    }

    @Command
    fun hasAllFilesAccess(invoke: Invoke) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            activity.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
        }
        val result = JSObject()
        result.put("granted", granted)
        invoke.resolve(result)
    }

    @Command
    fun openAllFilesSettings(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
            intent.data = Uri.parse("package:${activity.packageName}")
            activity.startActivity(intent)
        } else {
            activity.requestPermissions(
                arrayOf(
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE,
                ),
                700,
            )
        }
        invoke.resolve()
    }

    @Command
    fun requestNotifications(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= 33) {
            activity.requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                701,
            )
        }
        invoke.resolve()
    }

    @Command
    fun requestMicrophone(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            resolveGranted(invoke, true)
            return
        }
        requestPermissionForAlias("microphone", invoke, "microphoneResult")
    }

    @PermissionCallback
    fun microphoneResult(invoke: Invoke) {
        val granted = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        resolveGranted(invoke, granted)
    }

    private fun resolveGranted(invoke: Invoke, granted: Boolean) {
        val result = JSObject()
        result.put("granted", granted)
        invoke.resolve(result)
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val original = File(invoke.parseArgs(FilePathArgs::class.java).path)
        if (!original.isFile) {
            invoke.reject("Файл не найден")
            return
        }
        val file = try {
            shareableFile(original)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось подготовить файл")
            return
        }
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType(file.name)
                putExtra(Intent.EXTRA_STREAM, contentUri(file))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, "Поделиться"))
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось поделиться файлом")
        }
    }

    @Command
    fun openFile(invoke: Invoke) {
        val original = File(invoke.parseArgs(FilePathArgs::class.java).path)
        if (!original.isFile) {
            invoke.reject("Файл не найден")
            return
        }
        val file = try {
            shareableFile(original)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось подготовить файл")
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri(file), mimeType(file.name))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось открыть файл")
        }
    }

    @Command
    fun batteryState(invoke: Invoke) {
        val manager = activity.getSystemService(PowerManager::class.java)
        val result = JSObject()
        result.put(
            "ignoring",
            manager?.isIgnoringBatteryOptimizations(activity.packageName) ?: false,
        )
        result.put("manufacturer", Build.MANUFACTURER)
        invoke.resolve(result)
    }

    @Command
    fun takeOpenedFile(invoke: Invoke) {
        val result = JSObject()
        val path = pendingOpenPath
        val error = pendingOpenError
        pendingOpenPath = null
        pendingOpenError = null
        if (path == null) {
            result.put("path", JSONObject.NULL)
        } else {
            result.put("path", path)
        }
        if (error == null) {
            result.put("error", JSONObject.NULL)
        } else {
            result.put("error", error)
        }
        invoke.resolve(result)
    }

    @Command
    fun requestIgnoreBattery(invoke: Invoke) {
        val request = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${activity.packageName}"),
        )
        try {
            activity.startActivity(request)
        } catch (_: Exception) {
            activity.startActivity(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            )
        }
        invoke.resolve()
    }

    @Command
    fun openBatterySettings(invoke: Invoke) {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            )
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось открыть настройки батареи")
            return
        }
        invoke.resolve()
    }

    @Command
    fun openAutoStartSettings(invoke: Invoke) {
        val miui = Intent().apply {
            setClassName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity",
            )
        }
        try {
            activity.startActivity(miui)
        } catch (_: Exception) {
            activity.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${activity.packageName}"),
                ),
            )
        }
        invoke.resolve()
    }

    private fun contentUri(file: File): Uri =
        FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            file,
        )

    /**
     * FileProvider only exposes external/files/cache roots. A track downloaded
     * into the app-private `downloads` directory is copied to cache first.
     */
    private fun shareableFile(file: File): File {
        val roots = listOf(
            Environment.getExternalStorageDirectory().absolutePath,
            activity.filesDir.absolutePath,
            activity.cacheDir.absolutePath,
        )
        if (roots.any { root ->
                file.absolutePath == root ||
                    file.absolutePath.startsWith("$root${File.separator}")
            }
        ) {
            return file
        }
        val target = File(activity.cacheDir, "share/${file.name}")
        target.parentFile?.mkdirs()
        // Keep the sharing cache bounded: drop copies older than seven days.
        val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
        target.parentFile?.listFiles()?.forEach { old ->
            if (old != target && old.lastModified() < cutoff) old.delete()
        }
        file.copyTo(target, overwrite = true)
        return target
    }

    private fun mimeType(name: String): String {
        val extension = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(extension) ?: "audio/*"
    }

    private var projectionPending: Invoke? = null

    @Command
    fun captureSystemAudio(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            invoke.reject("Разрешите доступ к микрофону: он нужен и для системного звука")
            return
        }
        if (projectionPending != null) {
            invoke.reject("Запись системного звука уже идёт")
            return
        }
        val manager = activity.getSystemService(MediaProjectionManager::class.java)
        if (manager == null) {
            invoke.reject("MediaProjection недоступен на этом устройстве")
            return
        }
        projectionPending = invoke
        systemAudioResult = { path, error ->
            activity.runOnUiThread {
                if (projectionPending !== invoke) return@runOnUiThread
                projectionPending = null
                if (error != null) {
                    invoke.reject(error)
                } else {
                    val payload = JSObject()
                    payload.put("path", path)
                    invoke.resolve(payload)
                }
            }
        }
        try {
            startActivityForResult(
                invoke,
                manager.createScreenCaptureIntent(),
                "systemAudioConsent",
            )
        } catch (error: Exception) {
            projectionPending = null
            systemAudioResult = null
            invoke.reject(error.message ?: "Не удалось запросить захват экрана")
        }
    }

    @ActivityCallback
    fun systemAudioConsent(invoke: Invoke, result: ActivityResult) {
        if (projectionPending !== invoke) {
            return
        }
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            projectionPending = null
            systemAudioResult = null
            invoke.reject("Захват системного звука отменён")
            return
        }
        Handler(Looper.getMainLooper()).postDelayed({
            if (projectionPending === invoke) {
                projectionPending = null
                systemAudioResult = null
                invoke.reject("Запись системного звука не завершилась. Попробуйте ещё раз.")
            }
        }, 30_000)
        val intent = Intent(activity, NovaProjectionService::class.java).apply {
            action = NovaProjectionService.ACTION_CAPTURE
            putExtra(NovaProjectionService.EXTRA_RESULT_CODE, result.resultCode)
            putExtra(NovaProjectionService.EXTRA_RESULT_DATA, result.data)
            putExtra(NovaProjectionService.EXTRA_SECONDS, 12)
        }
        try {
            activity.startForegroundService(intent)
        } catch (error: Exception) {
            projectionPending = null
            systemAudioResult = null
            invoke.reject(error.message ?: "Не удалось запустить запись системного звука")
        }
    }

    @Command
    fun minimizeApp(invoke: Invoke) {
        activity.moveTaskToBack(true)
        invoke.resolve()
    }

    @Command
    fun pickImage(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        launchPicker(invoke, intent, "pickImageResult")
    }

    @Command
    fun pickAudio(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "audio/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf(
                    "audio/mpeg",
                    "audio/flac",
                    "audio/x-flac",
                    "audio/wav",
                    "audio/x-wav",
                    "audio/ogg",
                    "audio/opus",
                    "audio/mp4",
                    "audio/aac",
                    "audio/webm",
                    "audio/x-ms-wma",
                    "audio/aiff",
                ),
            )
        }
        launchPicker(invoke, intent, "pickAudioResult")
    }

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        launchPicker(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickImageResult(invoke: Invoke, result: ActivityResult) {
        copyPickedFile(invoke, result)
    }

    @ActivityCallback
    fun pickAudioResult(invoke: Invoke, result: ActivityResult) {
        copyPickedFile(invoke, result)
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            resolvePath(invoke, null)
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            resolvePath(invoke, null)
            return
        }
        val path = treeUriToPath(uri)
        if (path == null) {
            invoke.reject("Выберите папку во внутренней памяти")
            return
        }
        runCatching {
            val flags = result.data?.flags?.and(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            ) ?: 0
            activity.contentResolver.takePersistableUriPermission(uri, flags)
        }
        resolvePath(invoke, path)
    }

    private fun copyPickedFile(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            resolvePath(invoke, null)
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            resolvePath(invoke, null)
            return
        }
        val context = activity.applicationContext
        importExecutor.execute {
            try {
                val importsDir = File(context.filesDir, "nova-imports")
                val file = copyContentToFile(context, uri, importsDir)
                activity.runOnUiThread { resolvePath(invoke, file.absolutePath) }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    invoke.reject(error.message ?: "Не удалось скопировать выбранный файл")
                }
            }
        }
    }

    private fun resolvePath(invoke: Invoke, path: String?) {
        val payload = JSObject()
        if (path == null) {
            payload.put("path", JSONObject.NULL)
        } else {
            payload.put("path", path)
        }
        invoke.resolve(payload)
    }

    private fun launchPicker(invoke: Invoke, intent: Intent, callback: String) {
        try {
            startActivityForResult(invoke, intent, callback)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось открыть системный выбор файлов")
        }
    }

    companion object {
        @Volatile
        private var systemAudioResult: ((String?, String?) -> Unit)? = null

        @Volatile
        private var pendingOpenPath: String? = null

        @Volatile
        private var pendingOpenError: String? = null

        /** Called by [NovaProjectionService] after the WAV is written. */
        fun deliverSystemAudio(path: String?, error: String?) {
            val callback = systemAudioResult
            systemAudioResult = null
            callback?.invoke(path, error)
        }
    }
}
