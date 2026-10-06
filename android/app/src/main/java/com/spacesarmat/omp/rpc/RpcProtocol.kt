package com.spacesarmat.omp.rpc

import com.spacesarmat.omp.monitor.BridgeProtocol
import com.spacesarmat.omp.monitor.BridgeRequest
import org.json.JSONObject

/** A message of the hidden RPC page (mobile/src/rpc/host.ts) to [RpcPageHost]. */
sealed class RpcPageMessage {
    /** `{op:'ready'}`: the page is listening; its reply proxy becomes the push channel. */
    object Ready : RpcPageMessage()

    /** `{op:'rpcReply', rpc, ok, result | error:{code, message}}`: the answer to one call of [RpcDispatcher]. */
    data class Reply(val rpc: Int, val ok: Boolean, val result: Any?, val code: String?, val message: String?) : RpcPageMessage()

    /** Only [BridgeRequest.Http] and [BridgeRequest.SecretGet]: the page reads sites and secrets like the monitor page. */
    data class Bridge(val request: BridgeRequest) : RpcPageMessage()

    /** A malformed or refused message; answered with [error] when it has an id. */
    data class Invalid(val id: Int?, val error: String) : RpcPageMessage()
}

/** Messages between [RpcPageHost] and the page. Pure: tested on the JVM. */
object RpcProtocol {
    const val MAX_MESSAGE = 1_000_000
    private const val MAX_CODE = 64
    private const val MAX_TEXT = 500

    fun parse(text: String?): RpcPageMessage {
        if (text == null || text.length > MAX_MESSAGE) return RpcPageMessage.Invalid(null, BridgeProtocol.BAD_MESSAGE)
        val o = try {
            JSONObject(text)
        } catch (_: Exception) {
            return RpcPageMessage.Invalid(null, BridgeProtocol.BAD_MESSAGE)
        }
        val id = (o.opt("id") as? Number)?.toInt()
        return when (o.opt("op")) {
            "ready" -> RpcPageMessage.Ready
            "rpcReply" -> reply(o) ?: RpcPageMessage.Invalid(null, BridgeProtocol.BAD_MESSAGE)
            // the monitor bridge validates these two; every other monitor op (start, notify, persist, finish) is refused
            "http", "secretGet" -> when (val r = BridgeProtocol.parse(text)) {
                is BridgeRequest.Http, is BridgeRequest.SecretGet -> RpcPageMessage.Bridge(r)
                is BridgeRequest.Invalid -> RpcPageMessage.Invalid(r.id, r.error)
                else -> RpcPageMessage.Invalid(id, BridgeProtocol.BAD_MESSAGE)
            }
            else -> RpcPageMessage.Invalid(id, BridgeProtocol.BAD_MESSAGE)
        }
    }

    /** The call [rpc] for the page: `{"rpc":n,"method":m,"params":{…}}`. */
    fun request(rpc: Int, method: String, params: JSONObject): String =
        JSONObject().put("rpc", rpc).put("method", method).put("params", params).toString()

    private fun reply(o: JSONObject): RpcPageMessage.Reply? {
        val rpc = (o.opt("rpc") as? Number)?.toInt()?.takeIf { it > 0 } ?: return null
        val ok = o.opt("ok") as? Boolean ?: return null
        if (ok) return RpcPageMessage.Reply(rpc, true, o.opt("result"), null, null)
        val err = o.optJSONObject("error")
        val code = (err?.opt("code") as? String)?.takeIf { it.isNotEmpty() && it.length <= MAX_CODE } ?: "failed"
        val message = (err?.opt("message") as? String)?.take(MAX_TEXT)
        return RpcPageMessage.Reply(rpc, false, null, code, message)
    }
}
