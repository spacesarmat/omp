package com.spacesarmat.omp

import android.content.Context
import android.net.nsd.NsdServiceInfo

/** A Google Cast device found by NSD: IPv4, friendly name (TXT `fn`), model (TXT `md`). */
data class FoundCastTv(val ip: String, val name: String, val model: String?)

/**
 * NSD search for Android TV / Google TV boxes (`_googlecast._tcp`) for the install assistant. Speakers and plain
 * Chromecasts answer too; the phone side sorts them by model. Blocking: call from a worker thread.
 */
object CastDiscovery {
    const val SERVICE_TYPE = "_googlecast._tcp"
    private const val MAX_TEXT = 80

    fun discover(context: Context, timeoutMs: Long, group: String? = null): List<FoundCastTv> =
        OmpDiscovery.search(context, SERVICE_TYPE, timeoutMs, { info -> toFound(info) }, { it.ip }, group)

    private fun toFound(info: NsdServiceInfo): FoundCastTv? {
        val ip = OmpDiscovery.ipv4Of(info) ?: return null
        val attrs = try {
            info.attributes
        } catch (_: RuntimeException) {
            null
        }
        return fromTxt(ip, info.serviceName, attrs)
    }

    /** Name: TXT `fn`, else the service name without its id suffix, else the model, else «Android TV». */
    fun fromTxt(ip: String, serviceName: String?, attrs: Map<String, ByteArray?>?): FoundCastTv {
        val model = txt(attrs, "md")
        val name = txt(attrs, "fn") ?: nameFromService(serviceName) ?: model ?: "Android TV"
        return FoundCastTv(ip, name, model)
    }

    /** A TXT value as trimmed UTF-8 without control characters (max 80); null when absent or blank. */
    fun txt(attrs: Map<String, ByteArray?>?, key: String): String? {
        val raw = attrs?.get(key) ?: return null
        val s = String(raw, Charsets.UTF_8).filter { !it.isISOControl() }.trim()
        return s.take(MAX_TEXT).trim().ifEmpty { null }
    }

    /** «BRAVIA-4K-VH2-1a2b3c4d5e6f7a8b9c0d» -> «BRAVIA 4K VH2»; null when only an id is left. */
    fun nameFromService(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val decoded = OmpDiscovery.cleanName(raw)
        val noId = decoded.replace(Regex("-[0-9a-fA-F]{16,}$"), "")
        val s = noId.replace('-', ' ').trim()
        if (s.isEmpty() || Regex("^[0-9a-fA-F]{16,}$").matches(s)) return null
        return s.take(MAX_TEXT).trim()
    }
}
