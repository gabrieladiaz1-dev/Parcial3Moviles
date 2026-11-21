import Foundation
import Testing
@testable import HospitalUniversitario

/// Mismas reglas que HospitalCore.clinicalCards y HospitalCore.doctorClinical.notPerformed (hospital-core.js).
/// Pendientes de ejecutar en Xcode (no hay Mac en el entorno de desarrollo actual).
struct ClinicalCardRulesTests {
    private let id = UUID(uuidString: "00000000-0000-4000-8000-000000000071")!

    @Test func structuredPrescriptionGroupsEveryMedicineWithRealFields() {
        let rx = DoctorIssuedPrescription(id: id, code: "REC-0001", issued_at: "2026-11-10T15:25:00Z", status: "entregada", lines: ["texto antiguo"],
            doctor_name: "Ana Médica", items: [
                DoctorPrescriptionItem(name: "Acetaminofén", strength: "500 mg", dose: 1, dose_unit: "Tabletas", frequency_hours: 8, route: "oral", duration_days: 5, quantity: 15, observations: "Tomar con alimentos"),
                DoctorPrescriptionItem(name: "Amoxicilina", dose: 2.5, dose_unit: "ml", frequency_hours: 1, route: "oral", duration_days: 1, quantity: 1)])
        let view = ClinicalCardRules.prescription(rx)
        #expect(view.structured && view.count == 2)
        #expect(view.status == ClinicalBadge(label: "Entregada", tone: "done"))
        #expect(view.doctor == "Ana Médica")
        #expect(view.medicines[0] == ClinicalMedicine(name: "Acetaminofén", strength: "500 mg", dose: "1 Tabletas", frequency: "8 horas", route: "Oral",
                                                      duration: "5 días", quantity: "15", observations: "Tomar con alimentos"))
        #expect(view.medicines[1].dose == "2.5 ml" && view.medicines[1].frequency == "1 hora" && view.medicines[1].duration == "1 día")
        #expect(view.medicines[1].strength == nil && view.medicines[1].observations == nil, "Sin inventar concentración ni indicaciones")
    }

    @Test func legacyPrescriptionKeepsEachLineSeparately() {
        let rx = DoctorIssuedPrescription(id: id, code: "REC-ANTIGUA", issued_at: "2026-10-01T15:25:00Z", status: "pendiente", lines: ["Ibuprofeno 400 mg", " "])
        let view = ClinicalCardRules.prescription(rx)
        #expect(!view.structured && view.count == 1 && view.medicines[0].unstructured)
        #expect(view.status.label == "Pendiente de entrega")
        #expect(ClinicalCardRules.rxStatus("parcial").label == "Entrega parcial" && ClinicalCardRules.rxStatus("otro").label == "Estado no disponible")
    }

    @Test func labOrderShowsParametersOrOnlyTheObservation() {
        let detailed = ClinicalCardRules.labOrder(id: id, test: "Hemograma", patient: "Ana", record: "EXP", reason: "Control", status: "completado",
            orderedAt: "2026-11-10T15:20:00Z", publishedAt: "2026-11-11T10:00:00Z", completedAt: nil, summary: "Dentro de rango",
            parameters: [DoctorLabParameter(label: "Hemoglobina", value: "13.8", unit: "g/dL", reference: "12–16", observation: nil),
                         DoctorLabParameter(label: " ", value: "x", unit: nil, reference: nil, observation: nil)])
        #expect(detailed.published && detailed.status.label == "Resultado publicado")
        #expect(detailed.parameters == [ClinicalLabParameterView(label: "Hemoglobina", value: "13.8", unit: "g/dL", reference: "12–16", observation: nil)])
        let textOnly = ClinicalCardRules.labOrder(id: id, test: "Embarazo", patient: nil, record: nil, reason: nil, status: "completado",
            orderedAt: nil, publishedAt: "2026-11-11T10:00:00Z", completedAt: nil, summary: "Negativo", parameters: [])
        #expect(textOnly.parameters.isEmpty && textOnly.observation == "Negativo")
        let processing = ClinicalCardRules.labOrder(id: id, test: "Glucosa", patient: nil, record: nil, reason: nil, status: "en_proceso",
            orderedAt: nil, publishedAt: nil, completedAt: nil, summary: nil, parameters: [DoctorLabParameter(label: "Glucosa", value: "90", unit: nil, reference: nil, observation: nil)])
        #expect(!processing.published && processing.status.label == "En proceso" && processing.parameters.isEmpty, "Sin publicar no se muestran valores")
        #expect(ClinicalCardRules.labOrder(id: id, test: nil, patient: nil, record: nil, reason: nil, status: "pendiente", orderedAt: nil,
            publishedAt: nil, completedAt: nil, summary: nil, parameters: nil).status.label == "Pendiente")
    }

    @Test func notPerformedListsCancelledAndMissedMostRecentFirst() {
        func appointment(_ n: Int, _ status: String, _ day: Int, reason: String? = nil) -> DoctorAppointment {
            let uuid = UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", n))!
            return DoctorAppointment(id: uuid, patient_id: uuid, patient_name: "P\(n)", record_number: "E\(n)", phone: nil, ticket_number: nil,
                period: "[\"2026-11-\(day) 16:00:00+00\",\"2026-11-\(day) 16:30:00+00\")", status: status, encounter_id: nil, cancellation_reason: reason)
        }
        let list = [appointment(1, "cancelled", 18, reason: "Viaje"), appointment(2, "no_show", 20), appointment(3, "completed", 21), appointment(4, "cancelled", 19)]
        let rows = DoctorClinicalRules.notPerformed(list)
        #expect(rows.map(\.patient_name) == ["P2", "P4", "P1"])
        #expect(DoctorClinicalRules.notPerformedNote(rows[0]) == "La cita venció sin que se iniciara la consulta.")
        #expect(DoctorClinicalRules.notPerformedNote(rows[1]) == "Cancelada sin motivo registrado.")
        #expect(DoctorClinicalRules.notPerformedNote(rows[2]) == "Motivo de cancelación: Viaje")
    }
}
