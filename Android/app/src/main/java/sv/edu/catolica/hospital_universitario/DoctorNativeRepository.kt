package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Contrato iOS contracts/doctor-native-v1.json. La identidad médica la resuelve el servidor. */
interface DoctorNativeRepository {
    fun workspace(day: LocalDate): JSONObject
    fun chart(patient: String, from: String? = null, to: String? = null, query: String = ""): JSONObject
    fun patients(query: String, offset: Int): JSONObject
    fun call(operation: String, values: JSONObject = JSONObject()): Any
    /** Lecturas y escrituras REST con RLS del propio médico (ambulancia, avisos, horario, perfil, habitaciones). */
    fun rest(path: String, method: String = "GET", body: JSONObject? = null): Any
    fun changePassword(current: String, new: String)
}
class DoctorFailure(val resource: Int, val detail: String = "", val status: Int = 0) : Exception()

class SupabaseDoctorNativeRepository : DoctorNativeRepository {
    private val allowed = setOf("workspace", "chart", "patients", "patient_labs", "lab_catalog", "lab_orders", "labs", "start", "save",
        "prescribe", "finish", "admissions", "admission_request", "alerts", "schedule", "patient_hospitalizations",
        "rooms", "room_candidates", "assign_bed", "hospitalize", "discharge")
    private val restRoots = setOf("ambulance_requests", "ambulances", "notifications", "doctor_schedules", "staff_absences", "staff_shifts",
        "staff", "profiles", "rooms", "rpc/request_medical_transport", "planning_revision")

    /** Desde 2 días antes (consultas en atención o finalizadas tarde) hasta 14 después, como DoctorViewModel.refresh. */
    override fun workspace(day: LocalDate): JSONObject = call("workspace", args(
        "p_from" to day.minusDays(DoctorRules.AGENDA_LOOKBACK_DAYS).atStartOfDay(DoctorRules.zone).toOffsetDateTime().toString(),
        "p_to" to day.plusDays(DoctorRules.AGENDA_DAYS).atStartOfDay(DoctorRules.zone).toOffsetDateTime().toString())) as JSONObject
    override fun chart(patient: String, from: String?, to: String?, query: String): JSONObject =
        call("chart", args("p_patient" to patient, "p_from" to from, "p_to" to to, "p_query" to query)) as JSONObject
    override fun patients(query: String, offset: Int): JSONObject = call("patients", args("p_query" to query, "p_offset" to offset)) as JSONObject

    override fun call(operation: String, values: JSONObject): Any {
        require(operation in allowed)
        return send("rest/v1/rpc/doctor_native_$operation", "POST", values, operation)
    }
    override fun rest(path: String, method: String, body: JSONObject?): Any {
        require(restRoots.any { path.startsWith(it) })
        return send("rest/v1/$path", method, body, path.substringBefore('?'))
    }
    override fun changePassword(current: String, new: String) {
        val email = SessionManager.currentUser?.email ?: throw DoctorFailure(R.string.doc_access_error)
        // Verifica la contraseña actual sin reemplazar la sesión abierta y después actualiza Supabase Auth.
        AppContainer.authRepository.signIn(email, current)
        send("auth/v1/user", "PUT", JSONObject().put("password", new), "password")
    }

    private fun send(path: String, method: String, values: JSONObject?, operation: String): Any {
        if (SessionManager.currentRole != SessionManager.Role.DOCTOR) throw AuthException(R.string.auth_access_denied)
        val token = SessionManager.requireAccessToken()
        val connection = URL("${BuildConfig.SUPABASE_URL}/$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method // La implementación de Android (OkHttp) admite PATCH.
            connection.connectTimeout = 15000; connection.readTimeout = 25000; connection.instanceFollowRedirects = false
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (method == "PATCH") connection.setRequestProperty("Prefer", "return=minimal")
            if (values != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(values.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (BuildConfig.DEBUG) android.util.Log.d("DoctorNative", "operation=$operation http=$status")
            if (status !in 200..299) {
                val body = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val error = runCatching { JSONObject(body) }.getOrNull()
                val code = error?.value("code").orEmpty().ifBlank { error?.value("error_code").orEmpty() }
                throw DoctorFailure(when {
                    operation == "password" -> R.string.doc_password_failed
                    code == "PGRST202" || code == "42883" || code == "PGRST205" -> R.string.doc_contract_missing
                    code == "40001" || code == "23505" -> R.string.doc_version_conflict
                    code == "42501" || status == 401 || status == 403 -> R.string.doc_access_error
                    code in setOf("22023", "P0001", "23514", "22P02") -> R.string.doc_validation
                    else -> R.string.remote_operation_error
                }, when (code) {
                    "PGRST202", "42883", "PGRST205" -> operation
                    "22023", "P0001", "23514", "40001" -> error?.value("message")?.take(2000).orEmpty()
                    else -> ""
                }, status)
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return if (body.isBlank()) JSONObject.NULL else JSONTokener(body).nextValue()
        } catch (e: java.io.IOException) { throw AuthException(R.string.auth_network_error) }
        finally { connection.disconnect() }
    }
}

internal fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
internal fun JSONObject.strings(key: String): List<String> =
    optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() && it != "null" } }.orEmpty()
internal fun JSONObject.txt(key: String): String? = value(key).trim().ifBlank { null }?.takeIf { it != "null" }
internal fun JSONObject.list(key: String): List<JSONObject> = optJSONArray(key)?.objects().orEmpty()

/** Reglas clínicas: espejo de DoctorClinicalRules / DoctorRecordRules (Swift) y HospitalCore.doctorClinical (JS). */
object DoctorRules {
    val zone: ZoneId = ZoneId.of("America/El_Salvador")
    const val AGENDA_LOOKBACK_DAYS = 2L
    const val AGENDA_DAYS = 14L
    const val HISTORY_PAGE = 10
    val pendingStates = setOf("scheduled", "confirmed", "checked_in", "in_progress")
    val doseUnits = listOf("tableta", "cápsula", "mg", "g", "mcg", "ml", "gotas", "UI", "sobre", "aplicación", "inhalación")
    /** Minutos de anticipación para abrir la consulta: null = sin límite (modo de pruebas del 20 de noviembre). */
    val openingLeadMinutes: Long? = null

    data class Vital(val key: String, val label: Int, val unit: String, val integer: Boolean, val low: Double, val high: Double, val lowExclusive: Boolean)
    val vitals = listOf(
        Vital("weight_kg", R.string.dx_weight, "kg", false, 0.0, 1000.0, true),
        Vital("height_cm", R.string.dx_height, "cm", false, 0.0, 300.0, true),
        Vital("temperature_c", R.string.dx_temperature, "°C", false, 25.0, 50.0, false))
    val recordedVitals: List<Triple<String, Int, String>> = vitals.map { Triple(it.key, it.label, it.unit) } + listOf(
        Triple("systolic", R.string.doc_systolic, "mmHg"), Triple("diastolic", R.string.doc_diastolic, "mmHg"), Triple("heart_rate", R.string.doc_heart, "lpm"))

    fun statusLabel(status: String): Int = when (status) {
        "scheduled", "confirmed" -> R.string.dx_st_pending; "checked_in" -> R.string.dx_st_waiting; "in_progress" -> R.string.dx_st_in_consult
        "completed" -> R.string.dx_st_attended; "cancelled" -> R.string.dx_st_cancelled; "no_show" -> R.string.dx_st_no_show
        "rejected" -> R.string.dx_st_rejected; else -> R.string.dx_st_pending
    }
    fun genericStatus(value: String): Int = when (value) {
        "open", "in_progress" -> R.string.dx_st_in_consult; "closed", "completed" -> R.string.dx_g_finished; "draft" -> R.string.dx_g_draft
        "ordered" -> R.string.dx_g_issued; "checked_in" -> R.string.dx_g_checked_in; "confirmed", "scheduled" -> R.string.dx_g_programmed
        "cancelled" -> R.string.dx_st_cancelled; "pending", "pendiente" -> R.string.dx_st_pending; "en_proceso" -> R.string.dx_g_processing
        "completado" -> R.string.dx_g_completed; "entregada" -> R.string.dx_g_delivered; "anulada" -> R.string.dx_g_voided
        "no_show" -> R.string.dx_st_no_show; else -> R.string.dx_g_unknown
    }

    fun parse(value: String?): OffsetDateTime? = runCatching {
        val raw = value?.trim().orEmpty(); if (raw.isEmpty()) return null
        OffsetDateTime.parse(raw.replace(" ", "T").replace(Regex("([+-][0-9]{2})$"), "$1:00"))
    }.getOrNull()
    fun start(a: JSONObject): ZonedDateTime? = runCatching {
        val raw = a.value("period").drop(1).substringBefore(',').trim().trim('"')
        parse(raw)?.atZoneSameInstant(zone)
    }.getOrNull()
    fun finished(a: JSONObject): ZonedDateTime? = parse(a.txt("finished_at"))?.atZoneSameInstant(zone)
    fun finishedAt(a: JSONObject): ZonedDateTime? = finished(a) ?: start(a)
    fun local(value: String?): ZonedDateTime? = parse(value)?.atZoneSameInstant(zone)
    fun today(): LocalDate = LocalDate.now(zone)

    fun fold(text: String): String = java.text.Normalizer.normalize(text.lowercase(java.util.Locale.ROOT), java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").trim()
    fun matches(a: JSONObject, query: String): Boolean {
        val words = fold(query).split(" ").filter { it.isNotBlank() }
        if (words.isEmpty()) return true
        val hay = fold(listOf(a.value("patient_name"), a.value("patient_code"), a.value("record_number")).joinToString(" "))
        return words.all { hay.contains(it) }
    }
    fun pending(list: List<JSONObject>, day: LocalDate): List<JSONObject> {
        val isToday = day == today()
        return list.filter { a ->
            val d = start(a) ?: return@filter false
            if (a.value("status") !in pendingStates) return@filter false
            d.toLocalDate() == day || (isToday && a.value("status") == "in_progress" && d.toLocalDate().isBefore(day))
        }.sortedWith(compareBy<JSONObject>({ start(it)?.toInstant() }, { it.value("id") }))
    }
    fun finished(list: List<JSONObject>, day: LocalDate): List<JSONObject> =
        list.filter { it.value("status") == "completed" && finishedAt(it)?.toLocalDate() == day }
            .sortedWith(compareByDescending<JSONObject> { finishedAt(it)?.toInstant() }.thenByDescending { it.value("id") })
    fun closedWithoutCare(list: List<JSONObject>, day: LocalDate): List<JSONObject> =
        list.filter { it.value("status") in setOf("cancelled", "no_show") && start(it)?.toLocalDate() == day }.sortedBy { start(it)?.toInstant() }
    fun dayAppointments(list: List<JSONObject>, day: LocalDate) = list.filter { start(it)?.toLocalDate() == day }.sortedBy { start(it)?.toInstant() }
    /** Secciones Hoy/Próximas como DoctorClinicalRules.agenda. */
    fun upcomingAfterDay(list: List<JSONObject>, day: LocalDate): List<JSONObject> {
        val begin = day.atStartOfDay(zone); val end = begin.plusDays(1)
        return list.filter { it.value("status") !in setOf("completed", "cancelled", "no_show", "rejected") }
            .filter { val d = start(it) ?: return@filter false; !(d.isBefore(begin) && it.value("status") != "in_progress") }
            .sortedWith(compareBy<JSONObject>({ start(it)?.toInstant() }, { it.value("id") }))
            .let { all -> all.filter { (start(it)?.isBefore(end)) == true } + all.filter { (start(it)?.isBefore(end)) != true } }
    }

    fun sanitize(text: String, integer: Boolean): String {
        val out = StringBuilder(); var separator = false
        for (c in text) {
            if (c in '0'..'9') out.append(c)
            else if (!integer && !separator && (c == '.' || c == ',')) { out.append('.'); separator = true }
        }
        return out.toString().take(if (integer) 3 else 6)
    }
    fun number(text: String?): Double? = text?.takeIf { it.isNotBlank() }?.replace(',', '.')?.toDoubleOrNull()
    fun vitalIssues(values: JSONObject, ui: (Int, Array<Any>) -> String): Map<String, String> {
        val issues = linkedMapOf<String, String>()
        for (v in vitals) {
            val raw = values.value(v.key); if (raw.isBlank()) continue
            val n = number(raw)
            if (n == null || (v.integer && n != Math.rint(n))) { issues[v.key] = ui(R.string.dx_vital_invalid, arrayOf()); continue }
            val low = if (v.lowExclusive) n <= v.low else n < v.low
            if (low || n > v.high) {
                val lower = if (v.lowExclusive) ui(R.string.dx_vital_greater, arrayOf(v.low.toInt())) else ui(R.string.dx_vital_from, arrayOf(v.low.toInt()))
                issues[v.key] = ui(R.string.dx_vital_range, arrayOf(lower, v.high.toInt(), v.unit))
            }
        }
        return issues
    }
    fun bmi(values: JSONObject?): String? {
        values ?: return null
        val w = number(values.value("weight_kg")) ?: return null; val h = number(values.value("height_cm")) ?: return null
        if (w <= 0 || w > 1000 || h <= 0 || h > 300) return null
        val m = h / 100
        return String.format(java.util.Locale.US, "%.1f", w / (m * m))
    }
    fun initials(name: String): String = name.split(" ").filter { it.isNotBlank() }.take(2).mapNotNull { it.firstOrNull()?.toString() }.joinToString("").uppercase()
    fun finishedHistory(history: List<JSONObject>) = history.filter { it.value("status") == "closed" }
        .sortedWith(compareByDescending<JSONObject> { parse(it.value("started_at"))?.toInstant() }.thenByDescending { it.value("id") })
}

/** Borrador de la consulta (DoctorConsultationDraft). */
class DoctorDraft(var subjective: String = "", var objective: String = "", var assessment: String = "", var plan: String = "",
                  var diagnosis: String = "", var vitals: JSONObject = JSONObject()) {
    fun copy() = DoctorDraft(subjective, objective, assessment, plan, diagnosis, JSONObject(vitals.toString()))
    fun values(): JSONObject = args("subjective" to subjective, "objective" to objective, "assessment" to assessment, "plan" to plan,
        "diagnosis_code" to diagnosis, "vitals" to JSONObject().apply {
            vitals.keys().forEach { k -> val v = vitals.value(k).trim(); if (v.isNotEmpty()) put(k, v.replace(',', '.')) }
        })
    fun same(other: DoctorDraft?) = other != null && values().toString() == other.values().toString()
    val canSave get() = listOf(subjective, objective, assessment, plan).all { it.length <= 10000 } && diagnosis.length <= 50
    fun missing(): List<Int> = listOf(subjective to R.string.dx_f_symptoms, objective to R.string.dx_f_exploration,
        assessment to R.string.dx_f_diagnosis, plan to R.string.dx_f_plan).filter { it.first.isBlank() }.map { it.second }
    companion object {
        fun from(note: JSONObject) = DoctorDraft(note.value("subjective"), note.value("objective"), note.value("assessment"), note.value("plan"),
            note.value("diagnosis_code"), JSONObject((note.optJSONObject("vitals") ?: JSONObject()).toString()))
    }
}
data class DoctorPending(val operation: String, val values: JSONObject, val key: String, val label: String = "", val record: String = "", val reason: String = "", val count: Int = 0)

/**
 * Estado compartido del módulo (espejo de DoctorViewModel en iOS). Solo en RAM, separado por la identidad de sesión.
 * Nunca se guarda en disco.
 */
class DoctorNativeContext {
    private var identity: SessionManager.User? = null
    var day: LocalDate = DoctorRules.today()
    var statusFilter = "pending"
    /** La agenda pidió abrir la consulta al cambiar de pantalla (select + startConsultation). */
    var pendingStart = false
    var workspace: JSONObject? = null
    var selectedAppointmentId: String? = null
    var selectedPatient: JSONObject? = null
    var chart: JSONObject? = null
    var contextChart: JSONObject? = null
    var draft = DoctorDraft()
    var savedDraft: DoctorDraft? = null
    var draftInitialized = false
    var saveState = "idle"; var saveError = ""
    var conflict: JSONObject? = null
    var confirmation: String? = null
    var startKey = uuid(); var saveKey = uuid(); var rxKey = uuid()
    // Avisos
    var alerts: List<JSONObject> = emptyList(); var unread = 0; var alertsMore = false; var alertsError: String? = null
    var upcoming: List<JSONObject> = emptyList(); var notificationMessage: String? = null
    // Directorio y expediente
    var patientQuery = ""; var directory: List<JSONObject> = emptyList(); var directoryPage: JSONObject? = null; var directoryError: String? = null
    var lastDirectoryQuery: String? = null
    var patientLabs: List<JSONObject> = emptyList(); var patientLabPage: JSONObject? = null; var patientLabsError: String? = null
    var stays: Pair<JSONObject?, List<JSONObject>>? = null; var staysError: String? = null
    var historyQuery = ""; var filterDates = false; var historyFrom: LocalDate = DoctorRules.today(); var historyTo: LocalDate = DoctorRules.today()
    // Laboratorio
    var labCatalog: List<JSONObject> = emptyList(); var labCatalogError: String? = null
    var selectedLabs = linkedSetOf<Long>(); var labQuery = ""; var labCategory = "all"; var instructions = ""; var pendingLabs: DoctorPending? = null
    var ownLabs: List<JSONObject> = emptyList(); var ownLabPage: JSONObject? = null; var ownLabsError: String? = null
    // Receta
    var rxMedication: String? = null; var rxDose = ""; var rxUnit = ""; var rxFrequency = ""; var rxQuantity = ""; var rxDays = ""
    var rxRoute = "oral"; var rxInstructions = ""; var rxLines = JSONArray()
    // Ingresos
    var admissions: List<JSONObject> = emptyList(); var admissionsPage: JSONObject? = null; var admissionsError: String? = null
    var admissionForm = false; var admissionCategory = ""; var admissionPriority = "normal"; var admissionReason = ""; var admissionObservations = ""
    var pendingAdmission: DoctorPending? = null
    // Ambulancia
    var units: List<JSONObject> = emptyList(); var transports: List<JSONObject>? = null; var transportsError: String? = null
    var transportForm = false; var transportPriority = "normal"; var transportContact = ""; var transportPhone = ""
    var transportOrigin = ""; var transportDestination = ""; var transportReason = ""; var pendingTransport: DoctorPending? = null
    // Mi horario
    var scheduleWeek: LocalDate? = null; var week: DoctorWeek? = null; var weekError: Boolean = false; var staffId: String? = null

    fun bind() { if (identity !== SessionManager.currentUser) { clear(); identity = SessionManager.currentUser } }
    fun clear() {
        identity = null; day = DoctorRules.today(); statusFilter = "pending"; workspace = null
        alerts = emptyList(); unread = 0; alertsMore = false; alertsError = null; upcoming = emptyList(); notificationMessage = null
        patientQuery = ""; directory = emptyList(); directoryPage = null; directoryError = null; lastDirectoryQuery = null
        labCatalog = emptyList(); labCatalogError = null; ownLabs = emptyList(); ownLabPage = null; ownLabsError = null
        pendingLabs = null; selectedLabs.clear(); labQuery = ""; labCategory = "all"
        admissions = emptyList(); admissionsPage = null; admissionsError = null; resetAdmissionForm()
        units = emptyList(); transports = null; transportsError = null; resetTransportForm()
        scheduleWeek = null; week = null; weekError = false; staffId = null
        historyQuery = ""; filterDates = false
        select(null); confirmation = null
    }
    fun resetAdmissionForm() { admissionForm = false; admissionCategory = ""; admissionPriority = "normal"; admissionReason = ""; admissionObservations = ""; pendingAdmission = null }
    fun resetTransportForm() {
        transportForm = false; pendingTransport = null; transportPriority = "normal"
        transportContact = ""; transportPhone = ""; transportOrigin = ""; transportDestination = ""; transportReason = ""
    }
    fun clearPrescription() {
        rxKey = uuid(); rxMedication = null; rxDose = ""; rxUnit = ""; rxFrequency = ""; rxQuantity = ""; rxDays = ""; rxRoute = "oral"; rxInstructions = ""; rxLines = JSONArray()
    }

    val appointments: List<JSONObject> get() = workspace?.list("appointments").orEmpty()
    val selectedAppointment: JSONObject? get() = appointments.firstOrNull { it.value("id") == selectedAppointmentId }
    val patientId: String? get() = selectedPatient?.txt("id") ?: selectedAppointment?.txt("patient_id")
    val activeConsultation: JSONObject? get() {
        val encounter = selectedAppointment?.txt("encounter_id") ?: selectedPatient?.txt("active_encounter_id") ?: return null
        return contextChart?.list("history")?.firstOrNull { it.value("id") == encounter }
    }
    val canEdit: Boolean get() = activeConsultation?.value("status") == "open"
    val hasUnsavedChanges: Boolean get() = savedDraft != null && !draft.same(savedDraft)
    val medications: List<JSONObject> get() = workspace?.list("medications").orEmpty()

    fun select(appointment: String?) {
        selectedPatient = null; patientLabs = emptyList(); patientLabPage = null; patientLabsError = null; stays = null; staysError = null
        if (pendingLabs == null) selectedLabs.clear()
        selectedAppointmentId = appointment; chart = null; contextChart = null
        draft = DoctorDraft(); instructions = ""; confirmation = null
        startKey = uuid(); saveKey = uuid(); draftInitialized = false; savedDraft = null; saveState = "idle"; saveError = ""; conflict = null
        clearPrescription()
    }
    fun openPatient(patient: JSONObject) {
        val enc = patient.txt("active_encounter_id")
        val a = appointments.firstOrNull { enc != null && it.value("patient_id") == patient.value("id") && it.value("encounter_id") == enc }
        select(a?.value("id")); selectedPatient = patient
    }
    fun adoptAppointmentPatient() {
        if (selectedPatient != null) return
        val a = selectedAppointment ?: return
        val id = a.value("patient_id")
        selectedPatient = directory.firstOrNull { it.value("id") == id } ?: args("id" to id, "full_name" to a.value("patient_name"),
            "record_number" to a.value("record_number"), "dui" to chart?.optJSONObject("patient")?.txt("identification"),
            "email" to chart?.optJSONObject("patient")?.txt("email"), "phone" to a.txt("phone"),
            "birth_date" to chart?.optJSONObject("patient")?.txt("birth_date"), "age" to (if (a.has("age") && !a.isNull("age")) a.optInt("age") else null),
            "active_encounter_id" to a.txt("encounter_id"))
    }
    /** Al cargar el expediente sin filtros se inicializa el borrador desde la nota abierta. */
    fun applyChart(value: JSONObject, filtered: Boolean) {
        chart = value
        if (!filtered) {
            contextChart = value
            val note = activeConsultation
            if (!draftInitialized && note != null) { draft = DoctorDraft.from(note); savedDraft = draft.copy(); draftInitialized = true }
        }
    }
    fun finishBlockers(issues: Map<String, String>): List<Int> {
        val out = draft.missing().toMutableList<Int>().map { -it }.toMutableList()
        if (issues.isNotEmpty()) out.add(R.string.dx_block_vitals)
        if (rxLines.length() > 0) out.add(R.string.dx_block_rx)
        if (selectedLabs.isNotEmpty() || pendingLabs != null) out.add(R.string.dx_block_labs)
        if (conflict != null) out.add(R.string.dx_block_conflict)
        return out
    }
    val canIssueLabs: Boolean get() = pendingLabs != null || (canEdit && selectedLabs.isNotEmpty() && selectedLabs.size <= 30 &&
        selectedLabs.all { id -> labCatalog.any { it.optLong("id") == id } } && instructions.isNotBlank() && instructions.length <= 10000)
    val canRequestAdmission: Boolean get() = pendingAdmission != null || (patientId != null &&
        admissionsPage?.strings("categories")?.contains(admissionCategory) == true && admissionsPage?.strings("priorities")?.contains(admissionPriority) == true &&
        admissionReason.isNotBlank() && admissionReason.length <= 10000 && admissionObservations.length <= 10000)
    val canRequestTransport: Boolean get() {
        if (pendingTransport != null) return true
        fun filled(v: String, limit: Int) = v.trim().let { it.isNotEmpty() && it.length <= limit }
        return patientId != null && transportPriority in setOf("normal", "urgente") && filled(transportContact, 200) && filled(transportPhone, 50) &&
            filled(transportOrigin, 1000) && filled(transportDestination, 1000) && filled(transportReason, 4000)
    }
    fun prefillTransportContact() {
        if (transportContact.isEmpty()) (selectedPatient?.txt("full_name") ?: selectedAppointment?.txt("patient_name"))?.let { transportContact = it }
        if (transportPhone.isEmpty()) (selectedPatient?.txt("phone") ?: selectedAppointment?.txt("phone"))?.let { transportPhone = it }
    }
    companion object { fun uuid() = java.util.UUID.randomUUID().toString() }
}

/** Mi horario: port de HospitalCore.doctorWeek (hospital-core.js). */
data class DoctorWeek(val start: LocalDate, val end: LocalDate, val totalMinutes: Int, val days: List<Day>) {
    data class Block(val start: String, val end: String, val shift: String)
    data class Break(val start: String, val end: String, val kind: String, val label: String)
    data class Shift(val start: String, val end: String, val type: String)
    data class Absence(val reason: String, val allDay: Boolean, val start: String?, val end: String?)
    data class Day(val date: LocalDate, val weekday: Int, val today: Boolean, val blocks: List<Block>, val breaks: List<Break>,
                   val shifts: List<Shift>, val absences: List<Absence>, val minutes: Int, val free: Boolean)
    companion object {
        private val lunch = Regex("almuerzo|comida|lunch", RegexOption.IGNORE_CASE)
        fun weekStart(today: LocalDate = DoctorRules.today()): LocalDate = today.minusDays(((today.dayOfWeek.value + 6) % 7).toLong())
        private fun minutes(t: String): Int { val p = t.split(":"); return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0) }
        private fun clock(m: Int) = String.format(java.util.Locale.US, "%02d:%02d", m / 60, m % 60)
        private fun hm(t: ZonedDateTime) = String.format(java.util.Locale.US, "%02d:%02d", t.hour, t.minute)
        fun build(schedules: List<JSONObject>, absences: List<JSONObject>, shifts: List<JSONObject>, start: LocalDate, recurring: JSONObject?): DoctorWeek {
            val days = mutableListOf<Day>(); var total = 0
            for (i in 0 until 7) {
                val date = start.plusDays(i.toLong()); val weekday = date.dayOfWeek.value % 7
                val dayStart = date.atStartOfDay(DoctorRules.zone); val dayEnd = dayStart.plusDays(1)
                val blocks = schedules.filter { s ->
                    s.optBoolean("active", true) && s.optInt("weekday") == weekday &&
                        (s.txt("valid_from") == null || s.value("valid_from") <= date.toString()) && (s.txt("valid_until") == null || s.value("valid_until") >= date.toString())
                }.map { minutes(it.value("start_time")) to minutes(it.value("end_time")) }.toMutableList()
                recurring?.list("work")?.forEach { w ->
                    val a = DoctorRules.local(w.value("starts_at")) ?: return@forEach; val z = DoctorRules.local(w.value("ends_at")) ?: return@forEach
                    if (!(a.isBefore(dayEnd) && z.isAfter(dayStart))) return@forEach
                    val from = if (a.isBefore(dayStart)) 0 else minutes(hm(a)); val to = if (!z.isBefore(dayEnd)) 24 * 60 - 1 else minutes(hm(z))
                    if (to > from) blocks.add(from to to)
                }
                blocks.sortWith(compareBy({ it.first }, { it.second }))
                val merged = mutableListOf<IntArray>()
                blocks.forEach { b -> val last = merged.lastOrNull(); if (last != null && b.first <= last[1]) last[1] = maxOf(last[1], b.second) else merged.add(intArrayOf(b.first, b.second)) }
                val registered = recurring?.list("breaks").orEmpty().filter {
                    val a = DoctorRules.local(it.value("starts_at")); val z = DoctorRules.local(it.value("ends_at"))
                    a != null && z != null && a.isBefore(dayEnd) && z.isAfter(dayStart)
                }.map {
                    val reason = it.value("reason").replace(Regex("^Descanso:\\s*", RegexOption.IGNORE_CASE), "").trim()
                    val isLunch = lunch.containsMatchIn(reason)
                    Break(hm(DoctorRules.local(it.value("starts_at"))!!), hm(DoctorRules.local(it.value("ends_at"))!!), if (isLunch) "lunch" else "break",
                        if (isLunch) "" else reason)
                }.sortedBy { it.start }
                val breaks = registered.toMutableList()
                for (j in 1 until merged.size) {
                    val gs = clock(merged[j - 1][1]); val ge = clock(merged[j][0])
                    if (registered.none { it.start < ge && it.end > gs }) breaks.add(Break(gs, ge, "gap", ""))
                }
                breaks.sortBy { it.start }
                val dayShifts = shifts.filter {
                    val a = DoctorRules.local(it.value("starts_at")); val z = DoctorRules.local(it.value("ends_at"))
                    a != null && z != null && a.isBefore(dayEnd) && z.isAfter(dayStart) && it.value("status") !in setOf("cancelado", "cancelled")
                }.map {
                    val a = DoctorRules.local(it.value("starts_at"))!!; val z = DoctorRules.local(it.value("ends_at"))!!
                    Shift(hm(if (a.isBefore(dayStart)) dayStart else a), hm(if (z.isBefore(dayEnd.minusMinutes(1))) z else dayEnd.minusMinutes(1)), it.txt("shift_type") ?: "ordinario")
                }
                val source = recurring?.optJSONArray("absences")?.objects() ?: absences
                val dayAbsences = source.filter {
                    val a = DoctorRules.local(it.value("starts_at")); val z = DoctorRules.local(it.value("ends_at"))
                    it.optBoolean("active", true) && a != null && z != null && a.isBefore(dayEnd) && z.isAfter(dayStart)
                }.map {
                    val a = DoctorRules.local(it.value("starts_at"))!!; val z = DoctorRules.local(it.value("ends_at"))!!
                    val full = !a.isAfter(dayStart) && !z.isBefore(dayEnd)
                    Absence(it.value("reason"), full, if (full) null else hm(if (a.isBefore(dayStart)) dayStart else a),
                        if (full) null else hm(if (z.isBefore(dayEnd.minusMinutes(1))) z else dayEnd.minusMinutes(1)))
                }
                val mins = merged.sumOf { it[1] - it[0] }; total += mins
                days.add(Day(date, weekday, date == DoctorRules.today(), merged.map { Block(clock(it[0]), clock(it[1]), if (it[0] < 12 * 60) "morning" else "afternoon") },
                    breaks, dayShifts, dayAbsences, mins, merged.isEmpty() && dayShifts.isEmpty()))
            }
            return DoctorWeek(start, days[6].date, total, days)
        }
    }
}

/** Hospitalizaciones del paciente: port reducido de HospitalCore.hospitalizations.present. */
object DoctorStays {
    fun present(list: JSONArray?): Pair<JSONObject?, List<JSONObject>> {
        val all = (list?.objects().orEmpty()).filter { it.txt("id") != null && it.value("status") in setOf("asignado", "hospitalizado", "alta_medica", "cerrado") }
        val active = all.firstOrNull { it.value("status") in setOf("asignado", "hospitalizado") }
        return active to all.filter { it.value("status") !in setOf("asignado", "hospitalizado") }
    }
}
