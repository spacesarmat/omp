package com.spacesarmat.omp.rpc

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject

/** What the page answered to one RPC call. */
sealed class RpcOutcome {
    data class Ok(val resultJson: String) : RpcOutcome()
    data class Failed(val code: String, val message: String?) : RpcOutcome()
}

/**
 * Forwards RPC calls to the hidden page and waits for its reply. [send] posts `{"rpc":n,"method":m,"params":{…}}`
 * to the page and returns false when no page is attached ([RpcOutcome.Failed] `not_ready` at once). A reply that
 * does not come within [waitMs] gives `timeout`, and a late one is dropped. At most [MAX_WAITING] calls wait at once.
 */
class RpcDispatcher(private val send: (String) -> Boolean, private val waitMs: Long = 4_500) {
    companion object {
        const val MAX_WAITING = 8
    }

    private val ids = AtomicInteger()
    private val waiting = AtomicInteger()
    private val pending = ConcurrentHashMap<Int, CompletableFuture<RpcOutcome>>()

    /** Blocks the calling worker thread until the page answers, the wait runs out or [failAll]. */
    fun call(method: String, params: JSONObject): RpcOutcome {
        if (waiting.incrementAndGet() > MAX_WAITING) {
            waiting.decrementAndGet()
            return RpcOutcome.Failed("not_ready", null)
        }
        val id = nextId()
        val future = CompletableFuture<RpcOutcome>()
        pending[id] = future
        try {
            val msg = JSONObject().put("rpc", id).put("method", method).put("params", params).toString()
            val posted = try {
                send(msg)
            } catch (_: Exception) {
                false
            }
            if (!posted) return RpcOutcome.Failed("not_ready", null)
            return try {
                future.get(waitMs, TimeUnit.MILLISECONDS)
            } catch (_: TimeoutException) {
                RpcOutcome.Failed("timeout", null)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                RpcOutcome.Failed("timeout", null)
            } catch (_: ExecutionException) {
                RpcOutcome.Failed("failed", null)
            }
        } finally {
            pending.remove(id)
            waiting.decrementAndGet()
        }
    }

    /** The page's reply to call [rpc]; ignored when nobody waits for it any more. */
    fun onReply(rpc: Int, ok: Boolean, result: Any?, code: String?, message: String?) {
        val future = pending.remove(rpc) ?: return
        future.complete(if (ok) RpcOutcome.Ok(toJson(result)) else RpcOutcome.Failed(code ?: "failed", message))
    }

    /** The page is gone: every waiting call ends with [code]. */
    fun failAll(code: String) {
        for (id in pending.keys.toList()) pending.remove(id)?.complete(RpcOutcome.Failed(code, null))
    }

    private fun nextId(): Int {
        while (true) {
            val id = ids.incrementAndGet()
            if (id > 0) return id
            ids.compareAndSet(id, 0) // wrapped around: start again from 1
        }
    }

    private fun toJson(v: Any?): String = when (v) {
        null, JSONObject.NULL -> "null"
        is JSONObject, is JSONArray -> v.toString()
        is Boolean -> v.toString()
        is Number -> if (v is Double && !v.isFinite() || v is Float && !v.isFinite()) "null" else v.toString()
        else -> JSONObject.quote(v.toString())
    }
}
