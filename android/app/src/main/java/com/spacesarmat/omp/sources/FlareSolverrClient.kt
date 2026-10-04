package com.spacesarmat.omp.sources

import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * The user's own FlareSolverr (the fallback when the built-in check did not pass): `POST {base}/v1`
 * `{cmd: 'request.get', url, maxTimeout}` → the solution's cookies and User-Agent. Only the address the user set or OMP
 * found on the LAN; nothing is logged (no addresses, no cookies). Blocking.
 */
class FlareSolverrClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(MAX_TIMEOUT_MS + 10_000, TimeUnit.MILLISECONDS)
        .build(),
    private val maxTimeoutMs: Long = MAX_TIMEOUT_MS,
) {
    sealed class Result {
        class Solved(val cookies: List<Cookie>, val userAgent: String?) : Result()
        class Failed(val reason: String) : Result()
    }

    fun solve(base: HttpUrl, target: HttpUrl): Result {
        val body = JSONObject()
            .put("cmd", "request.get")
            .put("url", target.toString())
            .put("maxTimeout", maxTimeoutMs)
            .toString()
        val request = Request.Builder().url(endpoint(base))
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newBuilder().callTimeout(maxTimeoutMs + 15_000, TimeUnit.MILLISECONDS).build().newCall(request).execute().use { r ->
                val text = r.body?.let { b ->
                    if (b.contentLength() > MAX_BYTES) return Result.Failed(FAILED)
                    val src = b.source()
                    if (src.request(MAX_BYTES + 1)) return Result.Failed(FAILED)
                    src.buffer.readUtf8()
                } ?: ""
                parse(text, target)
            }
        } catch (e: Exception) {
            Result.Failed(NO_ANSWER)
        }
    }

    companion object {
        const val MAX_TIMEOUT_MS = 60_000L
        const val MAX_BYTES = 5L * 1024 * 1024
        const val NO_ANSWER = "FlareSolverr не отвечает"
        const val FAILED = "FlareSolverr не прошёл проверку"

        /** {base}/v1 (a reverse-proxy path in the base is kept). */
        fun endpoint(base: HttpUrl): HttpUrl =
            base.newBuilder().query(null).fragment(null).encodedPath(base.encodedPath.trimEnd('/') + "/v1").build()

        /** The answer → cookies valid for [target] + User-Agent. A cookie for another site is dropped. */
        fun parse(text: String, target: HttpUrl): Result {
            val o = try {
                JSONObject(text)
            } catch (e: Exception) {
                return Result.Failed(FAILED)
            }
            if (o.optString("status") != "ok") return Result.Failed(FAILED)
            val sol = o.optJSONObject("solution") ?: return Result.Failed(FAILED)
            val list = ArrayList<Cookie>()
            val arr = sol.optJSONArray("cookies")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val c = arr.optJSONObject(i) ?: continue
                    cookie(c, target)?.let { list.add(it) }
                }
            }
            val ua = sol.optString("userAgent", "").trim().takeIf { it.isNotEmpty() && it.length <= 512 && it.all { ch -> ch in ' '..'~' } }
            return Result.Solved(list, ua)
        }

        private fun cookie(c: JSONObject, target: HttpUrl): Cookie? {
            val name = c.optString("name", "")
            if (name.isEmpty()) return null
            return try {
                val b = Cookie.Builder().name(name).value(c.optString("value", "")).path(c.optString("path", "/").ifEmpty { "/" })
                val raw = c.optString("domain", "")
                val domain = raw.trimStart('.').lowercase()
                val host = target.host.lowercase()
                val site = target.topPrivateDomain() ?: host
                when {
                    domain.isEmpty() || (domain == host && !raw.startsWith(".")) -> b.hostOnlyDomain(host)
                    domain == host -> b.domain(host)
                    // a parent domain within the same site, never a public suffix
                    host.endsWith(".$domain") && (domain == site || domain.endsWith(".$site")) -> b.domain(domain)
                    else -> return null
                }
                val expires = c.optDouble("expires", -1.0)
                if (expires > 0 && !expires.isNaN()) b.expiresAt((expires * 1000).toLong())
                if (c.optBoolean("secure", false)) b.secure()
                if (c.optBoolean("httpOnly", false)) b.httpOnly()
                b.build()
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}
