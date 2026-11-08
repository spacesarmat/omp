package com.spacesarmat.omp.install

import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ContextWrapper
import android.content.Intent
import com.spacesarmat.omp.ApkInstallTracker
import com.spacesarmat.omp.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32])
class ApkInstallTrackerTest {
    @Before
    fun clearNotifications() {
        RuntimeEnvironment.getApplication().getSystemService(NotificationManager::class.java).cancelAll()
    }

    @Test
    fun manifestReceiverOpensAppAfterUpdate() {
        val context = RuntimeEnvironment.getApplication()

        ApkInstallTracker().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

        val launch = shadowOf(context).nextStartedActivity
        assertNotNull(launch)
        assertEquals(MainActivity::class.java.name, launch.component?.className)
    }

    @Test
    fun startFailureShowsUpdateNotification() {
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun startActivity(intent: Intent) {
                throw ActivityNotFoundException("blocked")
            }
        }

        ApkInstallTracker().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

        val nm = shadowOf(context.getSystemService(NotificationManager::class.java))
        assertEquals(1, nm.allNotifications.size)
        assertNotNull(nm.allNotifications.single().contentIntent)
    }
}
