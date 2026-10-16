package com.spacesarmat.omp

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

/** SSDP, NSD and LAN discovery. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.discoverTvsOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
    io.execute {
        try {
            val tvs = Ssdp.discover(context, timeout)
            val arr = JSArray()
            for (t in tvs) {
                val o = JSObject()
                o.put("ip", t.ip)
                o.put("name", t.name)
                if (t.model != null) o.put("model", t.model)
                arr.put(o)
            }
            once.resolve(JSObject().put("tvs", arr))
        } catch (e: Exception) {
            once.reject(I18n.s("plugin.discoverFailed"))
        }
    }
}

internal fun OmpNativePlugin.discoverOmpTvsOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
    val group = searchGroup(call)
    io.execute {
        try {
            val arr = JSArray()
            for (t in OmpDiscovery.discover(context, timeout, group)) {
                arr.put(
                    JSObject().put("ip", t.ip).put("port", t.port).put("name", t.name).put("version", t.version),
                )
            }
            once.resolve(JSObject().put("tvs", arr))
        } catch (e: Exception) {
            once.reject(I18n.s("plugin.discoverFailed"))
        }
    }
}

internal fun OmpNativePlugin.discoverCastTvsOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
    val group = searchGroup(call)
    io.execute {
        try {
            val arr = JSArray()
            for (t in CastDiscovery.discover(context, timeout, group)) {
                val o = JSObject().put("ip", t.ip).put("name", t.name)
                if (t.model != null) o.put("model", t.model)
                arr.put(o)
            }
            once.resolve(JSObject().put("tvs", arr))
        } catch (e: Exception) {
            once.reject(I18n.s("plugin.discoverFailed"))
        }
    }
}

/** Optional search group of a discovery call (one per screen); at most 64 characters. */
internal fun OmpNativePlugin.searchGroup(call: PluginCall): String? = call.getString("group")?.trim()?.take(64)?.takeIf { it.isNotEmpty() }

internal fun OmpNativePlugin.stopDiscoveryOp(call: PluginCall) {
    searchGroup(call)?.let { OmpDiscovery.cancelGroup(it) }
    call.resolve()
}

internal fun OmpNativePlugin.probePortsOp(call: PluginCall) {
    val once = CallOnce(call)
    val ip = call.getString("ip")?.trim().orEmpty()
    val timeout = (call.getInt("timeoutMs") ?: 1500).coerceIn(200, 5000)
    val ports = ArrayList<Int>()
    val raw = call.getArray("ports")
    if (raw != null) {
        for (i in 0 until raw.length()) {
            val p = raw.optInt(i, -1)
            if (p > 0) ports.add(p)
        }
    }
    if (!PortProbe.isPrivateIpv4(ip)) {
        once.reject(I18n.s("plugin.badTvAddr"))
        return
    }
    io.execute {
        val arr = JSArray()
        for (p in PortProbe.open(ip, ports, timeout)) arr.put(p)
        once.resolve(JSObject().put("open", arr))
    }
}

internal fun OmpNativePlugin.scanLanOp(call: PluginCall) {
    val once = CallOnce(call)
    val timeout = (call.getInt("timeoutMs") ?: LanScan.DEFAULT_TIMEOUT_MS).coerceIn(150, 1500)
    val ports = ArrayList<Int>()
    val raw = call.getArray("ports")
    if (raw != null) {
        for (i in 0 until raw.length()) {
            val p = raw.optInt(i, -1)
            if (p > 0) ports.add(p)
        }
    }
    io.execute {
        val arr = JSArray()
        val ip = LocalTorrServer.wifiIpv4(context)
        if (ip != null) {
            for (h in LanScan.scan(ip, ports, timeout)) arr.put(JSObject().put("ip", h.ip).put("port", h.port))
        }
        once.resolve(JSObject().put("hits", arr).put("lan", ip != null))
    }
}
