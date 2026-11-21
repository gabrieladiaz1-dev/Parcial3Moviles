package sv.edu.catolica.hospital_universitario

import androidx.annotation.StringRes

/** Estado clínico/administrativo de un paciente. El texto visible vive en strings.xml. */
enum class PatientStatus(@StringRes val labelRes: Int) {
    ACTIVE(R.string.patient_status_active),
    HOSPITALIZED(R.string.patient_status_hospitalized),
    TRIAGE(R.string.patient_status_triage),
    FOLLOW_UP(R.string.patient_status_follow_up),
    IN_CARE(R.string.patient_status_in_care),
    UNSPECIFIED(R.string.patient_status_unspecified)
}

data class Patient(
    val id: String = "",
    val fullName: String,
    /** Número de expediente (ej. EXP-001284). Si va vacío, el repositorio lo genera al crear. */
    val record: String = "",
    val status: PatientStatus,
    val age: Int?,
    val phone: String,
    val firstName: String = "",
    val lastName: String = "",
    /** Fecha ISO yyyy-MM-dd; nunca se reconstruye a partir de la edad. */
    val birthDate: String? = null,
    val dui: String? = null,
    val city: String? = null
)
