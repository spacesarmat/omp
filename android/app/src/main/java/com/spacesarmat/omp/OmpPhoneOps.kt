package com.spacesarmat.omp

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.install.DevModeReminder
import com.spacesarmat.omp.rpc.PhoneRpcService
import com.spacesarmat.omp.rpc.RpcConfig
import com.spacesarmat.omp.rpc.SharedRpcPrefs
import com.spacesarmat.omp.sources.BillingTokens

/** Developer-mode reminder and the phone RPC server. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.devModeReminderOp(call: PluginCall) {
    val tv = call.getString("tv")?.trim().orEmpty()
    val at = call.getLong("at")
    if (tv.isEmpty()) {
        call.reject(I18n.s("plugin.noTv"))
    } else if (at == null) {
        DevModeReminder.cancel(context, tv, stableId(call))
        call.resolve()
    } else if (DevModeReminder.schedule(context, tv, call.getString("name"), at, stableId = stableId(call))) {
        call.resolve()
    } else {
        call.reject(I18n.s("plugin.badReminder"))
    }
}

internal fun OmpNativePlugin.stableId(call: PluginCall): String? = call.getString("id")?.trim()?.take(128)?.takeIf { it.isNotEmpty() }

internal fun OmpNativePlugin.devModeReminderStateOp(call: PluginCall) {
    val once = CallOnce(call)
    val tv = call.getString("tv")?.trim().orEmpty()
    if (tv.isEmpty()) {
        once.reject(I18n.s("plugin.noTv"))
        return
    }
    val id = stableId(call)
    io.execute {
        val o = JSObject()
        try {
            DevModeReminder.scheduledAt(context, tv, id)?.let { o.put("at", it) }
        } catch (_: Exception) {
        }
        once.resolve(o)
    }
}

internal fun OmpNativePlugin.phoneNameOp(call: PluginCall) {
    call.resolve(JSObject().put("name", deviceName()))
}

internal fun OmpNativePlugin.deviceName(): String = BillingTokens.modelName(Build.MANUFACTURER, Build.MODEL)

internal fun OmpNativePlugin.rpcSetEnabledOp(call: PluginCall) {
    val once = CallOnce(call)
    val on = call.getBoolean("on") ?: run {
        once.reject(I18n.s("errors.badRequest"))
        return
    }
    io.execute {
        try {
            val config = RpcConfig(SharedRpcPrefs(context))
            config.setEnabled(on)
            if (on) {
                PhoneRpcService.start(context)
                // wait briefly for the bind, so the answer carries the real port and running = true
                val until = System.currentTimeMillis() + OmpNativePlugin.RPC_START_WAIT_MS
                while (PhoneRpcService.runningPort < 0 && System.currentTimeMillis() < until) Thread.sleep(50)
            } else {
                PhoneRpcService.stop(context)
            }
            once.resolve(rpcInfoOf(config))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.stateFailed"))
        }
    }
}

internal fun OmpNativePlugin.rpcInfoOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            once.resolve(rpcInfoOf(RpcConfig(SharedRpcPrefs(context))))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.stateFailed"))
        }
    }
}

internal fun OmpNativePlugin.rpcInfoOf(config: RpcConfig): JSObject {
    if (!config.enabled) return JSObject().put("enabled", false)
    val bound = PhoneRpcService.runningPort
    val o = JSObject()
        .put("enabled", true)
        .put("running", bound > 0)
        .put("port", if (bound > 0) bound else config.port())
        .put("token", config.token())
        .put("name", deviceName().take(60))
    LocalTorrServer.wifiIpv4(context)?.let { o.put("ip", it) }
    return o
}
