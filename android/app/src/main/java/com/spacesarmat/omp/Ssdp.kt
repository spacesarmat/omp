package com.spacesarmat.omp

import android.content.Context
import android.net.wifi.WifiManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

data class FoundTv(val ip: String, val name: String, val model: String?)

/** SSDP discovery of LG webOS TVs (second-screen service). Blocking: call off the main thread. */
object Ssdp {
    private const val GROUP = "239.255.255.250"
    private const val PORT = 1900
    private const val ST = "urn:lge-com:service:webos-second-screen:1"
    private const val DEFAULT_NAME = "LG webOS TV"

    private val SEARCH = (
        "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: $GROUP:$PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\n" +
            "ST: $ST\r\n" +
            "\r\n"
        ).toByteArray(Charsets.US_ASCII)

    private val describeClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(1500, TimeUnit.MILLISECONDS)
            .readTimeout(1500, TimeUnit.MILLISECONDS)
            .callTimeout(1500, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .build()
    }

    fun discover(context: Context, timeoutMs: Long): List<FoundTv> {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager?
        val lock = wifi?.createMulticastLock("omp-ssdp")?.apply { setReferenceCounted(false) }
        val found = LinkedHashMap<String, String?>() // ip -> LOCATION
        try {
            lock?.acquire()
            DatagramSocket().use { socket ->
                val group = InetAddress.getByName(GROUP)
                // two probes: UDP multicast is lossy on Wi-Fi
                socket.send(DatagramPacket(SEARCH, SEARCH.size, group, PORT))
                socket.send(DatagramPacket(SEARCH, SEARCH.size, group, PORT))
                val deadline = System.currentTimeMillis() + timeoutMs
                val buf = ByteArray(2048)
                while (true) {
                    val left = deadline - System.currentTimeMillis()
                    if (left <= 0) break
                    socket.soTimeout = left.toInt().coerceAtLeast(1)
                    val packet = DatagramPacket(buf, buf.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        break
                    }
                    val ip = packet.address?.hostAddress ?: continue
                    val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                    val headers = parseHeaders(text) ?: continue
                    val st = headers["st"]
                    if (st != null && !st.equals(ST, ignoreCase = true)) continue
                    if (!found.containsKey(ip) || found[ip] == null) found[ip] = headers["location"]
                }
            }
        } finally {
            try {
                lock?.release()
            } catch (_: RuntimeException) {
            }
        }
        if (found.isEmpty()) return emptyList()

        val pool = Executors.newFixedThreadPool(found.size.coerceAtMost(8))
        try {
            val jobs = found.map { (ip, location) ->
                pool.submit(Callable { describe(ip, location) })
            }
            return jobs.map { job ->
                try {
                    job.get(3, TimeUnit.SECONDS)
                } catch (_: Exception) {
                    null
                }
            }.filterNotNull()
        } finally {
            pool.shutdownNow()
        }
    }

    /** "HTTP/1.1 200 OK" response -> lowercase header map, or null for anything else. */
    internal fun parseHeaders(text: String): Map<String, String>? {
        val lines = text.split("\r\n", "\n")
        if (lines.isEmpty() || !lines[0].startsWith("HTTP/1.1 200", ignoreCase = true)) return null
        val map = HashMap<String, String>()
        for (line in lines.drop(1)) {
            val i = line.indexOf(':')
            if (i <= 0) continue
            map[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
        }
        return map
    }

    private fun describe(ip: String, location: String?): FoundTv {
        val fallback = FoundTv(ip, DEFAULT_NAME, null)
        val url = location?.toHttpUrlOrNull() ?: return fallback
        // only ask the device that answered: LOCATION must not send us anywhere else
        if (url.host != ip) return fallback
        return try {
            describeClient.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                if (!resp.isSuccessful) return fallback
                val xml = resp.body?.string()?.take(64 * 1024) ?: return fallback
                val name = xmlTag(xml, "friendlyName")
                val model = xmlTag(xml, "modelName")
                FoundTv(ip, name ?: DEFAULT_NAME, model)
            }
        } catch (_: Exception) {
            fallback
        }
    }

    internal fun xmlTag(xml: String, tag: String): String? {
        val m = Regex("<(?:\\w+:)?$tag[^>]*>([^<]*)</(?:\\w+:)?$tag>").find(xml) ?: return null
        val v = m.groupValues[1]
            .replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&apos;", "'")
            .replace("&amp;", "&")
            .trim()
        return v.ifEmpty { null }
    }
}
