package sv.edu.catolica.hospital_universitario

import java.util.concurrent.Executors

/** Sesión real en memoria. Se requiere iniciar sesión al reiniciar el proceso. */
object SessionManager {
    enum class Role { RECEPTION, NURSING, DOCTOR }

    data class User(val role: Role, val displayName: String, val email: String)

    @Volatile var currentUser: User? = null
        private set

    @Volatile private var session: AuthSession? = null

    /** Bloquea solo el trabajador que solicita datos; nunca invocar desde el hilo principal. */
    private val refreshLock = Any()

    fun requireAccessToken(): String = synchronized(refreshLock) {
        val current = session ?: throw AuthException(R.string.auth_access_denied)
        if (current.expiresAt > System.currentTimeMillis() / 1000 + 60) return@synchronized current.accessToken
        check(android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            "Session refresh must run off the main thread"
        }
        val renewed = AppContainer.authRepository.refresh(current)
        synchronized(this) {
            if (session !== current) {
                signOutExecutor.execute { runCatching { AppContainer.authRepository.signOut(renewed.accessToken) } }
                throw AuthException(R.string.auth_access_denied)
            }
            session = renewed
        }
        renewed.accessToken
    }
    private val signOutExecutor = Executors.newSingleThreadExecutor()

    val currentRole: Role? get() = currentUser?.role
    val currentUserName: String? get() = currentUser?.displayName
    /** auth.uid() de la sesión abierta (destinatario de los avisos propios). */
    val userId: String? get() = session?.userId

    @Synchronized
    fun start(authSession: AuthSession, role: Role) {
        require(role in authSession.roles)
        AppContainer.patientRepository.clear()
        AppContainer.appointmentRepository.clear()
        AppContainer.admissionRepository.clear()
        AppContainer.turnRepository.clear()
        AppContainer.selectedPatientName = null
        session = authSession
        currentUser = User(role, authSession.displayName, authSession.email)
    }

    @Synchronized
    fun logout() {
        val previous = session
        session = null
        currentUser = null
        AppContainer.patientRepository.clear()
        AppContainer.appointmentRepository.clear()
        AppContainer.admissionRepository.clear()
        AppContainer.turnRepository.clear()
        AppContainer.selectedPatientName = null
        if (previous != null) signOutExecutor.execute {
            runCatching { AppContainer.authRepository.signOut(previous.accessToken) }
        }
    }
}
