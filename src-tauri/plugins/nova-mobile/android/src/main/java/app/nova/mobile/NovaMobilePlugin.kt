package app.nova.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class NovaMobilePlugin(private val activity: Activity) : Plugin(activity) {
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
}
