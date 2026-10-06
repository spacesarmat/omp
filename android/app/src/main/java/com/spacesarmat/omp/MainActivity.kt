package com.spacesarmat.omp

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig
import com.spacesarmat.omp.control.AppForeground
import com.spacesarmat.omp.monitor.MonitorLinks

class MainActivity : BridgeActivity() {
    // the launch intent was already handled before the activity got recreated
    private var skipLaunchIntent = false
    // TV interface (/tv/): Back and media keys go to the page as webOS key codes
    private var tvMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        I18n.load(this)
        skipLaunchIntent = savedInstanceState != null ||
            ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        registerPlugin(OmpNativePlugin::class.java)
        tvMode = TvMode.isTv(this)
        // BridgeActivity.onCreate passes the launch intent to onNewIntent below
        super.onCreate(savedInstanceState)
        // Back reaches the page only through the OnBackPressed dispatcher (predictive back on Android 16+ never
        // delivers KEYCODE_BACK to dispatchKeyEvent). Added after the bridge loaded its plugins, so it wins over
        // @capacitor/app's callback (webView.goBack()).
        if (tvMode) {
            // the TV layout is 1920×1080 CSS px: honour <meta name="viewport" content="width=1920"> and fit it
            bridge?.webView?.settings?.let {
                it.useWideViewPort = true
                it.loadWithOverviewMode = true
            }
            onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() = pageBack()
            })
        } else {
            // the phone UI is laid out for the screen: a pinch never zooms the page (see PhoneWebZoom)
            bridge?.webView?.settings?.let { PhoneWebZoom.disable(it) }
        }
    }

    /** Back → keyCode 461 in the page; the Activity closes when the page did not take it (root screen). */
    private fun pageBack() {
        val web = bridge?.webView
        if (web == null) {
            finish()
            return
        }
        web.evaluateJavascript(jsKey(BACK_CODE)) { handled -> if (handled != "true") finish() }
    }

    // Android TV starts directly on the bundled TV interface (/tv/), the phone UI never boots.
    // Mirrors capacitor.config.ts (androidScheme http, allowMixedContent) plus the start path.
    override fun load() {
        if (tvMode) {
            config = CapConfig.Builder(this)
                .setAndroidScheme("http")
                .setAllowMixedContent(true)
                .setStartPath("/tv/index.html")
                .setInitialFocus(true)
                .setLoggingEnabled(isDebuggable())
                .create()
        }
        super.load()
    }

    // what BuildConfig.DEBUG would say (BuildConfig is not generated); Capacitor's JSON default uses the same flag
    private fun isDebuggable() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    override fun onResume() {
        super.onResume()
        AppForeground.main = true
        // «Пройти на телефоне»: a watch asleep after its background grace polls the TV again
        OmpNativePlugin.wakeCloudflare()
    }

    override fun onPause() {
        AppForeground.main = false
        super.onPause()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!tvMode) return super.dispatchKeyEvent(event)
        val code = TvKeys.webCode(event.keyCode) ?: return super.dispatchKeyEvent(event)
        val web = bridge?.webView ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) web.evaluateJavascript(jsKey(code), null)
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent !== getIntent()) setIntent(intent)
        else if (skipLaunchIntent) {
            skipLaunchIntent = false
            return
        }
        OmpNativePlugin.magnetFrom(intent)?.let { OmpNativePlugin.deliverMagnet(it) }
        MonitorLinks.fromIntent(intent.action, intent.getStringExtra(MonitorLinks.EXTRA_URL))?.let {
            OmpNativePlugin.deliverMonitorOpen(it)
        }
    }

    companion object {
        private const val BACK_CODE = 461

        /** window.__ompKey (src/platform/androidKeys.ts) answers true when the page handled the key. */
        private fun jsKey(code: Int) = "(function(){return !!(window.__ompKey && window.__ompKey($code));})()"
    }
}
