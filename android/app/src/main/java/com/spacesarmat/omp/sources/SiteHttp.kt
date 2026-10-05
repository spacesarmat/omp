package com.spacesarmat.omp.sources

import com.spacesarmat.omp.I18n

import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Why a site request failed; [reason] is shown to the user (Russian). [code] tells the page what kind of failure it is
 * ([SiteHttp.CODE_CLOUDFLARE], [SiteHttp.CODE_CLOUDFLARE_INTERACTIVE], [SiteHttp.CODE_TLS]), null for the rest.
 */
class SiteHttpException(val reason: String, val code: String? = null) : IOException(reason)

/**
 * HTTP for the built-in search sources: browser-like User-Agent, cookies per site ([SiteCookieJar]),
 * redirects followed per [RedirectPolicy], body decoded by its charset ([BodyCharset]), at most [MAX_BYTES].
 */
class SiteHttp(
    private val jar: SiteCookieJar,
    private val cloudflare: CloudflarePass? = null,
    /** The User-Agent without a per-host override (the WebView's own on Android, see [DefaultUserAgent]). */
    private val defaultAgent: () -> String = { USER_AGENT },
) {
    /** [cloudflare]: how a Cloudflare check on the way was passed ([CloudflarePass.Outcome] in lower case), null when there was none. */
    class Response(val status: Int, val url: String, val text: String, val cloudflare: String? = null)

    /** A request for a site whose «Обходить проверку Cloudflare» is on; [flareSolverr] = the user's FlareSolverr, if any. */
    class CloudflareOptions(val flareSolverr: HttpUrl?)

    private class Exchange(val response: Response, val headers: okhttp3.Headers)

    private val client = OkHttpClient.Builder()
        .cookieJar(jar)
        // redirects are followed by hand ([RedirectPolicy]): a POST body must not leave its site
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Only http/https; anything else is null. */
    fun parseUrl(url: String): HttpUrl? = url.toHttpUrlOrNull()

    /** «Выйти»: the site's cookies, and the User-Agent overrides of its hosts (a session's, a clearance's). */
    fun clearCookies(url: String) {
        val u = parseUrl(url) ?: throw SiteHttpException(BAD_URL)
        jar.clear(u)
        cloudflare?.forgetSite(u)
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
        responseCharset: String? = null,
        cf: CloudflareOptions? = null,
    ): Response {
        val target = parseUrl(url) ?: throw SiteHttpException(BAD_URL)
        val forced = if (responseCharset == null) null else BodyCharset.forName(responseCharset) ?: throw SiteHttpException(BAD_REQUEST)
        val b = Request.Builder().url(target)
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
        // a page-set User-Agent wins; otherwise each hop gets its host's one (a FlareSolverr override after a redirect)
        val ownAgent = headers.keys.none { it.equals("User-Agent", ignoreCase = true) }
        val first = exchange(b.build(), timeoutMs, forced, ownAgent)
        val pass = cloudflare
        if (cf == null || pass == null || detect(first) == CloudflareDetect.Kind.NONE) return first.response
        val challenged = parseUrl(first.response.url) ?: target
        return when (val outcome = pass.pass(challenged, cf.flareSolverr)) {
            CloudflarePass.Outcome.BROWSER, CloudflarePass.Outcome.FLARESOLVERR -> {
                // the clearance may come with another User-Agent (FlareSolverr): every hop of the retry asks again
                val again = exchange(b.build(), timeoutMs, forced, ownAgent)
                if (detect(again) != CloudflareDetect.Kind.NONE) throw SiteHttpException(CF_FAILED, CODE_CLOUDFLARE)
                val r = again.response
                Response(r.status, r.url, r.text, outcome.name.lowercase())
            }
            CloudflarePass.Outcome.INTERACTIVE -> throw SiteHttpException(CF_INTERACTIVE, CODE_CLOUDFLARE_INTERACTIVE)
            CloudflarePass.Outcome.FAILED -> throw SiteHttpException(CF_FAILED, CODE_CLOUDFLARE)
        }
    }

    /** The User-Agent of a request to [host]: the host's override, else the one default. */
    fun agentFor(host: String): String = cloudflare?.userAgentFor(host) ?: defaultAgent()

    private fun detect(e: Exchange): CloudflareDetect.Kind =
        CloudflareDetect.detect(e.response.status, { e.headers[it] }, e.response.text)

    /** One request with its redirects within [timeoutMs]. */
    private fun exchange(first: Request, timeoutMs: Long, forced: java.nio.charset.Charset?, ownAgent: Boolean): Exchange {
        val deadline = System.currentTimeMillis() + timeoutMs
        var request = first
        try {
            for (hop in 0..MAX_REDIRECTS) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) throw SiteHttpException(NO_ANSWER)
                if (ownAgent) request = request.newBuilder().header("User-Agent", agentFor(request.url.host)).build()
                val call = client.newBuilder().callTimeout(left, TimeUnit.MILLISECONDS).build().newCall(request)
                val next = call.execute().use { r ->
                    val location = r.header("Location")?.let { r.request.url.resolve(it) }
                    val action = if (location == null || hop == MAX_REDIRECTS) {
                        RedirectPolicy.Action.STOP
                    } else {
                        RedirectPolicy.next(r.request.method, r.code, r.request.url, location)
                    }
                    when (action) {
                        RedirectPolicy.Action.STOP -> return Exchange(read(r, forced), r.headers)
                        RedirectPolicy.Action.FOLLOW_GET -> redirected(r.request, location!!).get().removeHeader("Content-Type").build()
                        RedirectPolicy.Action.RESEND -> redirected(r.request, location!!).build()
                    }
                }
                request = next
            }
            throw SiteHttpException(NO_ANSWER)
        } catch (e: SiteHttpException) {
            throw e
        } catch (e: IOException) {
            throw failureOf(e)
        }
    }

    /** Same request to [to]; hand-set credentials do not follow to another host (the jar handles cookies). */
    private fun redirected(from: Request, to: HttpUrl): Request.Builder {
        val nb = from.newBuilder().url(to)
        if (!from.url.host.equals(to.host, ignoreCase = true)) nb.removeHeader("Cookie").removeHeader("Authorization")
        return nb
    }

    private fun read(r: okhttp3.Response, forced: java.nio.charset.Charset?): Response {
        val rb = r.body ?: return Response(r.code, r.request.url.toString(), "")
        if (rb.contentLength() > MAX_BYTES) throw SiteHttpException(TOO_LARGE)
        val source = rb.source()
        if (source.request(MAX_BYTES + 1)) throw SiteHttpException(TOO_LARGE)
        val bytes = source.buffer.readByteArray()
        return Response(r.code, r.request.url.toString(), if (forced != null) String(bytes, forced) else BodyCharset.decode(bytes, r.header("Content-Type")))
    }

    companion object {
        const val MAX_BYTES = 5L * 1024 * 1024
        const val MAX_REDIRECTS = 10
        val BAD_URL: String get() = I18n.s("errors.badUrl")
        val BAD_REQUEST: String get() = I18n.s("errors.badRequest")
        val TOO_LARGE: String get() = I18n.s("errors.tooLarge")
        val NO_ANSWER: String get() = I18n.s("errors.siteDown")
        val CF_FAILED: String get() = I18n.s("errors.cfFailed")
        val CF_INTERACTIVE: String get() = I18n.s("errors.cfInteractive")
        const val CODE_CLOUDFLARE = "cloudflare"
        const val CODE_CLOUDFLARE_INTERACTIVE = "cloudflare-interactive"
        val TLS_ERROR: String get() = I18n.s("errors.siteTls")
        /** The site's certificate could not be verified (an incomplete chain, an unknown CA, a wrong host name). */
        const val CODE_TLS = "tls"

        /**
         * A failed exchange as the page sees it: a certificate the handshake could not verify gets its own message and
         * [CODE_TLS] (it answered, so «не отвечает» would mislead); any other I/O failure is [NO_ANSWER].
         */
        fun failureOf(e: IOException): SiteHttpException = when (e) {
            is SiteHttpException -> e
            is SSLHandshakeException, is SSLPeerUnverifiedException -> SiteHttpException(TLS_ERROR, CODE_TLS)
            else -> SiteHttpException(NO_ANSWER)
        }

        /** Fallback User-Agent when the device's WebView one is unknown (no WebView; JVM tests). */
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    }
}
