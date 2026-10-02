package com.spacesarmat.omp.sources

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Why a site request failed; [reason] is shown to the user (Russian). */
class SiteHttpException(val reason: String) : IOException(reason)

/**
 * HTTP for the built-in search sources: browser-like User-Agent, cookies per site ([SiteCookieJar]),
 * redirects followed, body decoded by its charset ([BodyCharset]), at most [MAX_BYTES].
 */
class SiteHttp(private val jar: SiteCookieJar) {
    class Response(val status: Int, val url: String, val text: String)

    private val client = OkHttpClient.Builder()
        .cookieJar(jar)
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Only http/https; anything else is null. */
    fun parseUrl(url: String): HttpUrl? = url.toHttpUrlOrNull()

    fun clearCookies(url: String) {
        jar.clear(parseUrl(url) ?: throw SiteHttpException(BAD_URL))
    }

    /** Blocking. Throws [SiteHttpException]. */
    fun request(
        url: String,
        method: String,
        headers: Map<String, String>,
        form: Map<String, String>?,
        formCharset: String?,
        body: String?,
        timeoutMs: Long,
    ): Response {
        val target = parseUrl(url) ?: throw SiteHttpException(BAD_URL)
        val b = Request.Builder().url(target)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
        try {
            for ((k, v) in headers) b.header(k, v)
        } catch (e: IllegalArgumentException) {
            throw SiteHttpException(BAD_REQUEST)
        }
        when (method) {
            "GET" -> b.get()
            "POST" -> {
                if (form != null) {
                    val cs = if (formCharset == null) Charsets.UTF_8 else BodyCharset.forName(formCharset) ?: throw SiteHttpException(BAD_REQUEST)
                    val fb = FormBody.Builder(cs)
                    for ((k, v) in form) fb.add(k, v)
                    b.post(fb.build())
                } else {
                    val type = (headers.entries.firstOrNull { it.key.equals("Content-Type", true) }?.value
                        ?: "application/x-www-form-urlencoded; charset=utf-8").toMediaTypeOrNull()
                    b.post((body ?: "").toRequestBody(type))
                }
            }
            else -> throw SiteHttpException(BAD_REQUEST)
        }
        val call = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build().newCall(b.build())
        try {
            call.execute().use { r ->
                val rb = r.body ?: return Response(r.code, r.request.url.toString(), "")
                if (rb.contentLength() > MAX_BYTES) throw SiteHttpException(TOO_LARGE)
                val source = rb.source()
                if (source.request(MAX_BYTES + 1)) throw SiteHttpException(TOO_LARGE)
                val bytes = source.buffer.readByteArray()
                return Response(r.code, r.request.url.toString(), BodyCharset.decode(bytes, r.header("Content-Type")))
            }
        } catch (e: SiteHttpException) {
            throw e
        } catch (e: IOException) {
            throw SiteHttpException(NO_ANSWER)
        }
    }

    companion object {
        const val MAX_BYTES = 5L * 1024 * 1024
        const val BAD_URL = "Неверный адрес"
        const val BAD_REQUEST = "Неверный запрос"
        const val TOO_LARGE = "Слишком большой ответ сайта"
        const val NO_ANSWER = "Сайт не отвечает"
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    }
}
