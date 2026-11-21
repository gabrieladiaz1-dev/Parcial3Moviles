package sv.edu.catolica.hospital_universitario

import org.json.JSONObject
import java.util.UUID

/**
 * Ambulancia en Recepción: estado de la unidad, solicitud de traslado (request_medical_transport, con clave
 * idempotente) y traslados recientes (RLS de ambulance_requests: recepción los lee todos). Autorizar, asignar
 * unidad y conductor sigue siendo tarea de administración en el panel web.
 */
class ReceptionAmbulanceActivity : ReceptionDeskActivity() {
    override val titleRes = R.string.desk_ambulance
    private var patient: JSONObject? = null
    private var priority = "normal"
    /** Envío sin confirmar: se reintenta con los mismos datos y la misma clave para no duplicar. */
    private var pending: JSONObject? = null

    override fun render() {
        clear()
        retry = { render() }
        work({
            repo.rows("ambulances", "select=code,status,active&active=eq.true&order=id") to
                repo.rows("ambulance_requests", "select=id,contact_name,contact_phone,pickup_location,destination,reason,priority,status,requested_at,decision_reason,patients(first_name,last_name)&order=requested_at.desc&limit=20")
        }) { (units, items) ->
            units.forEach { unit ->
                card(getString(R.string.desk_ambulance_unit, unit.value("code")), unitState(unit.value("status")))
            }
            form()
            section(R.string.desk_ambulance_recent)
            if (items.isEmpty()) note(getString(R.string.desk_ambulance_empty))
            items.forEach { item ->
                val who = item.optJSONObject("patients")?.let { listOf(it.value("first_name"), it.value("last_name")).filter { s -> s.isNotBlank() }.joinToString(" ") }
                    ?.ifBlank { null } ?: item.value("contact_name")
                val route = getString(R.string.desk_ambulance_route, item.value("pickup_location"),
                    item.value("destination").ifBlank { getString(R.string.desk_ambulance_no_destination) })
                val urgency = if (item.value("priority") == "urgente") getString(R.string.desk_urgent) else getString(R.string.desk_normal)
                val body = card(who, listOf(requestState(item.value("status")), route, urgency, time(item.value("requested_at"))).joinToString("\n"))
                note(item.value("reason"), body)
                note(getString(R.string.desk_ambulance_contact_line, item.value("contact_name"), item.value("contact_phone")), body)
                if (item.value("decision_reason").isNotBlank()) note(item.value("decision_reason"), body)
            }
        }
    }

    private fun form() {
        val body = card(getString(R.string.desk_ambulance_request), getString(R.string.desk_ambulance_hint))
        val chosen = patient
        if (chosen == null) {
            val document = field(R.string.desk_dui, body, max = 10)
            action(R.string.desk_search_patient, body) {
                val dui = runCatching { normalizeDocument(document.text.toString()) }.getOrElse { showError(it); return@action }
                work({ repo.patientByDui(dui) ?: throw DeskException(R.string.desk_ambulance_no_patient) }) { found ->
                    patient = found; render()
                }
            }
            return
        }
        val name = listOf(chosen.value("first_name"), chosen.value("last_name")).filter { it.isNotBlank() }.joinToString(" ")
        note(getString(R.string.desk_ambulance_patient, name, chosen.value("dui")), body)
        if (pending == null) action(R.string.desk_ambulance_change_patient, body) { patient = null; render() }
        val origin = field(R.string.desk_ambulance_origin, body, pending?.value("p_origin").orEmpty(), max = 1000)
        val destination = field(R.string.desk_ambulance_destination, body, pending?.value("p_destination").orEmpty(), max = 1000)
        picker(R.string.desk_priority, listOf("normal" to getString(R.string.desk_normal), "urgente" to getString(R.string.desk_urgent)),
            priority, body) { priority = it }
        val contact = field(R.string.desk_ambulance_contact, body, pending?.value("p_contact") ?: name, max = 200)
        val phone = field(R.string.desk_phone, body, pending?.value("p_phone") ?: chosen.value("phone"), max = 50)
        val reason = field(R.string.desk_ambulance_reason, body, pending?.value("p_reason").orEmpty(), max = 4000)
        if (pending != null) {
            note(getString(R.string.desk_ambulance_pending), body)
            listOf(origin, destination, contact, phone, reason).forEach { it.isEnabled = false }
        }
        action(if (pending == null) R.string.desk_ambulance_send else R.string.desk_ambulance_retry, body) {
            val values = pending ?: runCatching {
                args("p_patient" to chosen.value("id"), "p_contact" to required(contact), "p_phone" to required(phone),
                    "p_origin" to required(origin), "p_destination" to required(destination), "p_reason" to required(reason),
                    "p_priority" to priority, "p_key" to UUID.randomUUID().toString())
            }.getOrElse { showError(DeskException(R.string.desk_invalid)); return@action }
            confirm(getString(R.string.desk_ambulance_confirm)) { send(values) }
        }
    }

    private fun send(values: JSONObject) {
        pending = values
        work({
            try { repo.rpc("request_medical_transport", values) }
            catch (e: DeskException) {
                // Rechazo del servidor (validación o permisos): no se confirmó nada; se descarta el envío.
                if (e.resource != R.string.desk_response) pending = null
                throw e
            }
        }) {
            pending = null; patient = null; priority = "normal"
            render()
            android.widget.Toast.makeText(this, R.string.desk_ambulance_sent, android.widget.Toast.LENGTH_LONG).show()
        }
    }

    private fun unitState(code: String) = getString(when (code) {
        "disponible" -> R.string.desk_ambulance_available; "en_servicio" -> R.string.desk_ambulance_in_service
        "en_mantenimiento" -> R.string.desk_ambulance_maintenance; else -> R.string.desk_unknown
    })
    private fun requestState(code: String) = getString(when (code) {
        "pendiente" -> R.string.desk_ambulance_state_pending; "autorizada" -> R.string.desk_ambulance_state_authorized
        "despachada" -> R.string.desk_ambulance_state_dispatched; "finalizada" -> R.string.desk_ambulance_state_finished
        "rechazada" -> R.string.desk_rejected; "cancelada" -> R.string.desk_cancelled; else -> R.string.desk_unknown
    })
}
