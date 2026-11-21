package sv.edu.catolica.hospital_universitario

import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** Ejecuta una operación de servidor sin bloquear la pantalla ni mostrar errores técnicos. */
object RemoteUi {
    fun <T> run(activity: AppCompatActivity, work: () -> T, success: (T) -> Unit) {
        val token = runCatching { SessionManager.requireAccessToken() }.getOrNull()
        if (token == null) {
            Navigator.goToLogin(activity, closeCurrent = true)
            return
        }
        val progress = MaterialAlertDialogBuilder(activity)
            .setMessage(R.string.remote_loading).setCancelable(false).show()
        AppContainer.ioExecutor.execute {
            val result = runCatching {
                if (activity.isDestroyed || activity.isFinishing ||
                    SessionManager.requireAccessToken() != token) throw AuthException(R.string.auth_access_denied)
                work()
            }
            activity.runOnUiThread {
                if (activity.isDestroyed || activity.isFinishing) return@runOnUiThread
                progress.dismiss()
                if (runCatching { SessionManager.requireAccessToken() }.getOrNull() != token) return@runOnUiThread
                result.fold(onSuccess = success, onFailure = { error ->
                    Toast.makeText(activity, (error as? AuthException)?.messageRes
                        ?: R.string.remote_operation_error, Toast.LENGTH_LONG).show()
                })
            }
        }
    }
}
