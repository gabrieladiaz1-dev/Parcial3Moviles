package sv.edu.catolica.hospital_universitario

object ReceptionStatuses {
    fun option(code: String): StatusOption = StatusOption(when (code) {
        "programada" -> R.string.remote_scheduled
        "confirmada" -> R.string.st_confirmada
        "en_atencion" -> R.string.st_en_atencion
        "completada" -> R.string.st_completada
        "cancelada", "cancelado" -> R.string.st_cancelada
        "no_asistio" -> R.string.remote_no_show
        "solicitado" -> R.string.remote_requested
        "asignado" -> R.string.remote_assigned
        "hospitalizado" -> R.string.patient_status_hospitalized
        "alta_medica" -> R.string.remote_medical_discharge
        "cerrado" -> R.string.remote_closed
        "disponible" -> R.string.status_available
        "ocupada" -> R.string.status_occupied
        "limpieza" -> R.string.remote_cleaning
        "mantenimiento" -> R.string.remote_maintenance
        else -> R.string.remote_unknown
    }, when (code) {
        "confirmada", "completada", "hospitalizado", "cerrado", "disponible" -> StatusStyle.CONFIRMED
        "en_atencion", "asignado" -> StatusStyle.IN_PROGRESS
        "cancelada", "cancelado", "no_asistio", "ocupada" -> StatusStyle.TRIAGE
        else -> StatusStyle.WAITING
    })
}
