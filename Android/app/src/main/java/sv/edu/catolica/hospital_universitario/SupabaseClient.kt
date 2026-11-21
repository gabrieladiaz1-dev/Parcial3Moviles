package sv.edu.catolica.hospital_universitario

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Transporte compartido; las llamadas deben ejecutarse fuera del hilo principal. */
internal object SupabaseClient {
    fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null
    ): String {
        if (BuildConfig.SUPABASE_PUBLISHABLE_KEY.isBlank()) throw AuthException(R.string.auth_config_missing)
        val stage = when {
            path.startsWith("auth/v1/token") -> "auth"
            path.startsWith("rest/v1/profiles") -> "profile"
            path.startsWith("rest/v1/user_roles") -> "roles"
            else -> "api"
        }
        val connection = URL("${BuildConfig.SUPABASE_URL}/$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Prefer", "return=representation")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (BuildConfig.DEBUG) android.util.Log.d("SupabaseConnection", "stage=$stage http=$code")
            if (code !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val errorCode = runCatching { JSONObject(errorBody).optString("error_code") }.getOrDefault("")
                // Lista cerrada para no registrar textos arbitrarios de la respuesta.
                val knownCode = errorCode.takeIf { it in setOf("invalid_credentials", "email_not_confirmed",
                    "user_banned", "refresh_token_not_found", "refresh_token_already_used", "session_not_found",
                    "bad_jwt", "insufficient_aal") } ?: "other"
                if (BuildConfig.DEBUG) android.util.Log.w("SupabaseConnection", "stage=$stage authCode=$knownCode")
                throw AuthException(when {
                    errorCode == "invalid_credentials" -> R.string.error_invalid_credentials
                    errorCode == "email_not_confirmed" -> R.string.auth_email_unconfirmed
                    errorCode == "user_banned" -> R.string.auth_account_disabled
                    errorCode in setOf("refresh_token_not_found", "refresh_token_already_used", "session_not_found", "bad_jwt") ->
                        R.string.auth_session_expired
                    stage == "auth" && code in setOf(400, 422) -> R.string.auth_login_rejected
                    stage == "auth" && code == 401 -> R.string.auth_key_rejected
                    code == 429 -> R.string.auth_rate_limit
                    code == 401 || code == 403 -> R.string.auth_access_denied
                    code == 409 -> R.string.patient_conflict
                    else -> R.string.auth_server_error
                })
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } catch (error: IOException) {
            // Solo nombres de clases: nunca mensajes, cuerpos, cabeceras ni stack traces.
            val causes = generateSequence<Throwable>(error) { it.cause }.take(8).toList()
            if (BuildConfig.DEBUG) android.util.Log.w("SupabaseConnection",
                "stage=$stage transport=" + causes.joinToString(",") { it.javaClass.simpleName })
            throw AuthException(when {
                causes.any { it is java.security.cert.CertificateException } -> R.string.auth_certificate_error
                error is javax.net.ssl.SSLException -> R.string.auth_ssl_error
                error is java.net.UnknownHostException -> R.string.auth_dns_error
                error is java.net.SocketTimeoutException -> R.string.auth_timeout_error
                error is java.net.ConnectException -> R.string.auth_connect_error
                else -> R.string.auth_network_error
            })
        } finally {
            connection.disconnect()
        }
    }

}
