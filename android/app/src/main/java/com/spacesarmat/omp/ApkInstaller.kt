package com.spacesarmat.omp

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request

/** Thrown with a user-facing (Russian) message. */
class UserError(message: String) : Exception(message)

/** Download, SHA-256 check and hand-off to the system installer. Blocking: call off the main thread. */
object ApkInstaller {
    private const val APK_MIME = "application/vnd.android.package-archive"

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    fun canInstall(context: Context): Boolean =
        context.packageManager.canRequestPackageInstalls()

    /** System screen "Install unknown apps" for this package. */
    fun openInstallPermissionSettings(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            ("package:" + context.packageName).toUri(),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /** Downloads [url] to cacheDir/updates/omp.apk and verifies [sha256]; [progress] gets 0..100. */
    fun download(context: Context, url: String, sha256: String, progress: (Int) -> Unit): File {
        val expected = sha256.trim().lowercase()
        if (!Regex("[0-9a-f]{64}").matches(expected)) throw UserError("Нет контрольной суммы обновления")
        val request = try {
            Request.Builder().url(url).build()
        } catch (_: IllegalArgumentException) {
            throw UserError("Некорректная ссылка на обновление")
        }
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val part = File(dir, "omp.apk.part")
        val target = File(dir, "omp.apk")
        part.delete()
        target.delete()
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw UserError("Не удалось скачать обновление (HTTP ${resp.code})")
                val body = resp.body ?: throw UserError("Не удалось скачать обновление")
                val total = body.contentLength()
                var done = 0L
                var lastPercent = -1
                progress(0)
                body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val p = ((done * 100) / total).toInt().coerceIn(0, 100)
                                if (p != lastPercent) {
                                    lastPercent = p
                                    progress(p)
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: UserError) {
            part.delete()
            throw e
        } catch (e: IOException) {
            part.delete()
            throw UserError("Не удалось скачать обновление")
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            part.delete()
            throw UserError("Файл повреждён (контрольная сумма)")
        }
        if (!part.renameTo(target)) {
            part.delete()
            throw UserError("Не удалось сохранить обновление")
        }
        progress(100)
        return target
    }

    /** Opens the system package installer for [apk] via FileProvider. */
    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
