package com.spacesarmat.omp

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.tls.TorrServerHttp
import com.spacesarmat.omp.tls.TorrServerTrust

/** TorrServer with a self-signed certificate the user trusted. Bodies for [OmpNativePlugin]. */

private val torrServerHttp by lazy { TorrServerHttp() }

/** { pins: ["host:port", ...] }: the TorrServer addresses whose certificate the user accepted. */
internal fun OmpNativePlugin.torrServerPinsOp(call: PluginCall) {
    val arr = JSArray()
    for (k in TorrServerTrust.pinned()) arr.put(k)
    call.resolve(JSObject().put("pins", arr))
}

/**
 * { url } → { state, hostPort, fingerprint?, subject?, issuer?, notAfter? }: whether the server's certificate is
 * trusted, or the leaf the user is asked about (state `untrusted` / `changed`).
 */
internal fun OmpNativePlugin.torrServerInspectOp(call: PluginCall) {
    val once = CallOnce(call)
    val url = call.getString("url").orEmpty()
    io.execute {
        try {
            val r = torrServerHttp.inspect(url)
            val o = JSObject().put("state", r.state)
            r.hostPort?.let { o.put("hostPort", it) }
            r.seen?.let {
                o.put("fingerprint", it.fingerprint)
                o.put("subject", it.subject)
                o.put("issuer", it.issuer)
                o.put("notAfter", it.notAfter)
            }
            once.resolve(o)
        } catch (_: Exception) {
            once.resolve(JSObject().put("state", "unreachable"))
        }
    }
}

/** { hostPort, fingerprint }: the user accepted that certificate (first connect or a changed one). */
internal fun OmpNativePlugin.torrServerTrustOp(call: PluginCall) {
    try {
        TorrServerTrust.trust(call.getString("hostPort").orEmpty(), call.getString("fingerprint").orEmpty())
        call.resolve()
    } catch (_: IllegalArgumentException) {
        call.reject("bad-pin", "bad-pin")
    }
}

/** { hostPort }: the pin is dropped (the server was removed). */
internal fun OmpNativePlugin.torrServerForgetOp(call: PluginCall) {
    TorrServerTrust.forget(call.getString("hostPort").orEmpty())
    call.resolve()
}

/**
 * { url, method, headers, body?, bodyBase64?, contentType?, timeoutMs } → { status, base64, contentType }. Rejects
 * with the [TorrServerHttp.Failure] code as both message and code (`tls-changed` carries the new fingerprint in
 * `data.fingerprint`).
 */
internal fun OmpNativePlugin.torrServerHttpOp(call: PluginCall) {
    val once = CallOnce(call)
    val req = try {
        TorrServerHttp.parse(call.data)
    } catch (f: TorrServerHttp.Failure) {
        return once.reject(f.code, f.code)
    }
    io.execute {
        try {
            once.resolve(JSObject.fromJSONObject(TorrServerHttp.reply(torrServerHttp.request(req))))
        } catch (f: TorrServerHttp.Failure) {
            once.reject(f.fingerprint ?: f.code, f.code)
        } catch (_: Exception) {
            once.reject("network", "network")
        }
    }
}
