package com.spacesarmat.omp

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Android TV with OMP found by NSD: control server address, service name, OMP version (TXT `v`). */
data class FoundOmpTv(val ip: String, val port: Int, val name: String, val version: String)

/**
 * NSD search for OMP on Android TV (`_omp._tcp`, registered by control/TvRemote). Blocking: call from a worker
 * thread. Services are resolved one at a time (older Android allows a single resolve in flight); discovery stops
 * at the deadline and whatever has been resolved by then is returned.
 */
object OmpDiscovery {
    const val SERVICE_TYPE = "_omp._tcp"
    private const val TAG = "OmpDiscovery"
    private const val RESOLVE_TIMEOUT_MS = 3000L

    @Suppress("DEPRECATION")
    fun discover(context: Context, timeoutMs: Long): List<FoundOmpTv> {
        val app = context.applicationContext
        val nsd = app.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return emptyList()
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as WifiManager?
        val lock = wifi?.createMulticastLock("omp-nsd")?.apply { setReferenceCounted(false) }
        val services = LinkedBlockingQueue<NsdServiceInfo>()
        val seen = HashSet<String>()
        val found = LinkedHashMap<String, FoundOmpTv>()
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "discovery failed: $errorCode")
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                val name = info.serviceName ?: return
                synchronized(seen) { if (!seen.add(name)) return }
                services.offer(info)
            }
            override fun onServiceLost(info: NsdServiceInfo) {}
        }
        val deadline = System.currentTimeMillis() + timeoutMs
        var started = false
        try {
            lock?.acquire()
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            started = true
            while (true) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) break
                val service = services.poll(left, TimeUnit.MILLISECONDS) ?: break
                val tv = resolve(nsd, service, minOf(RESOLVE_TIMEOUT_MS, deadline - System.currentTimeMillis())) ?: continue
                if (!found.containsKey(tv.ip)) found[tv.ip] = tv
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "discovery error: ${e.message}")
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            if (started) {
                try {
                    nsd.stopServiceDiscovery(listener)
                } catch (_: RuntimeException) {
                }
            }
            try {
                lock?.release()
            } catch (_: RuntimeException) {
            }
        }
        return found.values.toList()
    }

    @Suppress("DEPRECATION")
    private fun resolve(nsd: NsdManager, service: NsdServiceInfo, timeoutMs: Long): FoundOmpTv? {
        if (timeoutMs <= 0) return null
        val done = CountDownLatch(1)
        var result: FoundOmpTv? = null
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                done.countDown()
            }
            override fun onServiceResolved(info: NsdServiceInfo) {
                result = toFound(info)
                done.countDown()
            }
        }
        try {
            nsd.resolveService(service, listener)
        } catch (_: RuntimeException) {
            return null
        }
        if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            // a resolve still in flight would block the next one on older Android
            try {
                if (android.os.Build.VERSION.SDK_INT >= 34) nsd.stopServiceResolution(listener)
            } catch (_: RuntimeException) {
            }
            return null
        }
        return result
    }

    @Suppress("DEPRECATION")
    private fun toFound(info: NsdServiceInfo): FoundOmpTv? {
        // API 34+: `host` is deprecated and may be an IPv6 address while an IPv4 one is in `hostAddresses`
        val all = if (android.os.Build.VERSION.SDK_INT >= 34) info.hostAddresses else null
        val ip = pickIpv4(all, info.host) ?: return null
        val version = info.attributes?.get("v")?.let { String(it, Charsets.UTF_8) }.orEmpty()
        return FoundOmpTv(ip, info.port, cleanName(info.serviceName), version)
    }

    /** First IPv4 of [addresses] (API 34+ `hostAddresses`), else [host] when it is IPv4. */
    fun pickIpv4(addresses: List<InetAddress>?, host: InetAddress?): String? {
        addresses?.firstOrNull { it is Inet4Address }?.hostAddress?.let { return it }
        return (host as? Inet4Address)?.hostAddress
    }

    /** NSD may hand back DNS-escaped names («Living\\032Room»); decodes `\\DDD` and `\\c`, falls back to «Android TV». */
    fun cleanName(raw: String?): String {
        if (raw.isNullOrBlank()) return "Android TV"
        val out = StringBuilder()
        var i = 0
        // consecutive \DDD escapes are UTF-8 bytes of one character
        val bytes = java.io.ByteArrayOutputStream()
        fun flush() {
            if (bytes.size() > 0) {
                out.append(String(bytes.toByteArray(), Charsets.UTF_8))
                bytes.reset()
            }
        }
        while (i < raw.length) {
            val c = raw[i]
            if (c == '\\' && i + 3 < raw.length && raw[i + 1].isDigit() && raw[i + 2].isDigit() && raw[i + 3].isDigit()) {
                val code = raw.substring(i + 1, i + 4).toInt()
                if (code in 0..255) {
                    bytes.write(code)
                    i += 4
                    continue
                }
            }
            flush()
            if (c == '\\' && i + 1 < raw.length) {
                out.append(raw[i + 1])
                i += 2
                continue
            }
            out.append(c)
            i++
        }
        flush()
        return out.toString().trim().ifEmpty { "Android TV" }
    }
}
