package com.spacesarmat.omp.sources

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
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
 * only http(s) navigation, no file access. Cookies come from the shared [CookieManager]. Nothing is logged.
 */
class WebViewCloudflareBrowser(private val context: Context) : CloudflareBrowser {
    private var web: WebView? = null

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

            override fun onPageFinished(view: WebView, url: String?) {
                events.onFinished()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) events.onError()
            }
        }
        w.onResume()
        w.resumeTimers()
        w.loadUrl(url)
    }

    override fun probe(result: (String?) -> Unit) {
        val w = web ?: return result(null)
        w.evaluateJavascript(CloudflareDetect.PROBE_JS) { result(it) }
    }

    override fun cookies(url: String): String? = CookieManager.getInstance().getCookie(url)

    override fun forget(url: String) {
        val cm = CookieManager.getInstance()
        val host = android.net.Uri.parse(url).host ?: return
        val site = okhttp3.HttpUrl.Builder().scheme("https").host(host).build().topPrivateDomain() ?: host
        for ((name, _) in CloudflareSolver.parseCookieHeader(cm.getCookie(url))) {
            // host-only and domain cookies are separate entries: expire both
            cm.setCookie(url, "$name=; Max-Age=0; Path=/")
            cm.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=$site")
            if (site != host) cm.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=$host")
        }
        cm.flush()
    }

    override fun close() {
        web?.let {
            it.stopLoading()
            it.destroy()
        }
        web = null
    }
}
