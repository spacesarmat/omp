package com.spacesarmat.omp

import android.content.Context
import android.hardware.ConsumerIrManager

/** Phone IR blaster. Receive exists only when the platform class actually has a learn method. */
object IrBlaster {
    private val RECEIVE = setOf("learn", "startlearning", "receive", "getlearnedpattern")

    fun receiveExposed(names: Collection<String>): Boolean =
        names.any { RECEIVE.contains(it.lowercase()) }

    fun hardware(context: Context): Pair<Boolean, Boolean> {
        val ir = context.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager ?: return false to false
        val transmit = try {
            ir.hasIrEmitter()
        } catch (_: RuntimeException) {
            false
        }
        val receive = receiveExposed(ir.javaClass.methods.map { it.name })
        return transmit to receive
    }

    /** Pattern is mark/space microseconds, starting with a mark. Frequency 0 becomes 38 kHz. */
    fun transmit(context: Context, frequency: Int, pulses: IntArray) {
        val ir = context.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager
            ?: throw IllegalStateException("no-ir")
        if (!ir.hasIrEmitter()) throw IllegalStateException("no-ir")
        val freq = if (frequency <= 0) 38000 else frequency
        ir.transmit(freq, pulses)
    }

    /**
     * Calls a vendor learn method if one exists. Stock ConsumerIrManager is transmit-only and this returns null.
     * The returned pattern is the int array argument a learn method might fill, which none of the public APIs do.
     */
    fun learn(context: Context): IntArray? {
        val ir = context.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager ?: return null
        val method = ir.javaClass.methods.firstOrNull { receiveExposed(listOf(it.name)) && it.parameterTypes.isEmpty() }
            ?: return null
        val result = try {
            method.invoke(ir)
        } catch (_: Throwable) {
            null
        }
        return result as? IntArray
    }
}
