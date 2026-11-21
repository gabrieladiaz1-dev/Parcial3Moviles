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

/**
 * Base MVVM para las pantallas nativas por rol. Expone [loading] como estado observable y ejecuta
 * las llamadas al repositorio con corrutinas en [io]. Una sola operación a la vez: evita dobles
 * envíos (p. ej. asignar la misma cama o cerrar la misma consulta dos veces).
 */
abstract class OperationViewModel(
    private val role: SessionManager.Role,
    private val io: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    /**
     * Ejecuta [operation] fuera del hilo principal y entrega el resultado en el principal.
     * Devuelve false si ya hay una operación en curso.
     */
    fun <T> execute(operation: () -> T, deliver: (Result<T>) -> Unit): Boolean {
        if (_loading.value) return false
        _loading.value = true
        val user = SessionManager.currentUser
        viewModelScope.launch {
            val result = withContext(io) {
                runCatching {
                    if (SessionManager.currentUser !== user || user?.role != role)
                        throw AuthException(R.string.auth_access_denied)
                    operation()
                }
            }
            _loading.value = false
            if (SessionManager.currentUser === user) deliver(result)
        }
        return true
    }
}

/** ViewModel compartido por todas las pantallas de Recepción. */
class ReceptionDeskViewModel(
    val repository: ReceptionDeskRepository = AppContainer.receptionDeskRepository
) : OperationViewModel(SessionManager.Role.RECEPTION)

/** ViewModel compartido por todas las pantallas nativas del Doctor. */
class DoctorNativeViewModel(
    val repository: DoctorNativeRepository = AppContainer.doctorNativeRepository
) : OperationViewModel(SessionManager.Role.DOCTOR)
