package sv.edu.catolica.hospital_universitario

/** Operaciones de red: invocar siempre fuera del hilo principal. */
interface AuthRepository {
    fun signIn(email: String, password: String): AuthSession
    fun signOut(accessToken: String)
    fun refresh(session: AuthSession): AuthSession
}

data class AuthSession(
    val userId: String,
    val displayName: String,
    val email: String,
    val roles: Set<SessionManager.Role>,
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long
)

class AuthException(val messageRes: Int) : Exception()
