package com.spacesarmat.omp.monitor

import androidx.work.NetworkType
import java.net.URLEncoder
import org.json.JSONObject

/** The periodic check as the app asks for it (monitorSchedule). */
data class MonitorSchedule(val enabled: Boolean, val hours: Int, val wifiOnly: Boolean)

/** Pure scheduling rules (tested on the JVM). */
object MonitorPlan {
    /** «Как часто»: 1 / 3 / 6 / 12 hours. */
    val HOURS = listOf(1, 3, 6, 12)
    const val DEFAULT_HOURS = 3

    /** Android stops the page after this long (spec: «Таймаут задачи — 3 минуты»). */
    const val RUN_LIMIT_MS = 3 * 60 * 1000L

    fun hours(v: Int?): Int = if (v != null && v in HOURS) v else DEFAULT_HOURS

    /** Defaults: on, every 3 hours, Wi-Fi only (the spec's defaults). */
    fun schedule(enabled: Boolean?, hours: Int?, wifiOnly: Boolean?): MonitorSchedule =
        MonitorSchedule(enabled ?: true, hours(hours), wifiOnly ?: true)

    /** «Только через Wi-Fi» → an unmetered network; otherwise any connection. */
    fun network(wifiOnly: Boolean): NetworkType = if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
}

/** Channels and notification ids. */
object MonitorIds {
    const val CHANNEL_SUBS = "omp-subs"
    const val CHANNEL_EPISODES = "omp-episodes"
    const val GROUP_SUBS = "omp-monitor-subs"
    const val GROUP_EPISODES = "omp-monitor-episodes"
    const val SUMMARY_SUBS = 7001
    const val SUMMARY_EPISODES = 7002
    private const val BASE = 0x10000

    /** The page's channel name → the Android channel; null when unknown. */
    fun channel(name: String?): String? = when (name) {
        "subs" -> CHANNEL_SUBS
        "episodes" -> CHANNEL_EPISODES
        else -> null
    }

    /** Stable notification id of a page item id ("sub:<id>", "ep:<hash>"), never a summary or the server's 8090. */
    fun item(id: String): Int = BASE + (id.hashCode() and 0x3fffffff)
}

/**
 * The page's own origin, http://localhost without a port (Capacitor's origin). Only it is served from the bundle and only
 * it may use the bridge; http://localhost:<port> and 127.0.0.1:8090 (the embedded TorrServer) go to the network.
 */
object MonitorOrigin {
    const val HOST = "localhost"
    const val ORIGIN = "http://localhost"

    /** [port] as android.net.Uri reports it: -1 when absent. */
    fun isPage(scheme: String?, host: String?, port: Int): Boolean =
        scheme.equals("http", ignoreCase = true) && host.equals(HOST, ignoreCase = true) && port == -1
}

/** Links handed to the app from a notification (read by the app through takeMonitorOpen / monitorOpen). */
object MonitorLinks {
    const val ACTION_OPEN = "com.spacesarmat.omp.MONITOR_OPEN"
    const val EXTRA_URL = "omp.monitorUrl"
    private val OPEN = Regex("^omp:news(\\?[A-Za-z0-9%._~=&+*-]*)?$")

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** `omp:news?sub=<subId>&finding=<key>` (+ `&watch=1` for «Смотреть на ТВ»). */
    fun open(subId: String, key: String, watch: Boolean): String =
        "omp:news?sub=" + enc(subId) + "&finding=" + enc(key) + (if (watch) "&watch=1" else "")

    /** The link of an intent (action + extra) when it is one of ours and well-formed. */
    fun fromIntent(action: String?, url: String?): String? =
        if (action == ACTION_OPEN && url != null && url.length <= 2000 && OPEN.matches(url)) url else null
}

/**
 * A notification button run in the background: «Добавить» (a subscription finding) or «Заменить» (a newer
 * release of a library series). Carried in the broadcast extras and the work input. Pure.
 */
data class MonitorAction(
    val kind: String,
    val subId: String,
    val key: String,
    /** The notification to update with the result. */
    val notifId: Int,
    val channel: String,
    /** Title shown while the action runs. */
    val title: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("kind", kind).put("subId", subId).put("key", key)
        .put("notifId", notifId).put("channel", channel).put("title", title)

    /** What the page gets (no Android ids). */
    fun forPage(): JSONObject = JSONObject().put("kind", kind).put("subId", subId).put("key", key)

    companion object {
        const val ADD = "add"
        const val REPLACE = "replace"
        const val EXTRA = "omp.monitorAction"
        const val MAX_ID = 300
        const val MAX_TITLE = 300

        fun of(kind: String?, subId: String?, key: String?, notifId: Int?, channel: String?, title: String?): MonitorAction? {
            if (kind != ADD && kind != REPLACE) return null
            if (subId.isNullOrEmpty() || subId.length > MAX_ID || key.isNullOrEmpty() || key.length > MAX_ID) return null
            if (notifId == null || channel != MonitorIds.CHANNEL_SUBS && channel != MonitorIds.CHANNEL_EPISODES) return null
            return MonitorAction(kind, subId, key, notifId, channel, (title ?: "").take(MAX_TITLE))
        }

        fun fromJson(text: String?): MonitorAction? {
            if (text.isNullOrEmpty()) return null
            return try {
                val o = JSONObject(text)
                of(
                    o.opt("kind") as? String,
                    o.opt("subId") as? String,
                    o.opt("key") as? String,
                    (o.opt("notifId") as? Number)?.toInt(),
                    o.opt("channel") as? String,
                    o.opt("title") as? String,
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
