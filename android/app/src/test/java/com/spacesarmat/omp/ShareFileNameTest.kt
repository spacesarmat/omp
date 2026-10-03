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
        assertEquals("passwd", shareFileName("../../etc/passwd").removeSuffix(".txt"))
        assertEquals("a_b.txt", shareFileName("a b.txt"))
        assertEquals("c.txt", shareFileName("a\\b\\c.txt"))
    }

    @Test
    fun fallsBackWhenEmpty() {
        assertEquals("omp-log.txt", shareFileName(null))
        assertEquals("omp-log.txt", shareFileName("  "))
    }
}
