package com.spacesarmat.omp.box

import java.math.BigInteger
import java.security.MessageDigest
import java.security.interfaces.RSAPublicKey

/**
 * Android TV Remote protocol v2 — what «Android TV Remote Service» on Google TV / Android TV boxes speaks.
 * Written from the publicly documented protocol facts (as described by the reverse-engineered client projects
 * androidtvremote2 / androidtv-remote); no code is taken from them:
 *
 * - Pairing: TLS on port 6467, the client presents its own self-signed certificate. Varint-length-prefixed
 *   PairingMessage { protocol_version=1 (2), status=2 (200 OK), pairing_request=10 { service_name=1, client_name=2 },
 *   pairing_request_ack=11, pairing_option=20 { input_encodings=1 { type=1 (3 = hexadecimal), symbol_length=2 (6) },
 *   preferred_role=3 (1 = input) }, pairing_configuration=30 { encoding=1, client_role=2 }, pairing_configuration_ack=31,
 *   pairing_secret=40 { secret=1 }, pairing_secret_ack=41 }. Status 400 error, 401 bad configuration, 402 bad secret.
 *   After the configuration the TV shows a 6-hex-digit code. secret = SHA-256(client modulus, client exponent,
 *   server modulus, server exponent, the code's last 4 hex digits as 2 bytes) — numbers as unsigned big-endian bytes;
 *   the code's first byte must equal secret[0] (a local check of a mistyped code).
 * - Remote: TLS on port 6466 with the same certificate. RemoteMessage { remote_configure=1 { code1=1 (features),
 *   device_info=2 { model=1, vendor=2, unknown1=3, unknown2=4, package_name=5, app_version=6 } }, remote_set_active=2
 *   { active=1 }, remote_error=3, remote_ping_request=8 { val1=1 }, remote_ping_response=9 { val1=1 },
 *   remote_key_inject=10 { key_code=1 (Android KeyEvent code), direction=2 (1 start long, 2 end long, 3 short) },
 *   remote_start=40 { started=1 }, remote_set_volume_level=50 { volume_max=6, volume_level=7, volume_muted=8 } }.
 *   The TV opens with remote_configure, the client answers with its own and with remote_set_active; pings must be
 *   answered with the same val1 or the TV drops the connection.
 */
object AtvRemoteProtocol {
    const val PAIRING_PORT = 6467
    const val REMOTE_PORT = 6466
    const val PROTOCOL_VERSION = 2
    const val STATUS_OK = 200
    const val STATUS_ERROR = 400
    const val STATUS_BAD_CONFIGURATION = 401
    const val STATUS_BAD_SECRET = 402
    const val ENCODING_HEX = 3
    const val CODE_LENGTH = 6
    const val ROLE_INPUT = 1
    const val SERVICE_NAME = "atvremote"

    // PairingMessage fields
    const val P_STATUS = 2
    const val P_REQUEST_ACK = 11
    const val P_OPTION = 20
    const val P_CONFIGURATION_ACK = 31
    const val P_SECRET_ACK = 41

    // RemoteMessage fields
    const val R_CONFIGURE = 1
    const val R_SET_ACTIVE = 2
    const val R_ERROR = 3
    const val R_PING_REQUEST = 8
    const val R_PING_RESPONSE = 9
    const val R_KEY_INJECT = 10
    const val R_START = 40
    const val R_SET_VOLUME = 50

    const val DIRECTION_START_LONG = 1
    const val DIRECTION_END_LONG = 2
    const val DIRECTION_SHORT = 3

    /** Features the phone asks for: ping 1, key 2, power 32, volume 64, app link 512 (no IME, no voice). */
    const val FEATURES = 1 or 2 or 32 or 64 or 512

    private fun pairing(build: (ProtoWriter) -> Unit): ByteArray {
        val w = ProtoWriter().int(1, PROTOCOL_VERSION).int(P_STATUS, STATUS_OK)
        build(w)
        return w.toByteArray()
    }

    private fun hexEncoding() = ProtoWriter().int(1, ENCODING_HEX).int(2, CODE_LENGTH)

    fun pairingRequest(clientName: String): ByteArray =
        pairing { it.message(10, ProtoWriter().string(1, SERVICE_NAME).string(2, clientName)) }

    fun pairingOption(): ByteArray =
        pairing { it.message(P_OPTION, ProtoWriter().message(1, hexEncoding()).int(3, ROLE_INPUT)) }

    fun pairingConfiguration(): ByteArray =
        pairing { it.message(30, ProtoWriter().message(1, hexEncoding()).int(2, ROLE_INPUT)) }

    fun pairingSecret(secret: ByteArray): ByteArray = pairing { it.message(40, ProtoWriter().bytes(1, secret)) }

    /** The status of a pairing answer; 0 when the TV sent none. */
    fun pairingStatus(message: ByteArray): Int = ProtoMessage(message).int(P_STATUS) ?: 0

    /** A 6-hex-digit code as typed (spaces and case ignored); null when it is not one. */
    fun normalizeCode(code: String): String? {
        val c = code.filterNot { it.isWhitespace() }.uppercase()
        return if (c.length == CODE_LENGTH && c.all { it in '0'..'9' || it in 'A'..'F' }) c else null
    }

    /** A number as unsigned big-endian bytes without a leading sign byte. */
    fun unsigned(n: BigInteger): ByteArray {
        val b = n.toByteArray()
        return if (b.size > 1 && b[0] == 0.toByte()) b.copyOfRange(1, b.size) else b
    }

    /** SHA-256 over both public keys and the code's last 2 bytes, see the class comment. */
    fun pairingSecret(client: RSAPublicKey, server: RSAPublicKey, code: String): ByteArray {
        val c = normalizeCode(code) ?: throw IllegalArgumentException("bad code")
        val md = MessageDigest.getInstance("SHA-256")
        md.update(unsigned(client.modulus))
        md.update(unsigned(client.publicExponent))
        md.update(unsigned(server.modulus))
        md.update(unsigned(server.publicExponent))
        md.update(hex(c.substring(2)))
        return md.digest()
    }

    /** The code's first byte matches the secret's: the TV would accept it. */
    fun codeMatches(secret: ByteArray, code: String): Boolean {
        val c = normalizeCode(code) ?: return false
        return secret.isNotEmpty() && (secret[0].toInt() and 0xFF) == c.substring(0, 2).toInt(16)
    }

    private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    // ---- remote channel ----

    fun remoteConfigure(model: String, vendor: String, appVersion: String): ByteArray {
        val info = ProtoWriter().string(1, model).string(2, vendor).int(3, 1).string(4, "1")
            .string(5, SERVICE_NAME).string(6, appVersion)
        return ProtoWriter().message(R_CONFIGURE, ProtoWriter().int(1, FEATURES).message(2, info)).toByteArray()
    }

    fun remoteSetActive(): ByteArray = ProtoWriter().message(R_SET_ACTIVE, ProtoWriter().int(1, FEATURES)).toByteArray()

    fun pingResponse(val1: Long): ByteArray = ProtoWriter().message(R_PING_RESPONSE, ProtoWriter().varint(1, val1)).toByteArray()

    fun keyInject(keyCode: Int, direction: Int): ByteArray =
        ProtoWriter().message(R_KEY_INJECT, ProtoWriter().int(1, keyCode).int(2, direction)).toByteArray()

    /** What a message from the TV asks for. */
    sealed class Incoming {
        object Configure : Incoming()
        object SetActive : Incoming()
        class Ping(val val1: Long) : Incoming()
        class Volume(val level: Int, val max: Int, val muted: Boolean) : Incoming()
        class Started(val on: Boolean) : Incoming()
        object Error : Incoming()
        object Other : Incoming()
    }

    fun parseRemote(message: ByteArray): Incoming {
        val m = ProtoMessage(message)
        return when {
            m.has(R_PING_REQUEST) -> Incoming.Ping(m.message(R_PING_REQUEST)?.long(1) ?: 0)
            m.has(R_CONFIGURE) -> Incoming.Configure
            m.has(R_SET_ACTIVE) -> Incoming.SetActive
            m.has(R_SET_VOLUME) -> {
                val v = m.message(R_SET_VOLUME)!!
                Incoming.Volume(v.int(7) ?: 0, v.int(6) ?: 0, (v.long(8) ?: 0) != 0L)
            }
            m.has(R_START) -> Incoming.Started((m.message(R_START)?.long(1) ?: 0) != 0L)
            m.has(R_ERROR) -> Incoming.Error
            else -> Incoming.Other
        }
    }
}
