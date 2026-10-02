package com.spacesarmat.omp

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig

class MainActivity : BridgeActivity() {
    // the launch intent was already handled before the activity got recreated
    private var skipLaunchIntent = false
    // TV interface (/tv/): Back and media keys go to the page as webOS key codes
    private var tvMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        skipLaunchIntent = savedInstanceState != null ||
            ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        registerPlugin(OmpNativePlugin::class.java)
        tvMode = TvMode.isTv(this)
        // BridgeActivity.onCreate passes the launch intent to onNewIntent below
        super.onCreate(savedInstanceState)
    }

    // Android TV starts directly on the bundled TV interface (/tv/), the phone UI never boots.
    // Mirrors capacitor.config.ts (androidScheme http, allowMixedContent) plus the start path.
    override fun load() {
        if (tvMode) {
            config = CapConfig.Builder(this)
                .setAndroidScheme("http")
                .setAllowMixedContent(true)
                .setStartPath("/tv/index.html")
                .create()
        }
        super.load()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!tvMode) return super.dispatchKeyEvent(event)
        val code = WEB_KEYS[event.keyCode] ?: return super.dispatchKeyEvent(event)
        val web = bridge?.webView ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                // holding Back must not close the app
                if (event.repeatCount == 0) {
                    web.evaluateJavascript(jsKey(code)) { handled -> if (handled != "true") finish() }
                }
            } else {
                web.evaluateJavascript(jsKey(code), null)
            }
        }
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
    }

    companion object {
        /** Android key code → webOS key code understood by the TV interface (src/platform/keys.ts). */
        private val WEB_KEYS = mapOf(
            KeyEvent.KEYCODE_BACK to 461,
            KeyEvent.KEYCODE_MEDIA_PLAY to 415,
            KeyEvent.KEYCODE_MEDIA_PAUSE to 19,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to 179,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to 417,
            KeyEvent.KEYCODE_MEDIA_REWIND to 412,
            KeyEvent.KEYCODE_MEDIA_NEXT to 33,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to 34,
            KeyEvent.KEYCODE_MEDIA_STOP to 413,
        )

        /** window.__ompKey (src/platform/androidKeys.ts) answers true when the page handled the key. */
        private fun jsKey(code: Int) = "(function(){return !!(window.__ompKey && window.__ompKey($code));})()"
    }
}
