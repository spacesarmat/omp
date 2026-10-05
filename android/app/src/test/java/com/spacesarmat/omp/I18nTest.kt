package com.spacesarmat.omp

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class I18nTest {
    @After
    fun reset() {
        I18n.lang = "ru"
    }

    @Test
    fun bothLanguagesHaveTheSameKeys() {
        assertEquals(I18n.keys("ru"), I18n.keys("en"))
        assertTrue(I18n.keys("ru").isNotEmpty())
    }

    @Test
    fun noTextIsEmptyAndPlaceholdersMatch() {
        val ph = Regex("\\{(\\w+)}")
        for (k in I18n.keys("ru")) {
            I18n.lang = "ru"
            val ru = I18n.s(k)
            I18n.lang = "en"
            val en = I18n.s(k)
            assertTrue(k, en.isNotEmpty() && ru.isNotEmpty())
            assertEquals(k, ph.findAll(ru).map { it.groupValues[1] }.toSet(), ph.findAll(en).map { it.groupValues[1] }.toSet())
        }
    }

    @Test
    fun argumentsFillThePlaceholders() {
        I18n.lang = "en"
        assertEquals("Port 8090 is used by another app", I18n.s("ts.portBusy", "port" to "8090"))
        I18n.lang = "ru"
        assertEquals("Порт 8090 занят другим приложением", I18n.s("ts.portBusy", "port" to "8090"))
    }

    @Test
    fun unknownKeyReturnsTheKey() {
        assertEquals("no.such.key", I18n.s("no.such.key"))
    }

    @Test
    fun systemRuleRussianForCisLanguages() {
        for (l in listOf("ru", "uk", "be", "kk")) assertEquals(l, "ru", I18n.resolve(null, l))
        for (l in listOf("en", "de", "fr", "")) assertEquals(l, "en", I18n.resolve(null, l))
    }

    @Test
    fun storedLanguageWinsOverTheSystemOne() {
        assertEquals("en", I18n.resolve("en", "ru"))
        assertEquals("ru", I18n.resolve("ru", "en"))
        assertEquals("ru", I18n.resolve("xx", "uk"))
    }

    @Test
    fun cloudflareTextsMatchTheDictionaries() {
        I18n.lang = "en"
        assertEquals("The site is behind a Cloudflare check — it could not be passed", I18n.s("errors.cfFailed"))
        assertEquals("The site asks for a Cloudflare check to be passed by hand", I18n.s("errors.cfInteractive"))
        I18n.lang = "ru"
        assertEquals("Сайт закрыт проверкой Cloudflare — пройти её не удалось", I18n.s("errors.cfFailed"))
        assertEquals("Сайт просит пройти проверку Cloudflare вручную", I18n.s("errors.cfInteractive"))
    }
}
