package com.spacesarmat.omp

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.install.ApkAbi

/** APK download and install. Bodies for [OmpNativePlugin]. */

internal class ApkJob(val once: CallOnce, val url: String, val sha: String) {
    fun reject(message: String, code: String) = once.reject(message, code)
}

internal fun OmpNativePlugin.vlcAvailableOp(call: PluginCall) {
    call.resolve(JSObject().put("available", com.spacesarmat.omp.player.VlcAvailability.available(context)))
}

internal fun OmpNativePlugin.deviceAbiKeyOp(call: PluginCall) {
    call.resolve(JSObject().put("key", ApkAbi.key(Build.SUPPORTED_ABIS.toList()) ?: ""))
}

internal fun OmpNativePlugin.downloadAndInstallApkOp(call: PluginCall) {
    val once = CallOnce(call)
    // the feed's per-ABI APK for this device (arm64 / armv7) when the page passed them, else the universal one
    val apk = ApkAbi.choose(
        Build.SUPPORTED_ABIS.toList(),
        ApkAbi.Apk(call.getString("url")?.trim().orEmpty(), call.getString("sha256").orEmpty(), 0L),
        ApkAbi.parseApks(call.getObject("apks")),
    )
    val url = apk.url
    val sha = apk.sha256
    if (!ApkInstaller.canInstall(context)) {
        // the system page «Установка неизвестных приложений»; the install goes on when the user comes back with
        // the switch on (handleOnResume), else it ends with «Разрешите установку…»
        try {
            ApkInstaller.openInstallPermissionSettings(context)
        } catch (_: RuntimeException) {
            once.reject(I18n.s("plugin.allowInstall"), "omp")
            return
        }
        permissionWait?.job?.reject(I18n.s("plugin.updateBusy"), "omp")
        permissionWait = InstallPermissionWait(ApkJob(once, url, sha))
        return
    }
    startApkInstall(ApkJob(once, url, sha))
}

internal fun OmpNativePlugin.canInstallApksOp(call: PluginCall) {
    call.resolve(JSObject().put("granted", ApkInstaller.canInstall(context)))
}

internal fun OmpNativePlugin.startApkInstall(job: ApkJob) {
    val once = job.once
    val url = job.url
    val sha = job.sha
    if (!downloading.compareAndSet(false, true)) {
        once.reject(I18n.s("plugin.updateBusy"), "omp")
        return
    }
    io.execute {
        try {
            val apk = ApkInstaller.download(context, url, sha) { p ->
                emit("apkProgress", JSObject().put("percent", p))
            }
            ApkInstaller.install(context, apk)
            once.resolve()
        } catch (e: UserError) {
            once.reject(e.message ?: I18n.s("plugin.updateFailed"), "omp")
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.updateFailed"), "omp")
        } finally {
            downloading.set(false)
        }
    }
}
