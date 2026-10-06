package com.spacesarmat.omp.rpc

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * The phone's own addresses on its Wi-Fi, Ethernet and hotspot interfaces (never a VPN or mobile data), cached for
 * [TTL_MS]. [arrivedOn] is the RPC route's check of the local address a connection came in on.
 */
class LanInterfaces(ctx: Context) {
    private val app = ctx.applicationContext
    @Volatile
    private var cached: Pair<Long, List<InetAddress>>? = null

    fun arrivedOn(local: InetAddress?): Boolean = LanAddress.arrivedOn(local, addresses())

    fun addresses(): List<InetAddress> {
        val now = SystemClock.elapsedRealtime()
        cached?.let { (at, list) -> if (now - at < TTL_MS) return list }
        val fresh = collect()
        cached = now to fresh
        return fresh
    }

    private fun collect(): List<InetAddress> {
        val out = ArrayList<InetAddress>()
        try {
            val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
            if (cm != null) {
                @Suppress("DEPRECATION")
                for (n in cm.allNetworks) {
                    val caps = cm.getNetworkCapabilities(n) ?: continue
                    val lan = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    if (!lan) continue
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                        !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                    ) continue
                    val lp = cm.getLinkProperties(n) ?: continue
                    for (la in lp.linkAddresses) out.add(la.address)
                }
            }
        } catch (_: Exception) {
        }
        // the phone's own hotspot is not a network of ConnectivityManager: its interface by name (as LocalTorrServer)
        try {
            val all = NetworkInterface.getNetworkInterfaces()
            if (all != null) for (ni in all) {
                val name = ni.name ?: continue
                if (!ni.isUp) continue
                if (!(name.startsWith("wlan") || name.startsWith("swlan") || name.startsWith("ap") || name.startsWith("eth"))) continue
                for (a in ni.inetAddresses) out.add(a)
            }
        } catch (_: Exception) {
        }
        return out
    }

    private companion object {
        const val TTL_MS = 5_000L
    }
}
