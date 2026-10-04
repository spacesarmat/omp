package com.spacesarmat.omp.sources

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebStorage
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/** [CloudflareSolver.Scheduler] on the main looper (WebView lives there). */
class MainScheduler : CloudflareSolver.Scheduler {
    private val main = Handler(Looper.getMainLooper())

    override fun post(delayMs: Long, block: () -> Unit) {
        main.postDelayed({ block() }, delayMs)
    }

    override fun now(): Long = SystemClock.uptimeMillis()
}

/**
 * An off-screen WebView for [CloudflareSolver]: never attached to a window, JavaScript on (the check is a script),
 * only http(s) navigation, no file access. Cookies come from the shared [CookieManager]. The URLs of the site the page
 * requested are remembered (in memory, at most [MAX_SEEN]) so [forget] can expire cookies on every path and drop the
 * site's web storage. Nothing is logged.
 */
class WebViewCloudflareBrowser(private val context: Context) : CloudflareBrowser {
    private var web: WebView? = null
    private val seen = LinkedHashSet<String>()

    private fun remember(url: String?) {
        if (url == null) return
        synchronized(seen) { if (seen.size < MAX_SEEN) seen.add(url) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
        CookieManager.getInstance().setAcceptCookie(true)
        val w = WebView(context.applicationContext)
        web = w
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            userAgentString = userAgent
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                return scheme != "http" && scheme != "https"
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // read-only: the request goes on to the network as usual
                remember(request.url.toString())
                return null
            }

            override fun onPageFinished(view: WebView, url: String?) {
                remember(url)
                events.onFinished()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) events.onError()
            }
        }
        w.onResume()
        w.resumeTimers()
        remember(url)
        w.loadUrl(url)
    }

    override fun probe(result: (String?) -> Unit) {
        val w = web ?: return result(null)
        w.evaluateJavascript(CloudflareDetect.PROBE_JS) { result(it) }
    }

    override fun cookies(url: String): String? = CookieManager.getInstance().getCookie(url)

    override fun forget(url: String) {
        val cm = CookieManager.getInstance()
        val rootHost = Uri.parse(url).host?.lowercase() ?: return
        val site = siteOf(rootHost)
        val urls = synchronized(seen) { seen.toList() } + url
        val origins = LinkedHashSet<String>()
        for (u in urls) {
            val uri = Uri.parse(u)
            val host = uri.host?.lowercase() ?: continue
            val scheme = uri.scheme?.lowercase() ?: continue
            // only this site: Cloudflare's own frames (challenges.cloudflare.com) are not the site's state
            if (siteOf(host) != site || (scheme != "http" && scheme != "https")) continue
            origins.add(scheme + "://" + host + (if (uri.port > 0) ":" + uri.port else ""))
            val paths = WebCookieCleanup.pathPrefixes(uri.path)
            for ((name, _) in CloudflareSolver.parseCookieHeader(cm.getCookie(u))) {
                for (c in WebCookieCleanup.expiring(name, paths, host, site, scheme == "https")) cm.setCookie(u, c)
            }
        }
        cm.flush()
        val storage = WebStorage.getInstance()
        for (o in origins) storage.deleteOrigin(o)
    }

    private fun siteOf(host: String): String =
        try {
            okhttp3.HttpUrl.Builder().scheme("https").host(host).build().topPrivateDomain() ?: host
        } catch (e: IllegalArgumentException) {
            host
        }

    override fun close() {
        web?.let {
            it.stopLoading()
            it.destroy()
        }
        web = null
    }

    companion object {
        const val MAX_SEEN = 200
    }
}

/**
 * The WebView's own User-Agent, read once: the one User-Agent of every site request and of the hidden check, so the
 * header, navigator.userAgent and the client hints agree. [SiteHttp.USER_AGENT] when the device has no WebView.
 */
class DefaultUserAgent(private val context: Context) : () -> String {
    @Volatile
    private var cached: String? = null

    override fun invoke(): String {
        cached?.let { return it }
        val ua = try {
            WebSettings.getDefaultUserAgent(context.applicationContext)
        } catch (e: Throwable) {
            null
        }
        val clean = ua?.trim()?.takeIf { it.isNotEmpty() && it.length <= 512 && it.all { c -> c in ' '..'~' } } ?: SiteHttp.USER_AGENT
        cached = clean
        return clean
    }
}
