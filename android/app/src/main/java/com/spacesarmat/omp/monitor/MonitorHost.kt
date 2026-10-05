package com.spacesarmat.omp.monitor

import com.spacesarmat.omp.I18n

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import java.io.ByteArrayInputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * The hidden WebView of a background run. It loads the bundled monitor page (assets/public/monitor.html) at
 * [ORIGIN] — the origin Capacitor serves the app from (capacitor.config.ts: androidScheme 'http', default hostname
 * 'localhost'), so the page shares the app's localStorage. Nothing else is ever loaded as a page: every navigation is
 * refused, and `localhost` URLs are answered from the bundle only.
 *
 * Bridge: the JS object `OmpMonitorHost` (androidx.webkit addWebMessageListener, allowed only for [ORIGIN] and only in
 * the main frame): start, http (the app's own [SourceServices]: same cookies, same secrets), secretGet, notify, finish.
 * Request and response bodies, passwords and cookies are never logged. Main thread only.
 */
class MonitorHost(
    private val ctx: Context,
    private val action: MonitorAction?,
    private val deadline: Long,
    private val onFinish: (JSONObject?) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newFixedThreadPool(4)
    private var web: WebView? = null
    private var finished = false
    private val services by lazy { SourceServices.get(ctx) }
    private val journal by lazy { MonitorJournalFile(ctx) }

    @SuppressLint("SetJavaScriptEnabled")
    fun start() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            finish(null)
            return
        }
        val w = WebView(ctx)
        web = w
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // the active TorrServer is usually plain http on the LAN, like in the app (allowMixedContent)
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            blockNetworkImage = true
        }
        val assets = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .setHttpAllowed(true)
            .addPathHandler("/", PublicAssets(WebViewAssetLoader.AssetsPathHandler(ctx)))
            .build()
        w.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                // only the page's own origin; localhost:<port> / 127.0.0.1:8090 (a local TorrServer) go to the network
                if (!MonitorOrigin.isPage(url.scheme, url.host, url.port)) return null
                return assets.shouldInterceptRequest(url) ?: notFound()
            }
        }
        WebViewCompat.addWebMessageListener(w, BRIDGE, setOf(ORIGIN)) { _, message, origin, isMainFrame, reply ->
            if (isMainFrame && sameOrigin(origin)) handle(message, reply)
        }
        w.onResume()
        w.resumeTimers()
        w.loadUrl(PAGE)
    }

    fun destroy() {
        finished = true
        io.shutdownNow()
        web?.let {
            it.stopLoading()
            WebViewCompat.removeWebMessageListener(it, BRIDGE)
            it.destroy()
        }
        web = null
    }

    private fun finish(summary: JSONObject?) {
        if (finished) return
        finished = true
        onFinish(summary)
    }

    private fun handle(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        if (finished) return
        when (val r = BridgeProtocol.parse(message.data)) {
            is BridgeRequest.Start -> {
                background(reply, r.id) {
                    val o = JSONObject().put("deadline", deadline).put("action", action?.forPage() ?: JSONObject.NULL)
                        .put("journal", MonitorJournal.toJson(journal.read()))
                    BridgeProtocol.ok(r.id, o)
                }
            }
            is BridgeRequest.Http -> background(reply, r.id) {
                try {
                    BridgeProtocol.ok(r.id, com.spacesarmat.omp.sources.HttpSpec.reply(services.request(r.spec)))
                } catch (e: SiteHttpException) {
                    BridgeProtocol.error(r.id, e.reason)
                }
            }
            is BridgeRequest.SecretGet -> background(reply, r.id) {
                try {
                    BridgeProtocol.ok(r.id, JSONObject().put("value", services.secrets.get(r.key) ?: JSONObject.NULL))
                } catch (e: Exception) {
                    BridgeProtocol.error(r.id, SourceServices.SECRETS_FAILED)
                }
            }
            is BridgeRequest.Notify -> {
                // a check only: the result of a button is shown by the worker
                val shown = action == null && MonitorNotifier.post(ctx, r.spec)
                reply.postMessage(BridgeProtocol.ok(r.id, JSONObject().put("shown", shown)))
            }
            is BridgeRequest.Persist -> background(reply, r.id) {
                try {
                    journal.append(r.items)
                    BridgeProtocol.ok(r.id, null)
                } catch (e: Exception) {
                    BridgeProtocol.error(r.id, JOURNAL_FAILED)
                }
            }
            is BridgeRequest.Finish -> finish(r.summary)
            is BridgeRequest.Invalid -> r.id?.let { reply.postMessage(BridgeProtocol.error(it, r.error)) }
        }
    }

    /** Runs [work] on [io]; the answer goes back on the main thread while the page is alive. */
    private fun background(reply: JavaScriptReplyProxy, id: Int, work: () -> String) {
        try {
            io.execute {
                val answer = try {
                    work()
                } catch (e: Exception) {
                    BridgeProtocol.error(id, NO_ANSWER)
                }
                main.post { if (!finished) reply.postMessage(answer) }
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            // destroyed
        }
    }

    private fun sameOrigin(origin: Uri): Boolean = MonitorOrigin.isPage(origin.scheme, origin.host, origin.port)

    /** Serves "public/<path>" of the APK assets (where `cap sync` puts dist-mobile). */
    private class PublicAssets(private val assets: WebViewAssetLoader.AssetsPathHandler) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? = assets.handle("public/$path")
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    companion object {
        const val HOST = MonitorOrigin.HOST
        /** Capacitor's origin for this app (androidScheme 'http', hostname 'localhost'). */
        const val ORIGIN = MonitorOrigin.ORIGIN
        const val PAGE = "$ORIGIN/monitor.html"
        const val BRIDGE = "OmpMonitorHost"
        private val NO_ANSWER: String get() = I18n.s("errors.siteDown")
        private val JOURNAL_FAILED: String get() = I18n.s("monitor.journalFailed")
    }
}
