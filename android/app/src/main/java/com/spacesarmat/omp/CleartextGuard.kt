package com.spacesarmat.omp

import java.io.IOException
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Blocks cleartext HTTP to public IP literals. LAN / loopback HTTP (TorrServer, Jackett, control) stays allowed;
 * DNS hostnames are unchanged (use HTTPS for the public internet).
 */
object CleartextGuard {
    val interceptor: Interceptor = Interceptor { chain ->
        val req = chain.request()
        val url = req.url
        if (url.isHttps.not() && LanAddresses.isPublicIpHost(url.host)) {
            throw IOException("cleartext HTTP to public IP is not allowed")
        }
        chain.proceed(req)
    }
}
