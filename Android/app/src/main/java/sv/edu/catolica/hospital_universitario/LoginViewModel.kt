package sv.edu.catolica.hospital_universitario

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Estado de la pantalla de inicio de sesión. */
sealed interface LoginState {
    data object Idle : LoginState
    data object Loading : LoginState
    data class Authenticated(val session: AuthSession) : LoginState
    data class Failed(val messageRes: Int) : LoginState
}

/**
 * ViewModel del login (MVVM): la Activity solo observa [state] y envía eventos.
 * La red se ejecuta con corrutinas en [io]; el ViewModel sobrevive a la rotación.
 */
class LoginViewModel(
    private val repository: AuthRepository = AppContainer.authRepository,
    private val io: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {

    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun signIn(email: String, password: String) {
        if (_state.value is LoginState.Loading) return
        _state.value = LoginState.Loading
        viewModelScope.launch {
            val result = withContext(io) { runCatching { repository.signIn(email, password) } }
            _state.value = result.fold(
                onSuccess = { LoginState.Authenticated(it) },
                onFailure = { LoginState.Failed((it as? AuthException)?.messageRes ?: R.string.auth_server_error) }
            )
        }
    }

    /** La sesión se entregó a SessionManager o se descartó: vuelve al estado inicial. */
    fun consumed() { _state.value = LoginState.Idle }

    /** Cierra en el servidor una sesión que el usuario no llegó a usar (eligió cancelar el rol). */
    fun discard(session: AuthSession) {
        _state.value = LoginState.Idle
        viewModelScope.launch(io) { runCatching { repository.signOut(session.accessToken) } }
    }

    override fun onCleared() {
        (_state.value as? LoginState.Authenticated)?.let { s ->
            // viewModelScope ya está cancelado: cierre de mejor esfuerzo fuera del ciclo de vida.
            AppContainer.ioExecutor.execute { runCatching { repository.signOut(s.session.accessToken) } }
        }
    }
}
