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
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Android TV with OMP found by NSD: control server address, service name, OMP version (TXT `v`). */
data class FoundOmpTv(val ip: String, val port: Int, val name: String, val version: String)

/**
 * NSD search for OMP on Android TV (`_omp._tcp`, registered by control/TvRemote). Blocking: call from a worker
 * thread. Services are resolved one at a time process-wide, across all service types and concurrent searches (older
 * Android allows a single resolve in flight); a failed resolve is retried once. Discovery stops at the deadline or on
 * [cancelGroup] of the search's group, and whatever has been resolved by then is returned.
 */
object OmpDiscovery {
    const val SERVICE_TYPE = "_omp._tcp"
    private const val TAG = "OmpDiscovery"
    private const val RESOLVE_TIMEOUT_MS = 3000L
    private const val RETRY_PAUSE_MS = 150L
    private const val POLL_SLICE_MS = 250L

    /** One resolve in flight for the whole process (fair: searches take turns). */
    private val resolveLock = Semaphore(1, true)

    /** Cancel generation per search group (one per screen); a search started under an older value stops. */
    private val generations = java.util.concurrent.ConcurrentHashMap<String, AtomicInteger>()

    private fun generationOf(group: String): AtomicInteger = generations.getOrPut(group) { AtomicInteger(0) }

    /** Stops only the searches started with [group] (the screen that asked has gone); others keep running. */
    fun cancelGroup(group: String) {
        generationOf(group).incrementAndGet()
    }

    /** A check that turns true once [group] is cancelled after this call; a null group is never cancelled. */
    fun cancelCheck(group: String?): () -> Boolean {
        if (group == null) return { false }
        val counter = generationOf(group)
        val start = counter.get()
        return { counter.get() != start }
    }

    /** Retry a resolve once when NSD reported a failure (e.g. FAILURE_ALREADY_ACTIVE) and time is left. */
    fun shouldRetry(attempt: Int, failed: Boolean, leftMs: Long): Boolean = failed && attempt == 0 && leftMs > RETRY_PAUSE_MS

    fun discover(context: Context, timeoutMs: Long, group: String? = null): List<FoundOmpTv> =
        search(context, SERVICE_TYPE, timeoutMs, { toFound(it) }, { it.ip }, group)

    /**
     * Generic NSD search: discovers [serviceType] until [timeoutMs], resolves services one at a time and maps each
     * resolved service with [map] (null = skip); the first result per [key] wins. [group] ties the search to a screen
     * for [cancelGroup]. Blocking.
     */
    @Suppress("DEPRECATION")
    fun <T> search(
        context: Context,
        serviceType: String,
        timeoutMs: Long,
        map: (NsdServiceInfo) -> T?,
        key: (T) -> String,
        group: String? = null,
    ): List<T> {
        val app = context.applicationContext
        val nsd = app.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return emptyList()
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as WifiManager?
        val lock = wifi?.createMulticastLock("omp-nsd")?.apply { setReferenceCounted(false) }
        val services = LinkedBlockingQueue<NsdServiceInfo>()
        val seen = HashSet<String>()
        val found = LinkedHashMap<String, T>()
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
        val cancelled = cancelCheck(group)
        var started = false
        try {
            lock?.acquire()
            nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
            started = true
            while (!cancelled()) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) break
                val service = services.poll(minOf(left, POLL_SLICE_MS), TimeUnit.MILLISECONDS) ?: continue
                val info = resolve(nsd, service, deadline, cancelled) ?: continue
                val item = map(info) ?: continue
                val k = key(item)
                if (!found.containsKey(k)) found[k] = item
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

    /** Resolves [service] under the process-wide lock, retrying once on failure; null when it did not resolve. */
    private fun resolve(nsd: NsdManager, service: NsdServiceInfo, deadline: Long, cancelled: () -> Boolean): NsdServiceInfo? {
        var attempt = 0
        while (true) {
            val left = deadline - System.currentTimeMillis()
            if (left <= 0 || cancelled()) return null
            if (!resolveLock.tryAcquire(left, TimeUnit.MILLISECONDS)) return null
            val r = try {
                resolveOnce(nsd, service, minOf(RESOLVE_TIMEOUT_MS, deadline - System.currentTimeMillis()))
            } finally {
                resolveLock.release()
            }
            if (r.info != null) return r.info
            if (!shouldRetry(attempt, r.failed, deadline - System.currentTimeMillis())) return null
            attempt++
            Thread.sleep(RETRY_PAUSE_MS)
        }
    }

    private class Resolved(val info: NsdServiceInfo?, val failed: Boolean)

    @Suppress("DEPRECATION")
    private fun resolveOnce(nsd: NsdManager, service: NsdServiceInfo, timeoutMs: Long): Resolved {
        if (timeoutMs <= 0) return Resolved(null, false)
        val done = CountDownLatch(1)
        var result: NsdServiceInfo? = null
        var failed = false
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                failed = true
                done.countDown()
            }
            override fun onServiceResolved(info: NsdServiceInfo) {
                result = info
                done.countDown()
            }
        }
        try {
            nsd.resolveService(service, listener)
        } catch (_: RuntimeException) {
            return Resolved(null, true)
        }
        if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            // a resolve still in flight would block the next one on older Android
            try {
                if (android.os.Build.VERSION.SDK_INT >= 34) nsd.stopServiceResolution(listener)
            } catch (_: RuntimeException) {
            }
            return Resolved(null, false)
        }
        return Resolved(result, failed)
    }

    /** IPv4 of a resolved service (API 34+: `host` is deprecated and may be IPv6 while an IPv4 is in `hostAddresses`). */
    @Suppress("DEPRECATION")
    fun ipv4Of(info: NsdServiceInfo): String? {
        val all = if (android.os.Build.VERSION.SDK_INT >= 34) info.hostAddresses else null
        return pickIpv4(all, info.host)
    }

    private fun toFound(info: NsdServiceInfo): FoundOmpTv? {
        val ip = ipv4Of(info) ?: return null
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
