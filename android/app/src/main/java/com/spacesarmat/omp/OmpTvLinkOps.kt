package com.spacesarmat.omp

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** TV and pointer sockets. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.tvConnectOp(call: PluginCall) {
    val once = CallOnce(call)
    val ip = call.getString("ip")?.trim().orEmpty()
    val register = call.getString("register")
    if (!OmpNativePlugin.IPV4.matches(ip)) {
        once.reject(I18n.s("plugin.badTvAddr2"))
        return
    }
    if (register.isNullOrEmpty()) {
        once.reject(I18n.s("plugin.noRegMsg"))
        return
    }
    closeAll()
    var self: TvSocket? = null
    I18n.load(context)
    val socket = TvSocket(
        onOpen = { s ->
            if (s.port == 3001) CertPins.commit(ip)
            if (!s.send(register)) {
                s.close()
                clearTv(s)
                once.reject(I18n.s("plugin.tvSendFailed"))
            } else {
                synchronized(lock) { if (pendingConnect === once) pendingConnect = null }
                once.resolve(JSObject().put("port", s.port))
            }
        },
        onFail = { reason ->
            clearTv(self)
            val fp = CertPins.changedFingerprint(reason)
            if (fp != null) once.reject(fp, "cert-changed")
            else once.reject(I18n.s("plugin.tvConnectFailed"))
        },
        onMessage = { text -> emit("tvMessage", JSObject().put("json", text)) },
        onClosed = { reason ->
            if (clearTv(self)) {
                closePointer()
                emit("tvClosed", JSObject().put("reason", reason))
            }
        },
    )
    self = socket
    synchronized(lock) {
        tv = socket
        tvIp = ip
        pendingConnect = once
    }
    val preferPort = call.getInt("preferPort")?.takeIf { it == 3000 || it == 3001 }
    socket.race(
        listOf(
            TvCandidate(3000, "ws://$ip:3000/", TvHttp.plain()),
            TvCandidate(3001, "wss://$ip:3001/", TvHttp.trustingOnly(ip)),
        ),
        preferPort,
    )
}

internal fun OmpNativePlugin.tvSendOp(call: PluginCall) {
    val json = call.getString("json")
    val socket = synchronized(lock) { tv }
    when {
        json.isNullOrEmpty() -> call.reject(I18n.s("plugin.emptyMsg"))
        socket == null || !socket.isOpen -> call.reject(I18n.s("plugin.tvNotConnected"))
        !socket.send(json) -> call.reject(I18n.s("plugin.tvCmdFailed"))
        else -> call.resolve()
    }
}

internal fun OmpNativePlugin.tvDisconnectOp(call: PluginCall) {
    closeAll()
    call.resolve()
}

internal fun OmpNativePlugin.pointerConnectOp(call: PluginCall) {
    val once = CallOnce(call)
    val raw = call.getString("url")?.trim().orEmpty()
    val ip = synchronized(lock) { if (tv?.isOpen == true) tvIp else null }
    if (ip == null) {
        once.reject(I18n.s("plugin.tvNotConnected"))
        return
    }
    // OkHttp parses ws/wss as http/https
    val parsed = raw.replaceFirst(Regex("^ws", RegexOption.IGNORE_CASE), "http").toHttpUrlOrNull()
    if (parsed == null || !raw.matches(Regex("^wss?://.*", RegexOption.IGNORE_CASE)) || parsed.host != ip) {
        once.reject(I18n.s("plugin.badRemoteAddr"))
        return
    }
    closePointer()
    var self: TvSocket? = null
    val client = if (parsed.isHttps) TvHttp.trustingOnly(ip) else TvHttp.plain()
    I18n.load(context)
    val socket = TvSocket(
        onOpen = { _ ->
            if (parsed.isHttps) CertPins.commit(ip)
            synchronized(lock) { if (pendingPointer === once) pendingPointer = null }
            once.resolve()
        },
        onFail = { reason ->
            clearPointer(self)
            val fp = CertPins.changedFingerprint(reason)
            if (fp != null) once.reject(fp, "cert-changed")
            else once.reject(I18n.s("plugin.remoteConnectFailed"))
        },
        onMessage = { _ -> },
        onClosed = { _ -> clearPointer(self) },
    )
    self = socket
    synchronized(lock) {
        pointer = socket
        pendingPointer = once
    }
    socket.connect(listOf(raw), listOf(client))
}

internal fun OmpNativePlugin.pointerSendOp(call: PluginCall) {
    val frame = call.getString("frame")
    val socket = synchronized(lock) { pointer }
    when {
        frame.isNullOrEmpty() -> call.reject(I18n.s("plugin.emptyCmd"))
        socket == null || !socket.isOpen -> call.reject(I18n.s("plugin.remoteNotConnected"))
        !socket.send(frame) -> call.reject(I18n.s("plugin.tvCmdFailed"))
        else -> call.resolve()
    }
}

/** Forgets [only] if it is still the current TV socket; true if it was. */
internal fun OmpNativePlugin.clearTv(only: TvSocket?): Boolean =
    synchronized(lock) {
        if (only != null && tv === only) {
            tv = null
            tvIp = null
            pendingConnect = null
            true
        } else {
            false
        }
    }

internal fun OmpNativePlugin.clearPointer(only: TvSocket?) {
    synchronized(lock) {
        if (only != null && pointer === only) {
            pointer = null
            pendingPointer = null
        }
    }
}

internal fun OmpNativePlugin.closePointer() {
    val (socket, pending) = synchronized(lock) {
        val r = pointer to pendingPointer
        pointer = null
        pendingPointer = null
        r
    }
    socket?.close()
    pending?.reject(I18n.s("plugin.connectCancelled"))
}

/** Silent close of both sockets; a pending tvConnect is rejected. No tvClosed event. */
internal fun OmpNativePlugin.closeAll() {
    closePointer()
    val (socket, pending) = synchronized(lock) {
        val r = tv to pendingConnect
        tv = null
        tvIp = null
        pendingConnect = null
        r
    }
    socket?.close()
    pending?.reject(I18n.s("plugin.connectCancelled"))
}
