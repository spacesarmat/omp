package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test

class InstallPermissionWaitTest {
    @Test
    fun theInstallGoesOnOnlyAfterTheSettingsPageWithThePermission() {
        val w = InstallPermissionWait("apk")
        // back before the page even opened: keep waiting
        assertEquals(InstallPermissionWait.Next.WAIT, w.onResume(false))
        w.onPause()
        assertEquals(InstallPermissionWait.Next.INSTALL, w.onResume(true))
    }

    @Test
    fun backWithoutThePermissionGivesUp() {
        val w = InstallPermissionWait("apk")
        w.onPause()
        assertEquals(InstallPermissionWait.Next.GIVE_UP, w.onResume(false))
    }
}
