package com.spacesarmat.omp.control

import java.io.IOException

/** The control server's port: the first of a list that binds (8095 may be taken by another OMP build on the box). */
object ControlPorts {
    /** [start] binds on a port or throws IOException; the first that works with what it returned, null when none. */
    fun <T> bindFirst(ports: List<Int>, start: (Int) -> T): Pair<Int, T>? {
        for (p in ports) {
            try {
                return p to start(p)
            } catch (_: IOException) {
                // taken: the next one
            }
        }
        return null
    }
}
