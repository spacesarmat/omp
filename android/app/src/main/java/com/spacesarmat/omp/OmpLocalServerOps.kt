package com.spacesarmat.omp

import android.content.Context
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.spacesarmat.omp.install.failureOf
import org.json.JSONObject

/** Embedded TorrServer. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.localServerInfoOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            once.resolve(localInfo())
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.stateFailed"))
        }
    }
}

internal fun OmpNativePlugin.downloadLocalServerOp(call: PluginCall) {
    val once = CallOnce(call)
    if (!LocalTorrServer.supported()) {
        once.reject(OmpNativePlugin.NOT_SUPPORTED, "unsupported")
        return
    }
    io.execute {
        try {
            LocalTorrServer.download(context)
            once.resolve(localInfo())
        } catch (e: Throwable) {
            val f = failureOf(e)
            val mb = try {
                LocalTorrServer.pin(context).size / (1024 * 1024)
            } catch (_: Exception) {
                0L
            }
            once.reject(TorrServerBinary.downloadError(f.code, mb), f.code)
        }
    }
}

internal fun OmpNativePlugin.cancelLocalServerDownloadOp(call: PluginCall) {
    LocalTorrServer.cancelDownload()
    call.resolve()
}

internal fun OmpNativePlugin.startLocalServerOp(call: PluginCall) {
    if (!LocalTorrServer.supported()) {
        call.reject(OmpNativePlugin.NOT_SUPPORTED)
        return
    }
    val runnable = try {
        LocalTorrServer.installation(context).runnable()
    } catch (_: Exception) {
        false
    }
    if (!runnable) {
        call.reject(OmpNativePlugin.NOT_DOWNLOADED, "not-downloaded")
        return
    }
    // without the permission the service still runs, only its notification is hidden
    if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
        askPermission("notifications", call, "startAfterPermission")
        return
    }
    startLocal(call)
}

internal fun OmpNativePlugin.startAfterPermissionOp(call: PluginCall) {
    startLocal(call)
}

internal fun OmpNativePlugin.startLocal(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            runLocal()
            once.resolve(localInfo())
        } catch (e: UserError) {
            once.reject(e.message ?: OmpNativePlugin.START_FAILED)
        } catch (_: Exception) {
            once.reject(OmpNativePlugin.START_FAILED)
        }
    }
}

internal fun OmpNativePlugin.stopLocalServerOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            stopLocal()
            once.resolve()
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.stopFailed"))
        }
    }
}

internal fun OmpNativePlugin.localServerCacheOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.cacheSizeFailed"))
        }
    }
}

internal fun OmpNativePlugin.clearLocalServerCacheOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            val wasRunning = LocalTorrServer.running
            if (wasRunning) stopLocal()
            LocalTorrServer.clearDir(LocalTorrServer.cacheDir(context))
            if (wasRunning) runLocal()
            once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
        } catch (e: UserError) {
            once.reject(e.message ?: I18n.s("plugin.cacheClearFailed"))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.cacheClearFailed"))
        }
    }
}

internal fun OmpNativePlugin.localIpv4Op(call: PluginCall) {
    call.resolve(JSObject().put("ip", LocalTorrServer.wifiIpv4(context) ?: JSONObject.NULL))
}

internal fun OmpNativePlugin.vpnStateOp(call: PluginCall) {
    call.resolve(JSObject().put("active", LocalTorrServer.vpnOnActiveNetwork(context)))
}

internal fun OmpNativePlugin.localInfo(): JSObject {
    val o = JSObject()
    val supported = LocalTorrServer.supported()
    o.put("supported", supported)
    if (supported) {
        try {
            val install = LocalTorrServer.installation(context)
            o.put("binary", install.state().id)
            o.put("downloadBytes", install.pin.size)
            o.put("pinVersion", install.pin.tag)
            if (LocalTorrServer.downloading()) {
                o.put("downloading", true)
                LocalTorrServer.downloadPercent?.let { o.put("downloadPercent", it) }
            }
            o.put("mobileData", LocalTorrServer.onMobileData(context))
        } catch (_: Exception) {
            o.put("binary", BinaryState.MISSING.id)
        }
    }
    val running = LocalTorrServer.running
    o.put("running", running)
    if (running) {
        val v = LocalTorrServer.version ?: LocalTorrServer.echo(500)?.also { LocalTorrServer.version = it }
        if (v != null) o.put("version", v)
    }
    LocalTorrServer.wifiIpv4(context)?.let { o.put("ip", it) }
    o.put("vpn", LocalTorrServer.vpnActive(context))
    LocalTorrServer.error?.let { o.put("error", it) }
    return o
}

/** Starts the service and waits for `/echo` (300 ms steps, 15 s); configures the cache once. Blocking. */
internal fun OmpNativePlugin.runLocal() {
    val failures = LocalTorrServer.failures
    try {
        TorrServerService.start(context)
    } catch (_: RuntimeException) {
        throw UserError(OmpNativePlugin.START_FAILED)
    }
    val deadline = System.currentTimeMillis() + 15_000
    var version: String? = null
    while (System.currentTimeMillis() < deadline) {
        // only our own process counts (another app may hold the port)
        if (LocalTorrServer.running) {
            version = LocalTorrServer.echo(1000)
            if (version != null) break
        } else if (LocalTorrServer.failures != failures) {
            // the process gave up (port taken, crashed twice)
            throw UserError(LocalTorrServer.error ?: OmpNativePlugin.START_FAILED)
        }
        Thread.sleep(300)
    }
    if (version == null) {
        TorrServerService.stop(context)
        throw UserError(I18n.s("plugin.tsNoReply"))
    }
    LocalTorrServer.version = version
    val prefs = context.getSharedPreferences(OmpNativePlugin.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(OmpNativePlugin.CACHE_SET, false) && LocalTorrServer.configureCache(context)) {
        prefs.edit().putBoolean(OmpNativePlugin.CACHE_SET, true).apply()
    }
}

/** Stops the service and waits up to 6 s for the process to end. Blocking. */
internal fun OmpNativePlugin.stopLocal() {
    TorrServerService.stop(context)
    val deadline = System.currentTimeMillis() + 6_000
    while (LocalTorrServer.running && System.currentTimeMillis() < deadline) Thread.sleep(100)
}
