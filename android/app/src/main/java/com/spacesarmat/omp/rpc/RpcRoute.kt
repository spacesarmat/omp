package com.spacesarmat.omp.rpc

import com.spacesarmat.omp.control.ControlHead
import com.spacesarmat.omp.control.ControlRequest
import com.spacesarmat.omp.control.ControlResponse
import com.spacesarmat.omp.control.ControlServer
import java.net.InetAddress
import java.security.MessageDigest
import org.json.JSONObject

/**
 * The only route of the phone RPC server: `POST /omp/<token>/rpc` with `{"method","params"}` from a LAN client.
 * A wrong path, a wrong token, a non-LAN client or a connection that arrived on an interface other than the phone's
 * Wi-Fi / Ethernet / hotspot ([arrivedOnLan], so CGNAT 10/8 peers on mobile data are refused) gets 404 `{}` before the
 * body is read; every handled call is
 * HTTP 200 with `{"ok":true,"result":…}` or `{"ok":false,"error":{"code","message"?}}`.
 */
class RpcRoute(
    private val token: () -> String,
    private val dispatcher: () -> RpcDispatcher?,
    /** The phone's own address the request arrived on is a LAN interface address (see [LanAddress.arrivedOn]). */
    private val arrivedOnLan: (InetAddress?) -> Boolean,
    private val allowed: (InetAddress?) -> Boolean = LanAddress::allowed,
) {
    companion object {
        val METHODS = setOf("sources", "search", "searchPoll", "searchCancel", "setSourceEnabled", "resolve")
        const val MAX_RESPONSE = 1_000_000
        private const val NOT_FOUND = "{}"

        fun failure(code: String, message: String? = null): String {
            val err = JSONObject().put("code", code)
            if (message != null) err.put("message", message)
            return JSONObject().put("ok", false).put("error", err).toString()
        }
    }

    fun precheck(head: ControlHead): ControlResponse? = when {
        !allowed(head.remote) -> ControlResponse(404, NOT_FOUND)
        !arrivedOnLan(head.local) -> ControlResponse(404, NOT_FOUND)
        !pathMatches(head.path) -> ControlResponse(404, NOT_FOUND)
        head.method != "POST" -> ControlResponse(405, failure("bad_request"))
        head.length > ControlServer.MAX_BODY -> ControlResponse(413, failure("bad_request"))
        else -> null
    }

    fun route(req: ControlRequest): ControlResponse {
        val length = req.body.toByteArray(Charsets.UTF_8).size.toLong()
        precheck(ControlHead(req.method, req.path, req.token, req.contentType, length, req.remote, req.local))?.let { return it }
        val o = try {
            JSONObject(req.body)
        } catch (_: Exception) {
            return ok(failure("bad_request"))
        }
        val method = o.opt("method") as? String ?: return ok(failure("bad_request"))
        val params = when (val p = o.opt("params")) {
            null, JSONObject.NULL -> JSONObject()
            is JSONObject -> p
            else -> return ok(failure("bad_request"))
        }
        if (method !in METHODS) return ok(failure("unknown_method"))
        val d = dispatcher() ?: return ok(failure("not_ready"))
        val answer = when (val out = d.call(method, params)) {
            is RpcOutcome.Ok -> "{\"ok\":true,\"result\":" + out.resultJson + "}"
            is RpcOutcome.Failed -> failure(out.code, out.message)
        }
        return ok(if (answer.length > MAX_RESPONSE) failure("failed") else answer)
    }

    /** Every origin may call (webOS pages have origin `null`); the token in the path is the credential. */
    fun cors(origin: String?): String? = "*"

    private fun ok(json: String) = ControlResponse(200, json)

    private fun pathMatches(path: String): Boolean {
        val expected = "/omp/" + token() + "/rpc"
        return MessageDigest.isEqual(path.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))
    }
}
