package com.spacesarmat.omp.sources

import java.nio.charset.Charset

/**
 * Charset of a tracker page: the Content-Type header, then `<meta charset>` / `http-equiv` / the XML
 * declaration in the first bytes, else UTF-8. A UTF-8 BOM always wins.
 */
object BodyCharset {
    private const val SNIFF_BYTES = 4096
    private val HEADER = Regex("charset\\s*=\\s*[\"']?\\s*([A-Za-z0-9._:-]+)", RegexOption.IGNORE_CASE)
    private val META = Regex("<meta[^>]+charset\\s*=\\s*[\"']?\\s*([A-Za-z0-9._:-]+)", RegexOption.IGNORE_CASE)
    private val XML = Regex("^\\s*<\\?xml[^>]+encoding\\s*=\\s*[\"']([A-Za-z0-9._:-]+)", RegexOption.IGNORE_CASE)
    private val ALIASES = mapOf(
        "cp1251" to "windows-1251",
        "win-1251" to "windows-1251",
        "win1251" to "windows-1251",
        "windows1251" to "windows-1251",
        "x-cp1251" to "windows-1251",
        "koi8r" to "koi8-r",
        "koi8" to "koi8-r",
        "utf8" to "utf-8",
    )

    fun forName(name: String?): Charset? {
        val n = name?.trim()?.lowercase() ?: return null
        if (n.isEmpty()) return null
        return try {
            Charset.forName(ALIASES[n] ?: n)
        } catch (e: Exception) {
            null
        }
    }

    fun fromContentType(contentType: String?): Charset? {
        val m = HEADER.find(contentType ?: return null) ?: return null
        return forName(m.groupValues[1])
    }

    /** Charset declared in the first bytes of an HTML or XML document. */
    fun sniff(bytes: ByteArray): Charset? {
        // ASCII-compatible view of the head: tags and attribute values are ASCII in every supported charset
        val head = String(bytes, 0, minOf(bytes.size, SNIFF_BYTES), Charsets.ISO_8859_1)
        val m = XML.find(head) ?: META.find(head) ?: return null
        return forName(m.groupValues[1])
    }

    fun decode(bytes: ByteArray, contentType: String?): String {
        if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) {
            return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
        }
        val cs = fromContentType(contentType) ?: sniff(bytes) ?: Charsets.UTF_8
        return String(bytes, cs)
    }
}
