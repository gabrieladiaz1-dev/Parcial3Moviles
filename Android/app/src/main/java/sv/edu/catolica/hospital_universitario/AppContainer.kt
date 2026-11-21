package sv.edu.catolica.hospital_universitario

/**
 * ÚNICO lugar donde se crean los repositorios.
 * Para conectar la base de datos real: cambiar cada Fake...Repository(...) por la implementación real.
 */
object AppContainer {
    val doctorNativeRepository: DoctorNativeRepository by lazy { SupabaseDoctorNativeRepository() }
    val doctorNativeContext = DoctorNativeContext()
    val receptionDeskRepository: ReceptionDeskRepository by lazy { SupabaseReceptionDeskRepository() }
    val ioExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
    val authRepository: AuthRepository by lazy { SupabaseAuthRepository() }
    val receptionRepository: ReceptionRepository by lazy { SupabaseReceptionRepository() }

    val patientRepository: PatientRepository by lazy { SupabasePatientRepository() }

    // Repositorios heredados: las rutas nuevas de Doctor usan doctorNativeRepository.

    val appointmentRepository: EntryRepository by lazy {
        ReceptionEntryRepository(receptionRepository, ReceptionList.APPOINTMENTS)
    }
    val admissionRepository: EntryRepository by lazy {
        ReceptionEntryRepository(receptionRepository, ReceptionList.ADMISSIONS)
    }
    val turnRepository: EntryRepository by lazy {
        ReceptionEntryRepository(receptionRepository, ReceptionList.QUEUE)
    }
    val doctorAppointmentRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.doctorAppointments) }
    val labRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.doctorLab) }
    val prescriptionRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.doctorPrescriptions) }
    val nursingPatientRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.nursingPatients) }
    val nursingIndicationRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.nursingIndications) }
    val doctorScheduleRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.doctorSchedule) }
    val nursingTurnRepository: EntryRepository by lazy { FakeEntryRepository(Seeds.nursingTurns) }

    /** Paciente elegido para la consulta / preconsulta en curso (solo en memoria). */
    var selectedPatientId: String? = null
    var selectedPatientName: String? = null
        set(value) {
            field = value
            selectedPatientId = null
        }
}
