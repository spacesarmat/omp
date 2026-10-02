package com.spacesarmat.omp

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    // the launch intent was already handled before the activity got recreated
    private var skipLaunchIntent = false

    override fun onCreate(savedInstanceState: Bundle?) {
        skipLaunchIntent = savedInstanceState != null ||
            ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        registerPlugin(OmpNativePlugin::class.java)
        // BridgeActivity.onCreate passes the launch intent to onNewIntent below
        super.onCreate(savedInstanceState)
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
}
