package sv.edu.catolica.hospital_universitario

import java.time.LocalDate

/** Operaciones de recepción. Todas las operaciones consultan el servidor fuera del hilo principal. */
interface ReceptionRepository {
    fun summary(day: LocalDate): ReceptionSummary
    fun appointments(day: LocalDate? = null): List<Entry>
    fun admissions(): List<Entry>
    fun beds(): List<HospitalBed>
    fun availability(day: LocalDate): List<MedicalSlot>
    fun schedule(patientId: String, slot: MedicalSlot): ScheduledAppointment
    fun changeAppointment(id: String, state: String)
    fun cancelAppointment(id: String, reason: String?)
    fun assignBed(admissionId: String, bedId: String)
    fun releaseBed(admissionId: String)
}

data class ScheduledAppointment(val id: String, val queueNumber: Int?, val queueDate: String?)

data class ReceptionSummary(val appointments: Int, val waiting: Int?, val admissions: Int, val freeBeds: Int)
data class HospitalBed(val id: String, val code: String, val room: String, val kind: String, val state: String)
data class MedicalSlot(
    val doctorId: String, val doctorName: String, val roomId: String,
    val roomCode: String, val startsAt: String, val endsAt: String
)
