package com.spacesarmat.omp

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.spacesarmat.omp.monitor.MonitorNotifier
import com.spacesarmat.omp.monitor.MonitorPlan
import com.spacesarmat.omp.monitor.MonitorScheduler
import org.json.JSONObject

/** Monitoring notifications and magnet intake. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.monitorScheduleOp(call: PluginCall) {
    if (TvMode.isTv(context)) return call.reject(OmpNativePlugin.MONITOR_PHONE_ONLY)
    val s = MonitorPlan.schedule(call.getBoolean("enabled"), call.getInt("hours"), call.getBoolean("wifiOnly"))
    val once = CallOnce(call)
    io.execute {
        try {
            MonitorScheduler.apply(context, s)
            // the channels show up in the system settings as soon as monitoring is on
            if (s.enabled) MonitorNotifier.ensureChannels(context)
            once.resolve()
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.MONITOR_FAILED)
        }
    }
}

internal fun OmpNativePlugin.monitorRunNowOp(call: PluginCall) {
    if (TvMode.isTv(context)) return call.reject(OmpNativePlugin.MONITOR_PHONE_ONLY)
    val once = CallOnce(call)
    io.execute {
        try {
            MonitorScheduler.runNow(context)
            once.resolve()
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.MONITOR_FAILED)
        }
    }
}

internal fun OmpNativePlugin.monitorStatusOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        try {
            once.resolve(JSObject.fromJSONObject(MonitorScheduler.status(context)))
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.MONITOR_FAILED)
        }
    }
}

internal fun OmpNativePlugin.monitorNotifyPermissionOp(call: PluginCall) {
    call.resolve(JSObject().put("state", notifyState()))
}

internal fun OmpNativePlugin.requestMonitorNotifyPermissionOp(call: PluginCall) {
    MonitorNotifier.ensureChannels(context)
    if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
        return call.resolve(JSObject().put("state", notifyState()))
    }
    askPermission("notifications", call, "monitorPermissionDone")
}

internal fun OmpNativePlugin.monitorPermissionDoneOp(call: PluginCall) {
    call.resolve(JSObject().put("state", notifyState()))
}

internal fun OmpNativePlugin.notifyState(): String {
    if (Build.VERSION.SDK_INT >= 33) {
        when (getPermissionState("notifications")) {
            PermissionState.GRANTED -> {}
            PermissionState.DENIED -> return "denied"
            else -> return "prompt"
        }
    }
    return if (MonitorNotifier.canNotify(context)) "granted" else "denied"
}

internal fun OmpNativePlugin.takeMonitorOpenOp(call: PluginCall) {
    val url = synchronized(OmpNativePlugin.magnetLock) {
        val u = OmpNativePlugin.pendingOpen
        OmpNativePlugin.pendingOpen = null
        u
    }
    call.resolve(JSObject().put("url", url ?: JSONObject.NULL))
}

internal fun OmpNativePlugin.emitMonitorOpen(url: String) {
    if (listening("monitorOpen")) {
        synchronized(OmpNativePlugin.magnetLock) { if (OmpNativePlugin.pendingOpen == url) OmpNativePlugin.pendingOpen = null }
        emit("monitorOpen", JSObject().put("url", url))
    }
}

internal fun OmpNativePlugin.takePendingMagnetOp(call: PluginCall) {
    val link = synchronized(OmpNativePlugin.magnetLock) {
        val l = OmpNativePlugin.pendingMagnet
        OmpNativePlugin.pendingMagnet = null
        l
    }
    call.resolve(JSObject().put("link", link ?: JSONObject.NULL))
}

internal fun OmpNativePlugin.emitMagnet(link: String) {
    // delivered to a live listener: no longer pending
    if (listening("magnetReceived")) {
        synchronized(OmpNativePlugin.magnetLock) { if (OmpNativePlugin.pendingMagnet == link) OmpNativePlugin.pendingMagnet = null }
        emit("magnetReceived", JSObject().put("link", link))
    }
}
