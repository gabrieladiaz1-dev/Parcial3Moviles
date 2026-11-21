package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import sv.edu.catolica.hospital_universitario.SupabaseClient.request

/** Cliente HTTPS de Supabase Auth y Data API. No utiliza claves privilegiadas. */
class SupabaseAuthRepository : AuthRepository {
    override fun signIn(email: String, password: String): AuthSession {
        val response = JSONObject(request(
            "auth/v1/token?grant_type=password", "POST",
            JSONObject().put("email", email).put("password", password)
        ))
        val token = response.getString("access_token")
        try {
            val userId = response.getJSONObject("user").getString("id")
            val profiles = JSONArray(request(
                "rest/v1/profiles?id=eq.$userId&select=first_name,last_name", token = token
            ))
            val roleRows = JSONArray(request(
                "rest/v1/user_roles?user_id=eq.$userId&active=eq.true&select=role", token = token
            ))
            val roles = buildSet {
                for (index in 0 until roleRows.length()) {
                    when (roleRows.getJSONObject(index).getString("role")) {
                        "recepcionista" -> add(SessionManager.Role.RECEPTION)
                        "enfermera" -> add(SessionManager.Role.NURSING)
                        "doctor" -> add(SessionManager.Role.DOCTOR)
                    }
                }
            }
            if (BuildConfig.DEBUG) android.util.Log.d("SupabaseConnection",
                "authorization profiles=" + profiles.length() + " supportedRoles=" + roles.size)
            if (profiles.length() != 1) throw AuthException(R.string.auth_profile_unavailable)
            if (roles.isEmpty()) throw AuthException(R.string.auth_no_role)
            val profile = profiles.getJSONObject(0)
            val name = listOf(profile.optString("first_name"), profile.optString("last_name"))
                .filter { it.isNotBlank() }.joinToString(" ").ifBlank { email }
            return AuthSession(userId, name, email, roles, token,
                response.getString("refresh_token"), response.optLong("expires_at",
                    System.currentTimeMillis() / 1000 + response.getLong("expires_in")))
        } catch (error: Exception) {
            runCatching { signOut(token) }
            throw error
        }
    }

    override fun refresh(session: AuthSession): AuthSession {
        val response = JSONObject(request("auth/v1/token?grant_type=refresh_token", "POST",
            JSONObject().put("refresh_token", session.refreshToken)))
        val accessToken = response.getString("access_token")
        val userId = response.getJSONObject("user").getString("id")
        if (userId != session.userId) throw AuthException(R.string.auth_access_denied)
        return session.copy(
            accessToken = accessToken,
            refreshToken = response.getString("refresh_token"),
            expiresAt = response.optLong("expires_at",
                System.currentTimeMillis() / 1000 + response.getLong("expires_in"))
        )
    }

    override fun signOut(accessToken: String) {
        request("auth/v1/logout?scope=local", "POST", token = accessToken)
    }


}
