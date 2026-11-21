package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.LocalDate
import java.time.Period
import java.util.Locale

/** Copia local de lectura. refresh/add/update realizan red y deben ejecutarse en segundo plano. */
class SupabasePatientRepository : PatientRepository {
    @Volatile private var patients: List<Patient> = emptyList()

    override fun clear() { patients = emptyList() }
    override fun getAll(): List<Patient> = patients
    override fun getById(id: String): Patient? = patients.firstOrNull { it.id == id }

    override fun search(query: String): List<Patient> {
        val normalized = normalize(query)
        return patients.filter {
            normalize(it.fullName).contains(normalized) || normalize(it.record).contains(normalized)
        }
    }

    override fun refresh() {
        val token = SessionManager.requireAccessToken()
        val rows = JSONArray(SupabaseClient.request(
            "rest/v1/patients?select=id,patient_code,first_name,last_name,phone,birth_date,dui,city," +
                "hospital_admissions(status),appointments(status)&order=first_name,id", token = token
        ))
        val loaded = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val first = row.getString("first_name")
            val last = row.getString("last_name")
            val birth = row.nullableString("birth_date")
            val admissions = row.optJSONArray("hospital_admissions") ?: JSONArray()
            val appointments = row.optJSONArray("appointments") ?: JSONArray()
            val hospitalized = (0 until admissions.length()).any {
                admissions.getJSONObject(it).getString("status") == "hospitalizado"
            }
            val inCare = (0 until appointments.length()).any {
                appointments.getJSONObject(it).getString("status") == "en_atencion"
            }
            Patient(
                id = row.getString("id"), fullName = "$first $last",
                record = row.getString("patient_code"),
                status = when {
                    hospitalized -> PatientStatus.HOSPITALIZED
                    inCare -> PatientStatus.IN_CARE
                    else -> PatientStatus.UNSPECIFIED
                },
                age = birth?.let { Period.between(LocalDate.parse(it), LocalDate.now()).years },
                phone = row.nullableString("phone").orEmpty(),
                firstName = first, lastName = last, birthDate = birth,
                dui = row.nullableString("dui"), city = row.nullableString("city")
            )
        }
        // Evita publicar datos de una sesión que se cerró durante la petición.
        if (runCatching { SessionManager.requireAccessToken() }.getOrNull() == token) patients = loaded
    }

    override fun add(patient: Patient): Patient {
        val token = SessionManager.requireAccessToken()
        val result = SupabaseClient.request(
            "rest/v1/rpc/create_walkin_patient", "POST",
            JSONObject().put("p_first", patient.firstName).put("p_last", patient.lastName)
                .put("p_dui", patient.dui ?: JSONObject.NULL)
                .put("p_phone", patient.phone.ifBlank { null } ?: JSONObject.NULL)
                .put("p_birth", patient.birthDate ?: JSONObject.NULL)
                .put("p_city", patient.city ?: JSONObject.NULL),
            token
        )
        val id = org.json.JSONTokener(result).nextValue() as String
        // No repetir la escritura si una recarga posterior falla.
        val created = patient.copy(id = id)
        if (runCatching { SessionManager.requireAccessToken() }.getOrNull() == token) {
            patients = patients + created
        }
        return created
    }

    override fun update(patient: Patient): Boolean {
        val token = SessionManager.requireAccessToken()
        val rows = JSONArray(SupabaseClient.request(
            "rest/v1/patients?id=eq.${patient.id}", "PATCH",
            JSONObject().put("first_name", patient.firstName).put("last_name", patient.lastName)
                .put("phone", patient.phone.ifBlank { null } ?: JSONObject.NULL)
                .put("birth_date", patient.birthDate ?: JSONObject.NULL)
                .put("dui", patient.dui ?: JSONObject.NULL)
                .put("city", patient.city ?: JSONObject.NULL),
            token
        ))
        if (rows.length() != 1) throw AuthException(R.string.patient_missing)
        if (runCatching { SessionManager.requireAccessToken() }.getOrNull() == token) {
            patients = patients.map { if (it.id == patient.id) patient else it }
        }
        return true
    }

    override fun delete(id: String): Boolean {
        // TODO: Definir el flujo de archivo/baja con las políticas del servidor.
        throw AuthException(R.string.patient_delete_unavailable)
    }

    private fun JSONObject.nullableString(key: String): String? =
        if (isNull(key)) null else getString(key)

    private fun normalize(value: String): String =
        Normalizer.normalize(value.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
}
