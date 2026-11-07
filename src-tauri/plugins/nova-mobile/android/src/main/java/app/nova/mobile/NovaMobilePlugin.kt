package app.nova.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File

@TauriPlugin
class NovaMobilePlugin(private val activity: Activity) : Plugin(activity) {
    private var audioController: NovaAudioController? = null

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
                arrayOf("audio/mpeg", "audio/flac", "audio/wav", "audio/ogg", "audio/mp4"),
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
        try {
            val importsDir = File(activity.applicationContext.filesDir, "nova-imports")
            val file = copyContentToFile(activity.applicationContext, uri, importsDir)
            resolvePath(invoke, file.absolutePath)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Не удалось скопировать выбранный файл")
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
}
