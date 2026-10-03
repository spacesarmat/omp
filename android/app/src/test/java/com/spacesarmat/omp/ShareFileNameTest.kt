package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test

class ShareFileNameTest {
    @Test
    fun keepsTheLogName() {
        assertEquals("omp-журнал-2026-10-03.txt", shareFileName("omp-журнал-2026-10-03.txt"))
    }

    @Test
    fun dropsDirectoriesAndOddCharacters() {
        assertEquals("passwd.txt", shareFileName("../../etc/passwd"))
        assertEquals("a_b.txt", shareFileName("a b.txt"))
        assertEquals("c.txt", shareFileName("a\\b\\c.txt"))
    }

    @Test
    fun dotsAndControlCharactersNeverEscape() {
        assertEquals("omp-log.txt", shareFileName(".."))
        assertEquals("txt.txt", shareFileName("..txt"))
        assertEquals("omp-log.txt", shareFileName("\u0000"))
        assertEquals("a_b.txt", shareFileName("a\u0000b.txt"))
    }

    @Test
    fun longNamesAreCapped() {
        val name = shareFileName("x".repeat(300) + ".txt")
        assertEquals(true, name.length <= 104)
    }

    @Test
    fun fallsBackWhenEmpty() {
        assertEquals("omp-log.txt", shareFileName(null))
        assertEquals("omp-log.txt", shareFileName("  "))
    }
}
