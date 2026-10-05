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
import java.io.ByteArrayInputStream

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
class WebViewCloudflareBrowser(
    private val context: Context,
    /** The visible check: the page is shown in a dialog of [context] (an Activity) and can take focus (TV remote). */
    private val visible: Boolean = false,
    /** The browser login: where the visible page may go (host, path; [LoginNavigation]); null = the Cloudflare check rule. */
    private val navigation: ((String?, String?) -> Boolean)? = null,
    /** The browser login: requests of the page answered empty (host, path; [LoginNavigation.ad]); null = none. */
    private val ads: ((String?, String?) -> Boolean)? = null,
) : CloudflareBrowser {
    private var web: WebView? = null
    private var rootHost: String? = null

    /** The page, for the visible check to attach to its dialog. */
    val view: WebView? get() = web
    /**
     * The URLs the page requested, one per origin and directory (the cookie paths [forget] expires are the same for
     * every page of a directory), at most [MAX_SEEN]. Past that the visible page sets [overflow]: [forget] then clears
     * the whole WebView cookie store rather than leave cookies of an origin it did not record.
     */
    private val seen = LinkedHashMap<String, String>()
    @Volatile
    private var overflow = false
    private var startUrl: String? = null
    /** Reloads of the login page since it was last on screen ([backToLogin]). */
    private var restarts = 0

    private fun remember(url: String?) {
        if (url == null) return
        val key = WebCookieCleanup.directoryKey(url) ?: return
        synchronized(seen) {
            if (seen.containsKey(key)) return
            if (seen.size < MAX_SEEN) seen[key] = url else overflow = true
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
        CookieManager.getInstance().setAcceptCookie(true)
        val w = WebView(if (visible) context else context.applicationContext)
        web = w
        rootHost = Uri.parse(url).host?.lowercase()
        startUrl = url
        if (visible) {
            w.isFocusable = true
            w.isFocusableInTouchMode = true
        }
        // the login page: no third-party cookies (Turnstile and hCaptcha work without them; ad frames get none)
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, navigation == null)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            userAgentString = userAgent
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (visible) {
                // the login pages are desktop layouts wider than the sheet: the whole width fits, zoom to read
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(true)
                builtInZoomControls = true
                displayZoomControls = false
            }
        }
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") return true
                // the visible page stays on the site (and Cloudflare's challenge pages): no browsing elsewhere in OMP
                if (!visible) return false
                val nav = navigation
                if (nav != null) {
                    // the login page: subframe navigations that reach here are held to the same rule (best effort)
                    if (nav(request.url.host, request.url.path)) return false
                    if (request.isForMainFrame) {
                        // a refused redirect (or a page already left) can leave the document blank: the login page again
                        val current = view.url?.let { Uri.parse(it) }
                        if (request.isRedirect || current == null || !nav(current.host, current.path)) view.post { backToLogin(view) }
                        events.onBlocked()
                    }
                    return true
                }
                return request.isForMainFrame && !VisibleNavigation.allowed(rootHost, request.url.host)
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                remember(url)
                val nav = navigation ?: return
                if (!visible || url == null) return
                val uri = Uri.parse(url)
                val scheme = uri.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") return
                // a navigation shouldOverrideUrlLoading never saw (a form POST): stopped, back to the login page
                if (!nav(uri.host, uri.path)) {
                    view.stopLoading()
                    backToLogin(view)
                    events.onBlocked()
                }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // the login page: the site's ad frames and scripts (under.nnmclub.to, /clicks/…) get an empty answer; the
                // main frame is left to the navigation rule (a refused page goes back to the login page, never blank)
                val ad = ads
                if (ad != null && visible && !request.isForMainFrame && ad(request.url.host, request.url.path)) return empty()
                // read-only otherwise: the request goes on to the network as usual
                remember(request.url.toString())
                return null
            }

            override fun onPageCommitVisible(view: WebView, url: String?) {
                // a login page on screen again: the next refused navigation may bring it back once more
                val uri = url?.let { Uri.parse(it) } ?: return
                if (navigation?.invoke(uri.host, uri.path) == true) restarts = 0
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

    /** Reloads the login page after a refused navigation, at most [MAX_RESTARTS] times in a row (no reload loop). */
    private fun backToLogin(view: WebView) {
        if (web !== view) return
        val url = startUrl ?: return
        if (restarts >= MAX_RESTARTS) return
        restarts++
        view.loadUrl(url)
    }

    private fun empty(): WebResourceResponse = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    override fun probe(result: (String?) -> Unit) {
        val w = web ?: return result(null)
        w.evaluateJavascript(CloudflareDetect.PROBE_JS) { result(it) }
    }

    override fun cookies(url: String): String? = CookieManager.getInstance().getCookie(url)

    override fun forget(url: String) {
        val cm = CookieManager.getInstance()
        val rootHost = Uri.parse(url).host?.lowercase() ?: return
        val site = siteOf(rootHost)
        val urls = synchronized(seen) { seen.values.toList() } + url
        val origins = LinkedHashSet<String>()
        for (u in urls) {
            val uri = Uri.parse(u)
            val host = uri.host?.lowercase() ?: continue
            val scheme = uri.scheme?.lowercase() ?: continue
            if (scheme != "http" && scheme != "https") continue
            // hidden check: only this site (Cloudflare's own frames are not its state); the visible page: everything it saw
            val hostSite = siteOf(host)
            if (!visible && hostSite != site) continue
            origins.add(scheme + "://" + host + (if (uri.port > 0) ":" + uri.port else ""))
            val paths = WebCookieCleanup.pathPrefixes(uri.path)
            for ((name, _) in CloudflareSolver.parseCookieHeader(cm.getCookie(u))) {
                for (c in WebCookieCleanup.expiring(name, paths, host, hostSite, scheme == "https")) cm.setCookie(u, c)
            }
        }
        // the visible page saw more origins than were recorded: nothing of it may stay (the app's own pages keep no cookies)
        if (visible && overflow) cm.removeAllCookies(null)
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
        const val MAX_SEEN = 500
        const val MAX_RESTARTS = 3
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
