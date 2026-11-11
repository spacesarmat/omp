package com.spacesarmat.omp

import android.net.nsd.NsdServiceInfo
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

internal fun OmpNativePlugin.irHardwareOp(call: PluginCall) {
    val (transmit, receive) = IrBlaster.hardware(context)
    call.resolve(JSObject().put("transmit", transmit).put("receive", receive))
}

internal fun OmpNativePlugin.irTransmitOp(call: PluginCall) {
    val once = CallOnce(call)
    val frequency = call.getInt("frequency") ?: 38000
    val arr = call.getArray("pulses")
    if (arr == null || arr.length() < 2 || arr.length() > 512) {
        once.reject(I18n.s("plugin.irFailed"))
        return
    }
    val pulses = IntArray(arr.length())
    for (i in 0 until arr.length()) {
        val n = arr.optInt(i, -1)
        if (n < 20 || n > 200000) {
            once.reject(I18n.s("plugin.irFailed"))
            return
        }
        pulses[i] = n
    }
    io.execute {
        try {
            IrBlaster.transmit(context, frequency, pulses)
            once.resolve()
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.irFailed"))
        }
    }
}

internal fun OmpNativePlugin.irLearnOp(call: PluginCall) {
    val once = CallOnce(call)
    io.execute {
        val learned = try {
            IrBlaster.learn(context)
        } catch (_: Exception) {
            null
        }
        if (learned == null || learned.size < 2) {
            once.resolve(JSObject().put("frequency", 0).put("pulses", JSArray()))
            return@execute
        }
        val arr = JSArray()
        for (n in learned) arr.put(n)
        once.resolve(JSObject().put("frequency", 38000).put("pulses", arr))
    }
}

internal fun OmpNativePlugin.samsungClickOp(call: PluginCall) {
    val once = CallOnce(call)
    val ip = call.getString("ip")?.trim().orEmpty()
    val path = call.getString("path").orEmpty()
    val body = call.getString("body").orEmpty()
    if (body.length > 2000) {
        once.reject(I18n.s("plugin.samsungFailed"))
        return
    }
    io.execute {
        try {
            val hello = SamsungRemote.click(ip, path, body)
            once.resolve(JSObject().put("message", hello))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.samsungFailed"))
        }
    }
}

internal fun OmpNativePlugin.discoverNetTvsOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
    val group = searchGroup(call)
    io.execute {
        try {
            val arr = JSArray()
            for (t in Ssdp.discoverPower(context, timeout)) {
                val o = JSObject().put("ip", t.ip).put("kind", t.kind).put("name", t.name)
                if (t.mac != null) o.put("mac", t.mac)
                arr.put(o)
            }
            for (info in OmpDiscovery.search(
                context,
                "_androidtvremote2._tcp",
                timeout,
                { toGoogle(it) },
                { it.getString("ip") ?: "" },
                group,
            )) arr.put(info)
            once.resolve(JSObject().put("tvs", arr))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.discoverFailed"))
        }
    }
}

private fun toGoogle(info: NsdServiceInfo): JSObject? {
    val ip = OmpDiscovery.ipv4Of(info) ?: return null
    return JSObject().put("ip", ip).put("kind", "google").put("name", info.serviceName ?: "Android TV")
}

internal fun OmpNativePlugin.discoverLearnersOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
    val group = searchGroup(call)
    io.execute {
        try {
            val arr = JSArray()
            for (info in OmpDiscovery.search(
                context,
                "_omp-ir._tcp",
                timeout,
                { toLearner(it) },
                { it.getString("ip") ?: "" },
                group,
            )) arr.put(info)
            once.resolve(JSObject().put("devices", arr))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.discoverFailed"))
        }
    }
}

private fun toLearner(info: NsdServiceInfo): JSObject? {
    val ip = OmpDiscovery.ipv4Of(info) ?: return null
    val port = if (info.port > 0) info.port else 80
    return JSObject().put("ip", ip).put("port", port).put("name", info.serviceName ?: "OMP IR")
}

internal fun OmpNativePlugin.setHdmiCecOp(call: PluginCall) {
    val enabled = call.getBoolean("enabled")
    if (enabled == null) {
        call.reject("enabled")
        return
    }
    if (!TvMode.isTv(context)) {
        call.resolve()
        return
    }
    try {
        CecPrefs.setEnabled(context, enabled)
        call.resolve()
    } catch (_: RuntimeException) {
        call.reject("prefs")
    }
}
