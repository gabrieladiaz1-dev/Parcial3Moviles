package sv.edu.catolica.hospital_universitario

import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** Diálogo para elegir un paciente de la lista de pacientes. */
object PatientPicker {
    fun show(activity: AppCompatActivity, onSelected: (Patient) -> Unit) {
        AppContainer.ioExecutor.execute {
            val result = runCatching {
                AppContainer.patientRepository.refresh()
                AppContainer.patientRepository.getAll()
            }
            activity.runOnUiThread {
                if (activity.isDestroyed || activity.isFinishing) return@runOnUiThread
                result.fold(onSuccess = { patients ->
                    if (patients.isEmpty()) {
                        android.widget.Toast.makeText(activity, R.string.patients_empty,
                            android.widget.Toast.LENGTH_LONG).show()
                    } else {
                        MaterialAlertDialogBuilder(activity)
                            .setTitle(R.string.picker_title)
                            .setItems(patients.map { it.fullName }.toTypedArray()) { _, which ->
                                onSelected(patients[which])
                            }
                            .setNegativeButton(R.string.list_cancel, null)
                            .show()
                    }
                }, onFailure = { error ->
                    android.widget.Toast.makeText(activity,
                        (error as? AuthException)?.messageRes ?: R.string.auth_server_error,
                        android.widget.Toast.LENGTH_LONG).show()
                })
            }
        }
    }
}
