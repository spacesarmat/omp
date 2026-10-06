package com.spacesarmat.omp.rpc

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.RenderProcessGoneDetail
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
import com.spacesarmat.omp.I18n
import com.spacesarmat.omp.monitor.BridgeProtocol
import com.spacesarmat.omp.monitor.BridgeRequest
import com.spacesarmat.omp.monitor.MonitorOrigin
import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import java.io.ByteArrayInputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import org.json.JSONObject

/**
 * The hidden WebView of the TV search server: the bundled page assets/public/rpc.html at [MonitorOrigin.ORIGIN] (the
 * app's own origin, so it shares the app's localStorage), set up like the monitor page ([com.spacesarmat.omp.monitor.MonitorHost]):
 * every navigation is refused and `localhost` URLs are answered from the bundle only.
 *
 * Bridge `OmpRpcHost` (main frame of [MonitorOrigin.ORIGIN] only): the page's `{op:'ready'}` reply proxy is the push
 * channel of [send]; `rpcReply` goes to [dispatcher]; `http` / `secretGet` use the app's [SourceServices] (same cookies,
 * same secrets). Bodies, tokens and cookies are never logged. Created and destroyed on the main thread; [send] from any.
 */
class RpcPageHost(
    private val ctx: Context,
    private val dispatcher: RpcDispatcher,
    /** The renderer died or the WebView is unavailable; called once, on the main thread. */
    private val onGone: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newFixedThreadPool(4)
    private var web: WebView? = null
    @Volatile
    private var proxy: JavaScriptReplyProxy? = null
    @Volatile
    private var destroyed = false
    private var gone = false
    private val services by lazy { SourceServices.get(ctx) }

    @SuppressLint("SetJavaScriptEnabled")
    fun start() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            main.post { reportGone() }
            return
        }
        val w = try {
            WebView(ctx)
        } catch (_: Exception) {
            // no WebView package (being updated)
            main.post { reportGone() }
            return
        }
        web = w
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            blockNetworkImage = true
        }
        val assets = WebViewAssetLoader.Builder()
            .setDomain(MonitorOrigin.HOST)
            .setHttpAllowed(true)
            .addPathHandler("/", PublicAssets(WebViewAssetLoader.AssetsPathHandler(ctx)))
            .build()
        w.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (!MonitorOrigin.isPage(url.scheme, url.host, url.port)) return null
                return assets.shouldInterceptRequest(url) ?: notFound()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // handled: the app must not crash with the renderer; this WebView is unusable from now on
                if (view === web) reportGone()
                return true
            }
        }
        WebViewCompat.addWebMessageListener(w, BRIDGE, setOf(MonitorOrigin.ORIGIN)) { _, message, origin, isMainFrame, reply ->
            if (isMainFrame && sameOrigin(origin)) handle(message, reply)
        }
        w.onResume()
        w.resumeTimers()
        w.loadUrl(PAGE)
    }

    /** Posts a call to the page; false while the page has not said `ready` (or is gone). */
    fun send(message: String): Boolean {
        val p = proxy ?: return false
        if (destroyed) return false
        main.post { if (!destroyed && proxy === p) p.postMessage(message) }
        return true
    }

    fun destroy() {
        destroyed = true
        proxy = null
        io.shutdownNow()
        web?.let {
            try {
                it.stopLoading()
                WebViewCompat.removeWebMessageListener(it, BRIDGE)
                it.destroy()
            } catch (_: Exception) {
            }
        }
        web = null
    }

    private fun reportGone() {
        if (gone || destroyed) return
        gone = true
        proxy = null
        onGone()
    }

    private fun handle(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        if (destroyed) return
        when (val m = RpcProtocol.parse(message.data)) {
            is RpcPageMessage.Ready -> proxy = reply
            is RpcPageMessage.Reply -> dispatcher.onReply(m.rpc, m.ok, m.result, m.code, m.message)
            is RpcPageMessage.Bridge -> when (val r = m.request) {
                is BridgeRequest.Http -> background(reply, r.id) {
                    try {
                        BridgeProtocol.ok(r.id, HttpSpec.reply(services.request(r.spec)))
                    } catch (e: SiteHttpException) {
                        BridgeProtocol.error(r.id, e.reason)
                    }
                }
                is BridgeRequest.SecretGet -> background(reply, r.id) {
                    try {
                        BridgeProtocol.ok(r.id, JSONObject().put("value", services.secrets.get(r.key) ?: JSONObject.NULL))
                    } catch (_: Exception) {
                        BridgeProtocol.error(r.id, SourceServices.SECRETS_FAILED)
                    }
                }
                else -> {}
            }
            is RpcPageMessage.Invalid -> m.id?.let { reply.postMessage(BridgeProtocol.error(it, m.error)) }
        }
    }

    /** Runs [work] on [io]; the answer goes back on the main thread while the host is alive. */
    private fun background(reply: JavaScriptReplyProxy, id: Int, work: () -> String) {
        try {
            io.execute {
                val answer = try {
                    work()
                } catch (_: Exception) {
                    BridgeProtocol.error(id, I18n.s("errors.siteDown"))
                }
                main.post { if (!destroyed) reply.postMessage(answer) }
            }
        } catch (_: RejectedExecutionException) {
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
        const val PAGE = MonitorOrigin.ORIGIN + "/rpc.html"
        const val BRIDGE = "OmpRpcHost"
    }
}
