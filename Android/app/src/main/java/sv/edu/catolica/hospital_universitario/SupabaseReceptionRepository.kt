package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Repositorio de recepción; requiere llamadas en segundo plano. */
class SupabaseReceptionRepository : ReceptionRepository {
    private val zone = ZoneId.of("America/El_Salvador")
    private val ids = mutableMapOf<String, Long>()
    private fun localId(id: String): Long = synchronized(ids) { ids.getOrPut(id) { ids.size.toLong() + 1 } }

    private fun rows(path: String): List<JSONObject> {
        val token = SessionManager.requireAccessToken()
        val result = mutableListOf<JSONObject>()
        var offset = 0
        while (true) {
            val page = JSONArray(SupabaseClient.request("rest/v1/$path&limit=500&offset=$offset", token = token))
            for (i in 0 until page.length()) result.add(page.getJSONObject(i))
            if (page.length() < 500) return result
            offset += 500
        }
    }

    private fun dayFilter(field: String, day: LocalDate): String {
        val start = URLEncoder.encode(day.atStartOfDay(zone).toOffsetDateTime().toString(), "UTF-8")
        val end = URLEncoder.encode(day.plusDays(1).atStartOfDay(zone).toOffsetDateTime().toString(), "UTF-8")
        return "&$field=gte.$start&$field=lt.$end"
    }

    override fun summary(day: LocalDate): ReceptionSummary {
        val appointments = rows("appointments?select=status&order=id" + dayFilter("starts_at", day))
        val admissions = rows("hospital_admissions?select=id&order=id" + dayFilter("ordered_at", day))
        return ReceptionSummary(appointments.size,
            appointments.count { it.getString("status") in listOf("programada", "confirmada") },
            admissions.size, beds().count { it.state == "disponible" })
    }

    override fun appointments(day: LocalDate?): List<Entry> = rows(
        "appointments?select=id,patient_id,starts_at,status,queue_number,queue_date," +
            "patients(first_name,last_name),consulting_rooms(code)&order=starts_at,id" +
            (day?.let { dayFilter("starts_at", it) } ?: "")
    ).map { row ->
        val id = row.getString("id")
        Entry(id = localId(id), remoteId = id, patientId = row.getString("patient_id"),
            lead = time(row.getString("starts_at")), title = patientName(row),
            meta = listOf(date(row.getString("starts_at")),
                row.optJSONObject("consulting_rooms")?.optString("code").orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
            status = ReceptionStatuses.option(row.getString("status")),
            stateCode = row.getString("status"), queueNumber = row.getInt("queue_number"), icon = "▦")
    }

    override fun admissions(): List<Entry> = rows(
        "hospital_admissions?select=id,patient_id,status,requested_kind,medical_reason,ordered_at," +
            "patients(first_name,last_name)&order=ordered_at.desc,id"
    ).map { row ->
        val id = row.getString("id")
        Entry(id = localId(id), remoteId = id, patientId = row.getString("patient_id"),
            title = patientName(row),
            meta = listOf(date(row.getString("ordered_at")), row.getString("medical_reason")).joinToString(" · "),
            status = ReceptionStatuses.option(row.getString("status")),
            stateCode = row.getString("status"), roomKind = row.getString("requested_kind"))
    }

    override fun beds(): List<HospitalBed> = rows(
        "beds?select=id,code,state,rooms!inner(code,kind,active)&rooms.active=eq.true&order=code,id"
    ).map {
        val room = it.getJSONObject("rooms")
        HospitalBed(it.getString("id"), it.getString("code"), room.getString("code"),
            room.getString("kind"), it.getString("state"))
    }

    override fun availability(day: LocalDate): List<MedicalSlot> {
        val data = JSONArray(rpc("get_medical_availability", JSONObject()
            .put("p_from", day.atStartOfDay(zone).toOffsetDateTime().toString())
            .put("p_until", day.plusDays(1).atStartOfDay(zone).toOffsetDateTime().toString())))
        return (0 until data.length()).map {
            val r = data.getJSONObject(it)
            MedicalSlot(r.getString("doctor_id"), r.getString("doctor_name"),
                r.getString("consulting_room_id"), r.getString("room_code"),
                r.getString("starts_at"), r.getString("ends_at"))
        }
    }

    override fun schedule(patientId: String, slot: MedicalSlot): ScheduledAppointment {
        val value = rpc("schedule_appointment", JSONObject().put("p_patient", patientId).put("p_doctor", slot.doctorId)
            .put("p_room", slot.roomId).put("p_start", slot.startsAt).put("p_end", slot.endsAt))
        return ScheduledAppointment(org.json.JSONTokener(value).nextValue() as String, null, null)
    }
    override fun changeAppointment(id: String, state: String) {
        rpc("update_appointment_status", JSONObject().put("p_id", id).put("p_state", state))
    }
    override fun cancelAppointment(id: String, reason: String?) {
        rpc("cancel_appointment", JSONObject().put("p_id", id).put("p_reason", reason ?: JSONObject.NULL))
    }
    override fun assignBed(admissionId: String, bedId: String) {
        rpc("assign_bed", JSONObject().put("p_admission", admissionId).put("p_bed", bedId))
    }
    override fun releaseBed(admissionId: String) {
        rpc("release_bed", JSONObject().put("p_admission", admissionId))
    }
    private fun rpc(name: String, body: JSONObject): String =
        SupabaseClient.request("rest/v1/rpc/$name", "POST", body, SessionManager.requireAccessToken())
    private fun patientName(row: JSONObject): String = row.optJSONObject("patients")?.let {
        listOf(it.getString("first_name"), it.getString("last_name")).joinToString(" ")
    }.orEmpty()
    private fun time(value: String): String = OffsetDateTime.parse(value).atZoneSameInstant(zone)
        .format(DateTimeFormatter.ofPattern("hh:mm a", java.util.Locale.US))
        .lowercase(java.util.Locale.US)
    private fun date(value: String): String = OffsetDateTime.parse(value).atZoneSameInstant(zone)
        .format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
}
