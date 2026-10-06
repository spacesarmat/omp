package com.spacesarmat.omp.rpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts [PhoneRpcService] after a reboot or an app update when the TV search is on ([RpcConfig.enabled]). */
class RpcBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        try {
            if (RpcConfig(SharedRpcPrefs(context)).enabled) PhoneRpcService.start(context)
        } catch (_: Exception) {
            // a start the system refuses: the app starts the service on its next launch
        }
    }
}
