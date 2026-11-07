package app.nova.mobile

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.io.IOException

private val ILLEGAL_FILENAME_CHARS = Regex("[\\\\/:*?\"<>|]")
private val SAFE_VOLUME = Regex("[A-Za-z0-9._-]+")

/**
 * Converts a document id from [DocumentsContract] into a plain filesystem path.
 *
 * `primary:Music` maps onto [primaryRoot], other volumes (`1234-ABCD:Music`) onto
 * `/storage/<volume>/<relative>`. Paths are joined with `/` instead of
 * [File] so the function stays host independent and can be unit tested on the JVM.
 * Ids with an empty/`.`/`..`/non-safe volume, or with `.`/`..` relative segments,
 * are rejected.
 */
internal fun treeDocumentIdToPath(documentId: String, primaryRoot: String): String? {
    val separator = documentId.indexOf(':')
    if (separator <= 0) return null
    val volume = documentId.substring(0, separator)
    if (volume == "." || volume == ".." || !SAFE_VOLUME.matches(volume)) return null
    val relative = documentId.substring(separator + 1).trim('/')
    if (relative.split('/').any { it == "." || it == ".." }) return null
    val root = if (volume == "primary") primaryRoot.trimEnd('/') else "/storage/$volume"
    if (root.isEmpty()) return null
    return if (relative.isEmpty()) root else "$root/$relative"
}

internal fun treeUriToPath(uri: Uri): String? {
    val documentId = try {
        DocumentsContract.getTreeDocumentId(uri)
    } catch (_: IllegalArgumentException) {
        return null
    }
    val path = treeDocumentIdToPath(
        documentId,
        Environment.getExternalStorageDirectory().absolutePath,
    ) ?: return null
    return if (File(path).isDirectory) path else null
}

/**
 * Copies the content behind [uri] into [targetDir] and returns the created file.
 * The display name keeps Unicode characters and the extension; only characters
 * that are illegal on a filesystem are replaced.
 */
internal fun copyContentToFile(context: Context, uri: Uri, targetDir: File): File {
    val name = sanitizeFileName(
        displayName(context, uri)?.takeIf { it.isNotBlank() } ?: fallbackName(context, uri),
    )
    if (!targetDir.exists() && !targetDir.mkdirs()) {
        throw IOException("Не удалось создать папку ${targetDir.absolutePath}")
    }
    val target = File(targetDir, "${System.currentTimeMillis()}-$name")
    val input = context.contentResolver.openInputStream(uri)
        ?: throw IOException("Не удалось открыть выбранный файл")
    input.use { source ->
        target.outputStream().use { sink -> source.copyTo(sink) }
    }
    return target
}

internal fun sanitizeFileName(name: String): String {
    val cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "_").trim()
    return cleaned.ifEmpty { "file" }
}

private fun displayName(context: Context, uri: Uri): String? {
    return try {
        context.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) cursor.getString(index) else null
                } else {
                    null
                }
            }
    } catch (_: Exception) {
        null
    }
}

private fun fallbackName(context: Context, uri: Uri): String {
    val extension = try {
        context.contentResolver.getType(uri)
            ?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
    } catch (_: Exception) {
        null
    }
    return if (extension.isNullOrBlank()) "file" else "file.$extension"
}
