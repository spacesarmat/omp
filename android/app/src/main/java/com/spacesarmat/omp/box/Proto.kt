package com.spacesarmat.omp.box

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * A tiny protocol buffers wire-format writer / reader: varints (wire type 0) and length-delimited fields (wire type 2)
 * are all the Android TV Remote messages need. No dependency on protobuf-javalite.
 */
class ProtoWriter {
    private val out = ByteArrayOutputStream()

    fun varint(field: Int, value: Long): ProtoWriter {
        tag(field, 0)
        writeVarint(out, value)
        return this
    }

    fun int(field: Int, value: Int): ProtoWriter = varint(field, value.toLong())

    fun bool(field: Int, value: Boolean): ProtoWriter = varint(field, if (value) 1 else 0)

    fun bytes(field: Int, value: ByteArray): ProtoWriter {
        tag(field, 2)
        writeVarint(out, value.size.toLong())
        out.write(value)
        return this
    }

    fun string(field: Int, value: String): ProtoWriter = bytes(field, value.toByteArray(Charsets.UTF_8))

    fun message(field: Int, value: ProtoWriter): ProtoWriter = bytes(field, value.toByteArray())

    fun toByteArray(): ByteArray = out.toByteArray()

    private fun tag(field: Int, wire: Int) = writeVarint(out, ((field shl 3) or wire).toLong())

    companion object {
        fun writeVarint(out: OutputStream, value: Long) {
            var v = value
            while (true) {
                if (v and 0x7FL.inv() == 0L) {
                    out.write(v.toInt())
                    return
                }
                out.write(((v and 0x7F) or 0x80).toInt())
                v = v ushr 7
            }
        }

        fun varintBytes(value: Long): ByteArray = ByteArrayOutputStream().also { writeVarint(it, value) }.toByteArray()
    }
}

/** One decoded field: [value] for varints, [bytes] for length-delimited ones. */
class ProtoField(val number: Int, val wire: Int, val value: Long, val bytes: ByteArray?)

/** Decodes a message into its fields; unknown wire types (fixed32/64) are skipped. */
class ProtoMessage(data: ByteArray) {
    val fields: List<ProtoField>

    init {
        val list = ArrayList<ProtoField>()
        var i = 0
        fun varint(): Long {
            var shift = 0
            var result = 0L
            while (true) {
                if (i >= data.size) throw IOException("truncated varint")
                val b = data[i++].toInt() and 0xFF
                result = result or ((b and 0x7F).toLong() shl shift)
                if (b and 0x80 == 0) return result
                shift += 7
                if (shift > 63) throw IOException("varint too long")
            }
        }
        while (i < data.size) {
            val key = varint()
            val number = (key ushr 3).toInt()
            when (val wire = (key and 7).toInt()) {
                0 -> list.add(ProtoField(number, wire, varint(), null))
                2 -> {
                    val len = varint()
                    if (len < 0 || len > data.size - i) throw IOException("bad length")
                    list.add(ProtoField(number, wire, 0, data.copyOfRange(i, i + len.toInt())))
                    i += len.toInt()
                }
                1 -> i += 8
                5 -> i += 4
                else -> throw IOException("bad wire type $wire")
            }
        }
        if (i > data.size) throw IOException("truncated field")
        fields = list
    }

    fun has(number: Int): Boolean = fields.any { it.number == number }

    fun long(number: Int): Long? = fields.lastOrNull { it.number == number && it.wire == 0 }?.value

    fun int(number: Int): Int? = long(number)?.toInt()

    fun bytes(number: Int): ByteArray? = fields.lastOrNull { it.number == number && it.wire == 2 }?.bytes

    fun message(number: Int): ProtoMessage? = bytes(number)?.let { ProtoMessage(it) }

    fun string(number: Int): String? = bytes(number)?.toString(Charsets.UTF_8)
}

/** Messages on both TLS channels are framed by a varint length prefix. */
object ProtoFrames {
    /** Largest message accepted from the TV (its own are a few hundred bytes). */
    const val MAX = 64 * 1024

    fun write(out: OutputStream, message: ByteArray) {
        out.write(ProtoWriter.varintBytes(message.size.toLong()) + message)
        out.flush()
    }

    fun read(input: InputStream): ByteArray {
        var shift = 0
        var len = 0L
        while (true) {
            val b = input.read()
            if (b < 0) throw EOFException("closed")
            len = len or ((b and 0x7F).toLong() shl shift)
            if (b and 0x80 == 0) break
            shift += 7
            if (shift > 28) throw IOException("bad frame length")
        }
        if (len > MAX) throw IOException("frame too large")
        val buf = ByteArray(len.toInt())
        var off = 0
        while (off < buf.size) {
            val n = input.read(buf, off, buf.size - off)
            if (n < 0) throw EOFException("closed")
            off += n
        }
        return buf
    }
}
