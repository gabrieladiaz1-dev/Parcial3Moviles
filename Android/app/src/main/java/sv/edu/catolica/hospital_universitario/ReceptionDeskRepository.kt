package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId

/** Contratos de src/lib/reception.ts, hospitalization.ts y WalkinReception del ADMIN. */
interface ReceptionDeskRepository {
    fun rows(table: String, query: String): List<JSONObject>
    fun rpc(name: String, args: JSONObject = JSONObject()): Any
    fun requestPage(state: String, offset: Int, newest: Boolean): Pair<List<JSONObject>, Boolean>
    fun counts(): Map<String, Long>
    fun patientByDui(dui: String): JSONObject?
    fun record(patientId: String): String?
    fun slots(specialty: Long, day: LocalDate, patientId: String?): List<JSONObject>
}

class DeskException(val resource: Int, val detail: String = "") : Exception()
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
internal fun JSONObject.value(key: String): String = if (isNull(key)) "" else optString(key)
internal fun args(vararg values: Pair<String, Any?>): JSONObject =
    JSONObject().apply { values.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }

class SupabaseReceptionDeskRepository : ReceptionDeskRepository {
    private val states = listOf("pendiente", "en_revision", "agendada", "rechazada", "cancelada")
    private val tables = setOf("appointment_requests", "specialties", "patients", "medical_records",
        "appointment_request_symptoms", "doctor_specialties", "appointments", "consulting_rooms",
        "ambulances", "ambulance_requests")
    private val functions = setOf("review_attention_request", "link_attention_patient", "create_attention_patient",
        "close_attention_request", "schedule_appointment", "get_medical_availability", "reception_doctor_day",
        "reception_agenda", "create_walkin_patient", "reception_walkin_attention",
        "admission_assessment_context", "reception_request_admission_assessment", "reception_hospital_inventory",
        "reception_admissions", "reception_hospital_detail", "reception_admission_availability",
        "reception_review_admission", "reception_resolve_admission", "release_bed", "complete_hospital_bed_cleaning",
        "request_medical_transport")

    override fun rows(table: String, query: String): List<JSONObject> {
        require(table in tables)
        return JSONArray(call("$table?$query").first).objects()
    }
    override fun rpc(name: String, args: JSONObject): Any {
        require(name in functions)
        val text = call("rpc/$name", args).first
        return if (text.isBlank()) JSONObject.NULL else JSONTokener(text).nextValue()
    }

    override fun requestPage(state: String, offset: Int, newest: Boolean): Pair<List<JSONObject>, Boolean> {
        val results = (if (state.isBlank()) states.take(2) else listOf(state)).map {
            require(it in states)
            rows("appointment_requests", "select=*&status=eq.$it&order=created_at.${if(newest) "desc" else "asc"},id.asc&limit=100&offset=$offset")
        }
        val sorted = results.flatten().sortedWith { a, b ->
            val priority = if (state.isBlank()) states.indexOf(a.value("status")) - states.indexOf(b.value("status")) else 0
            if (priority != 0) priority else {
                val time = a.value("created_at").compareTo(b.value("created_at")) * if (newest) -1 else 1
                if (time == 0) a.value("id").compareTo(b.value("id")) else time
            }
        }
        return sorted to results.any { it.size == 100 }
    }
    override fun counts(): Map<String, Long> = states.associateWith {
        call("appointment_requests?select=id&status=eq.$it&limit=1", count = true).second
            .substringAfterLast('/').toLongOrNull() ?: throw DeskException(R.string.desk_response)
    }
    override fun patientByDui(dui: String): JSONObject? {
        if (!Regex("^[0-9]{8}-[0-9]$").matches(dui)) throw DeskException(R.string.desk_dui_error)
        return rows("patients", "select=id,profile_id,first_name,last_name,patient_code,dui,birth_date,phone,email,city&dui=eq.$dui&limit=10").firstOrNull()
    }
    override fun record(patientId: String): String? =
        rows("medical_records", "select=record_code&patient_id=eq.$patientId&limit=2")
            .singleOrNull()?.value("record_code")?.ifBlank { null }

    override fun slots(specialty: Long, day: LocalDate, patientId: String?): List<JSONObject> {
        val doctors = rows("doctor_specialties", "select=doctor_id&specialty_id=eq.$specialty").map { it.value("doctor_id") }.toSet()
        val start = day.toString() + "T00:00:00-06:00"
        val end = day.plusDays(1).toString() + "T00:00:00-06:00"
        val slots = (rpc("get_medical_availability", args("p_from" to start, "p_until" to end)) as JSONArray).objects()
        val bookings = rows("appointments", "select=consulting_room_id,patient_id,starts_at,ends_at&starts_at=lt.${enc(end)}&ends_at=gt.${enc(start)}&status=in.(programada,confirmada,en_atencion)")
        fun instant(v: String) = java.time.OffsetDateTime.parse(v).toInstant()
        return slots.filter { s ->
            s.value("doctor_id") in doctors && bookings.none { b ->
                (b.value("consulting_room_id") == s.value("consulting_room_id") || b.value("patient_id") == patientId) &&
                    instant(b.value("starts_at")) < instant(s.value("ends_at")) && instant(b.value("ends_at")) > instant(s.value("starts_at"))
            }
        }
    }

    private fun call(path: String, body: JSONObject? = null, count: Boolean = false): Pair<String, String> {
        if (SessionManager.currentRole != SessionManager.Role.RECEPTION) throw AuthException(R.string.auth_access_denied)
        val token = SessionManager.requireAccessToken()
        val connection = URL("${BuildConfig.SUPABASE_URL}/rest/v1/$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15000
            connection.readTimeout = 20000
            connection.instanceFollowRedirects = false
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (count) connection.setRequestProperty("Prefer", "count=exact")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if(BuildConfig.DEBUG) android.util.Log.d("ReceptionDesk",
                "endpoint="+path.substringBefore('?')+" http="+status)
            if (status !in 200..299) {
                val error = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val code = runCatching { JSONObject(error).value("code") }.getOrDefault("")
                throw DeskException(when {
                    code in setOf("PGRST202", "PGRST204", "42883", "42P01", "42703") -> R.string.desk_contract_missing
                    code == "23P01" -> R.string.desk_slot_taken
                    code == "23505" -> R.string.desk_duplicate
                    code == "42501" || status == 401 || status == 403 -> R.string.auth_access_denied
                    code in setOf("22023", "P0001", "23514") -> R.string.desk_server_validation
                    else -> R.string.remote_operation_error
                }, when {
                    code in setOf("PGRST202", "PGRST204", "42883", "42P01", "42703") -> path.substringBefore('?')
                    code in setOf("P0001","22023") -> runCatching { JSONObject(error).value("message").take(2000) }.getOrDefault("")
                    else -> ""
                })
            }
            return connection.inputStream.bufferedReader().use { it.readText() } to connection.getHeaderField("Content-Range").orEmpty()
        } catch (e: java.io.IOException) {
            throw AuthException(R.string.auth_network_error)
        } finally { connection.disconnect() }
    }
    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")
}

object ReceptionClock {
    val zone: ZoneId = ZoneId.of("America/El_Salvador")
    fun today(): LocalDate = LocalDate.now(zone)
}
