package com.spacesarmat.omp.tls

import java.io.IOException
import java.net.SocketTimeoutException
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.internal.tls.OkHostnameVerifier
import org.json.JSONObject

/**
 * The page's requests to a TorrServer whose self-signed certificate the user trusted ([TorrServerTrust]): a page's
 * fetch() cannot use a pin, so they come here. Only https; http stays with the page.
 */
class TorrServerHttp {
    class Response(val status: Int, val body: ByteArray, val contentType: String?)

    /** Why it failed: [code] `tls-untrusted` / `tls-changed` (with [fingerprint]), `tls`, `timeout`, `network`, `bad-url`. */
    class Failure(val code: String, val fingerprint: String? = null) : IOException(code)

    private val client: OkHttpClient = run {
        val tm = TorrServerTrust.trustManager()
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(tm), SecureRandom())
        OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier(TorrServerTrust.verifier(OkHostnameVerifier))
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    class Call(val url: String, val method: String, val headers: Map<String, String>, val body: ByteArray?, val contentType: String?, val timeoutMs: Long)

    /** Blocking. Throws [Failure]. */
    fun request(c: Call): Response = request(c.url, c.method, c.headers, c.body, c.contentType, c.timeoutMs)

    /** Blocking. Throws [Failure]. */
    fun request(url: String, method: String, headers: Map<String, String>, body: ByteArray?, contentType: String?, timeoutMs: Long): Response {
        val target = httpsUrl(url) ?: throw Failure("bad-url")
        val b = Request.Builder().url(target)
        for ((k, v) in headers) b.header(k, v)
        if (method == "POST") b.post((body ?: ByteArray(0)).toRequestBody(contentType?.toMediaTypeOrNull()))
        else b.get()
        val call = client.newCall(b.build())
        call.timeout().timeout(timeoutMs.coerceIn(1000, 120_000), TimeUnit.MILLISECONDS)
        try {
            call.execute().use { r ->
                val src = r.body ?: return Response(r.code, ByteArray(0), null)
                val len = src.contentLength()
                if (len > MAX_BYTES) throw Failure("too-large")
                val bytes = src.byteStream().use { readCapped(it) }
                return Response(r.code, bytes, r.header("Content-Type"))
            }
        } catch (e: Failure) {
            throw e
        } catch (e: IOException) {
            throw failureOf(e)
        }
    }

    /**
     * What the certificate of [url]'s server is to OMP: `trusted` (the system or a pin accepted it and the server
     * answered), `untrusted` / `changed` with the leaf ([TorrServerTrust.lastSeen]), `tls` (refused for another
     * reason, a host name that does not match a valid certificate), `unreachable`.
     */
    fun inspect(url: String): Inspection {
        val target = httpsUrl(url) ?: return Inspection("bad-url", null, null)
        val hostPort = TorrServerTrust.key(target.host, target.port)
        val echo = target.newBuilder().encodedPath(target.encodedPath.trimEnd('/') + "/echo").query(null).build()
        return try {
            request(echo.toString(), "GET", emptyMap(), null, null, 8000)
            Inspection("trusted", hostPort, null)
        } catch (f: Failure) {
            when (f.code) {
                "tls-untrusted" -> Inspection("untrusted", hostPort, TorrServerTrust.lastSeen(hostPort))
                "tls-changed" -> Inspection("changed", hostPort, TorrServerTrust.lastSeen(hostPort))
                "tls" -> Inspection("tls", hostPort, null)
                else -> Inspection("unreachable", hostPort, null)
            }
        }
    }

    data class Inspection(val state: String, val hostPort: String?, val seen: TorrServerTrust.Seen?)

    companion object {
        const val MAX_BYTES = 32L * 1024 * 1024

        fun httpsUrl(url: String): HttpUrl? = url.toHttpUrlOrNull()?.takeIf { it.isHttps }

        fun failureOf(e: IOException): Failure {
            TorrServerTrust.failureOf(e)?.let { (kind, fp) -> return Failure("tls-$kind", fp) }
            return when (e) {
                is SSLException -> Failure("tls")
                is SocketTimeoutException -> Failure("timeout")
                else -> if (e.message?.contains("timeout", ignoreCase = true) == true) Failure("timeout") else Failure("network")
            }
        }

        fun readCapped(input: java.io.InputStream): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > MAX_BYTES) throw Failure("too-large")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }

        /**
         * A page's request { url, method, headers, body?, bodyBase64?, contentType?, timeoutMs } (the plugin and the
         * monitor page send the same shape). Throws [Failure] `bad-body`.
         */
        fun parse(o: JSONObject): Call {
            val headers = HashMap<String, String>()
            o.optJSONObject("headers")?.let { h ->
                val keys = h.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = h.opt(k)
                    if (v is String) headers[k] = v
                }
            }
            val body: ByteArray? = try {
                (o.opt("bodyBase64") as? String)?.let { unbase64(it) } ?: (o.opt("body") as? String)?.toByteArray(Charsets.UTF_8)
            } catch (_: IllegalArgumentException) {
                throw Failure("bad-body")
            }
            return Call(
                url = (o.opt("url") as? String).orEmpty(),
                method = if (o.opt("method") == "POST") "POST" else "GET",
                headers = headers,
                body = body,
                contentType = o.opt("contentType") as? String,
                timeoutMs = (o.opt("timeoutMs") as? Number)?.toLong() ?: 15_000L,
            )
        }

        /** The answer for a page: { status, base64, contentType? }. */
        fun reply(r: Response): JSONObject {
            val o = JSONObject().put("status", r.status).put("base64", base64(r.body))
            r.contentType?.let { o.put("contentType", it) }
            return o
        }

        fun base64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
        fun unbase64(s: String): ByteArray = Base64.getDecoder().decode(s)
    }
}
