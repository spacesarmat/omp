package com.spacesarmat.omp.sources

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.charset.Charset

class BodyCharsetTest {
    private val cp1251 = Charset.forName("windows-1251")
    private val koi8 = Charset.forName("KOI8-R")

    @Test
    fun readsCharsetFromContentType() {
        assertEquals("windows-1251", BodyCharset.fromContentType("text/html; charset=windows-1251")?.name()?.lowercase())
        assertEquals("windows-1251", BodyCharset.fromContentType("text/html;charset=\"cp1251\"")?.name()?.lowercase())
        assertEquals("koi8-r", BodyCharset.fromContentType("text/html; Charset=KOI8-R")?.name()?.lowercase())
        assertNull(BodyCharset.fromContentType("text/html"))
        assertNull(BodyCharset.fromContentType(null))
        assertNull(BodyCharset.fromContentType("text/html; charset=nonsense-42"))
    }

    @Test
    fun sniffsMetaTags() {
        assertEquals("windows-1251", BodyCharset.sniff("<html><head><meta charset=\"windows-1251\">".toByteArray())?.name()?.lowercase())
        assertEquals(
            "windows-1251",
            BodyCharset.sniff("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=win-1251\">".toByteArray())?.name()?.lowercase(),
        )
        assertEquals("koi8-r", BodyCharset.sniff("<?xml version=\"1.0\" encoding=\"koi8-r\"?><rss/>".toByteArray())?.name()?.lowercase())
        assertNull(BodyCharset.sniff("<html><body>charset nowhere</body>".toByteArray()))
    }

    @Test
    fun decodesByHeaderThenMetaThenUtf8() {
        val text = "Фильм ёлки"
        assertEquals(text, BodyCharset.decode(text.toByteArray(cp1251), "text/html; charset=windows-1251"))
        val page = "<meta charset=windows-1251><b>$text</b>"
        assertEquals(page, BodyCharset.decode(page.toByteArray(cp1251), "text/html"))
        val koiPage = "<meta http-equiv='Content-Type' content='text/html; charset=koi8-r'>$text"
        assertEquals(koiPage, BodyCharset.decode(koiPage.toByteArray(koi8), null))
        assertEquals(text, BodyCharset.decode(text.toByteArray(Charsets.UTF_8), null))
        // header wins over meta
        val lying = "<meta charset=koi8-r>$text"
        assertEquals(lying, BodyCharset.decode(lying.toByteArray(Charsets.UTF_8), "text/html; charset=utf-8"))
    }

    @Test
    fun utf8BomWins() {
        val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "ок".toByteArray(Charsets.UTF_8)
        assertEquals("ок", BodyCharset.decode(bytes, "text/html; charset=windows-1251"))
    }
}
