package com.spacesarmat.omp.monitor

import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import org.json.JSONArray
import org.json.JSONObject

/** A notification the page asks for (validated). */
data class NotifySpec(
    val channel: String,
    /** The page's stable item id ("sub:<id>", "ep:<hash>"). */
    val itemId: String,
    val subId: String,
    val key: String,
    val title: String,
    val text: String,
    /** MonitorAction.ADD / REPLACE or null. */
    val action: String?,
) {
    val notifId: Int get() = MonitorIds.item(itemId)
}

/** Messages of the background page (mobile/src/monitor/host.ts): { id, op, ... }. Pure: tested on the JVM. */
sealed class BridgeRequest {
    data class Start(val id: Int) : BridgeRequest()
    data class Http(val id: Int, val spec: HttpSpec) : BridgeRequest()
    /** [key] is already the namespaced storage key. */
    data class SecretGet(val id: Int, val key: String) : BridgeRequest()
    data class Notify(val id: Int, val spec: NotifySpec) : BridgeRequest()
    /** Dedup markers for [MonitorJournal] (validated when stored). */
    data class Persist(val id: Int, val items: JSONArray) : BridgeRequest()
    /** The summary as the page sent it (re-serialized, size-capped). */
    data class Finish(val summary: JSONObject?) : BridgeRequest()
    /** A malformed request; answered with [error] when it has an id. */
    data class Invalid(val id: Int?, val error: String) : BridgeRequest()
}

object BridgeProtocol {
    const val BAD_MESSAGE = "Неверный запрос"
    const val MAX_MESSAGE = 1_000_000
    const val MAX_TITLE = 200
    const val MAX_TEXT = 500
    const val MAX_SUMMARY = 4_000

    fun parse(text: String?): BridgeRequest {
        if (text == null || text.length > MAX_MESSAGE) return BridgeRequest.Invalid(null, BAD_MESSAGE)
        val o = try {
            JSONObject(text)
        } catch (e: Exception) {
            return BridgeRequest.Invalid(null, BAD_MESSAGE)
        }
        val id = (o.opt("id") as? Number)?.toInt()
        val op = o.opt("op") as? String
        if (op == "finish") return BridgeRequest.Finish(summary(o.optJSONObject("summary")))
        if (id == null) return BridgeRequest.Invalid(null, BAD_MESSAGE)
        return when (op) {
            "start" -> BridgeRequest.Start(id)
            "http" -> try {
                BridgeRequest.Http(id, HttpSpec.parse(o.optJSONObject("request")))
            } catch (e: SiteHttpException) {
                BridgeRequest.Invalid(id, e.reason)
            }
            "secretGet" -> SourceServices.jsSecretKey(o.opt("key") as? String)?.let { BridgeRequest.SecretGet(id, it) }
                ?: BridgeRequest.Invalid(id, SourceServices.SECRETS_FAILED)
            "persist" -> o.optJSONArray("items")?.takeIf { it.length() <= MonitorJournal.MAX_ITEMS }?.let { BridgeRequest.Persist(id, it) }
                ?: BridgeRequest.Invalid(id, BAD_MESSAGE)
            "notify" -> notify(o.optJSONObject("notification"))?.let { BridgeRequest.Notify(id, it) }
                ?: BridgeRequest.Invalid(id, BAD_MESSAGE)
            else -> BridgeRequest.Invalid(id, BAD_MESSAGE)
        }
    }

    fun notify(o: JSONObject?): NotifySpec? {
        if (o == null) return null
        val channel = MonitorIds.channel(o.opt("channel") as? String) ?: return null
        val itemId = (o.opt("id") as? String)?.takeIf { it.isNotEmpty() && it.length <= MonitorAction.MAX_ID } ?: return null
        val subId = (o.opt("subId") as? String)?.takeIf { it.isNotEmpty() && it.length <= MonitorAction.MAX_ID } ?: return null
        val key = (o.opt("key") as? String)?.takeIf { it.isNotEmpty() && it.length <= MonitorAction.MAX_ID } ?: return null
        val title = (o.opt("title") as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val text = (o.opt("text") as? String)?.trim() ?: ""
        val action = when (o.opt("action")) {
            MonitorAction.ADD -> MonitorAction.ADD
            MonitorAction.REPLACE -> MonitorAction.REPLACE
            else -> null
        }
        return NotifySpec(channel, itemId, subId, key, title.take(MAX_TITLE), text.take(MAX_TEXT), action)
    }

    /** null for a missing or oversized summary (it is stored in SharedPreferences). */
    private fun summary(o: JSONObject?): JSONObject? = o?.takeIf { it.toString().length <= MAX_SUMMARY }

    fun ok(id: Int, value: Any?): String = JSONObject().put("id", id).put("ok", true).put("value", value ?: JSONObject.NULL).toString()

    fun error(id: Int, message: String): String = JSONObject().put("id", id).put("ok", false).put("error", message).toString()
}
