package com.spacesarmat.omp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
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

class ApkInstallTracker() : BroadcastReceiver() {
    private var apk: File? = null
    private var onInstalled: (() -> Unit)? = null

    constructor(context: Context, apk: File, onInstalled: () -> Unit) : this() {
        this.apk = apk
        this.onInstalled = onInstalled
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED && intent.action != Intent.ACTION_PACKAGE_REPLACED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED && intent.data?.schemeSpecificPart != context.packageName) return
        (apk ?: File(context.cacheDir, "updates/omp.apk")).delete()
        runCatching { context.unregisterReceiver(this) }
        onInstalled?.invoke()
    }
}

/** Download, SHA-256 check and hand-off to the system installer. Blocking: call off the main thread. */
object ApkInstaller {
    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val MAX_BYTES = 256L * 1024 * 1024

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addNetworkInterceptor(CleartextPolicy.interceptor())
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
    fun download(context: Context, url: String, sha256: String, progress: (Int) -> Unit): File =
        downloadToDir(File(context.cacheDir, "updates").apply { mkdirs() }, url, sha256, MAX_BYTES, progress)

    internal fun downloadToDir(dir: File, url: String, sha256: String, maxBytes: Long, progress: (Int) -> Unit): File {
        val expected = sha256.trim().lowercase()
        if (!Regex("[0-9a-f]{64}").matches(expected)) throw UserError(I18n.s("install.err.noChecksum"))
        val request = try {
            Request.Builder().url(url).build()
        } catch (_: IllegalArgumentException) {
            throw UserError(I18n.s("install.err.badUrl"))
        }
        val part = File(dir, "omp.apk.part")
        val target = File(dir, "omp.apk")
        part.delete()
        target.delete()
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw UserError(I18n.s("install.err.downloadHttp", "code" to resp.code.toString()))
                val body = resp.body ?: throw UserError(I18n.s("install.err.download"))
                val total = body.contentLength()
                if (total > maxBytes) throw UserError(I18n.s("install.err.download"))
                var done = 0L
                var lastPercent = -1
                progress(0)
                body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            done += n
                            if (done > maxBytes) throw UserError(I18n.s("install.err.download"))
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
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
            throw UserError(I18n.s("install.err.download"))
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            part.delete()
            throw UserError(I18n.s("install.err.corrupt"))
        }
        if (!part.renameTo(target)) {
            part.delete()
            throw UserError(I18n.s("install.err.save"))
        }
        progress(100)
        return target
    }

    /** Opens the system package installer for [apk] and calls [onInstalled] after the package is really installed. */
    fun install(context: Context, apk: File, onInstalled: () -> Unit) {
        val tracker = ApkInstallTracker(context, apk, onInstalled)
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(tracker, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(tracker, filter)
        }
        try {
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            context.unregisterReceiver(tracker)
            throw e
        }
    }
}
