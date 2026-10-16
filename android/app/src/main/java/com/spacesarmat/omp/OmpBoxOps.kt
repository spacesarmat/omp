package com.spacesarmat.omp

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.box.BoxBridge
import com.spacesarmat.omp.box.BoxCodes
import com.spacesarmat.omp.box.BoxFailure
import com.spacesarmat.omp.box.BoxRemote
import java.util.concurrent.ExecutorService

/** Phone remote for the whole Android TV box. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.makeBox(): BoxRemote =
    BoxBridge.create(context, deviceName(), adbIdentities(), object : BoxRemote.Events {
        override fun closed(via: String) {
            emit("boxClosed", JSObject().put("via", via))
        }

        override fun volume(level: Int, max: Int, muted: Boolean) {
            emit("boxVolume", JSObject().put("level", level).put("max", max).put("muted", muted))
        }
    })

/** Runs [work] off the main thread for a box call with a private-IPv4 `ip`; BoxFailure → its code. */
internal fun OmpNativePlugin.boxCall(call: PluginCall, needIp: Boolean, exec: ExecutorService = io, work: (String) -> JSObject?) {
    val once = CallOnce(call)
    val ip = call.getString("ip")?.trim().orEmpty()
    if (needIp && !PortProbe.isPrivateIpv4(ip)) {
        once.reject(BoxCodes.FAILED, BoxCodes.FAILED)
        return
    }
    exec.execute {
        try {
            once.resolve(work(ip))
        } catch (e: BoxFailure) {
            val detail = e.detail
            if (e.code == BoxCodes.CERT_CHANGED && !detail.isNullOrEmpty()) once.reject(detail, e.code)
            else once.reject(e.code, e.code)
        } catch (e: Throwable) {
            once.reject(BoxCodes.FAILED, BoxCodes.FAILED)
        }
    }
}

internal fun OmpNativePlugin.boxProbeOp(call: PluginCall) = boxCall(call, true) { ip ->
    val p = box.probe(ip)
    val o = JSObject().put("google", p.google).put("adb", p.adb)
    box.current(ip)?.let { o.put("via", it) }
    o
}

internal fun OmpNativePlugin.boxConnectOp(call: PluginCall) {
    val via = call.getString("via").orEmpty()
    boxCall(call, true) { ip -> JSObject().put("via", box.connect(ip, via)) }
}

internal fun OmpNativePlugin.boxPairStartOp(call: PluginCall) = boxCall(call, true) { ip ->
    box.pairStart(ip)
    null
}

internal fun OmpNativePlugin.boxPairFinishOp(call: PluginCall) {
    val code = call.getString("code").orEmpty()
    boxCall(call, true) { ip -> JSObject().put("via", box.pairFinish(ip, code)) }
}

internal fun OmpNativePlugin.boxPairCancelOp(call: PluginCall) = boxCall(call, false) {
    box.pairCancel()
    null
}

internal fun OmpNativePlugin.boxKeyOp(call: PluginCall) {
    val code = call.getInt("code") ?: -1
    val long = call.getBoolean("long", false) == true
    boxCall(call, false, boxKeys) {
        if (code !in 1..400) throw BoxFailure(BoxCodes.FAILED)
        box.key(code, long)
        null
    }
}

internal fun OmpNativePlugin.boxTextOp(call: PluginCall) {
    val text = call.getString("text").orEmpty().take(500)
    boxCall(call, false, boxKeys) { JSObject().put("typed", box.text(text)) }
}

internal fun OmpNativePlugin.boxDisconnectOp(call: PluginCall) = boxCall(call, false) {
    box.pairCancel()
    box.disconnect()
    null
}
