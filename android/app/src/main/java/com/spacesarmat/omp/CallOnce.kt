package com.spacesarmat.omp

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.util.concurrent.atomic.AtomicBoolean

/** Settles a PluginCall at most once, from any thread. */
internal class CallOnce(private val call: PluginCall) {
    private val done = AtomicBoolean(false)
    fun resolve(data: JSObject? = null) {
        if (done.compareAndSet(false, true)) {
            if (data == null) call.resolve() else call.resolve(data)
        }
    }
    fun reject(message: String) {
        if (done.compareAndSet(false, true)) call.reject(message)
    }
    fun reject(message: String, code: String) {
        if (done.compareAndSet(false, true)) call.reject(message, code)
    }
}
