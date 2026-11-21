import Foundation

/// Medicamento de una receta del historial del médico (doctor_native_chart → prescriptions[].items,
/// supabase/medico-historial-detallado.sql). Columnas reales de prescription_items y medications.
struct DoctorPrescriptionItem: Codable, Hashable, Sendable {
    let name: String?
    var strength: String? = nil
    var presentation: String? = nil
    var dose: Double? = nil
    var dose_unit: String? = nil
    var frequency_hours: Int? = nil
    var route: String? = nil
    var duration_days: Int? = nil
    var quantity: Int? = nil
    var observations: String? = nil
}

/// Medicamento listo para mostrar (mismos textos que HospitalCore.prescriptionLine). nil = no registrado.
struct ClinicalMedicine: Hashable, Identifiable {
    var id: String { [name, strength, dose, frequency, route, duration, quantity, observations].map { $0 ?? "-" }.joined(separator: "|") }
    let name: String
    var strength: String? = nil
    var presentation: String? = nil
    var dose: String? = nil
    var frequency: String? = nil
    var route: String? = nil
    var duration: String? = nil
    var quantity: String? = nil
    var observations: String? = nil
    /// Línea del formato anterior del servidor (sin items): se muestra tal cual, sin inventar campos.
    var unstructured = false
}

struct ClinicalBadge: Hashable { let label: String; let tone: String }

struct ClinicalPrescriptionView: Identifiable {
    let id: UUID
    let code: String
    let issuedAt: String?
    let doctor: String?
    let status: ClinicalBadge
    let medicines: [ClinicalMedicine]
    let structured: Bool
    var count: Int { medicines.count }
}

struct ClinicalLabParameterView: Hashable {
    let label: String
    let value: String?
    let unit: String?
    let reference: String?
    let observation: String?
}

struct ClinicalLabOrderView: Identifiable {
    let id: UUID
    let test: String
    let patient: String?
    let record: String?
    let reason: String?
    let status: ClinicalBadge
    let published: Bool
    let requestedAt: String?
    let publishedAt: String?
    let completedAt: String?
    let observation: String?
    let parameters: [ClinicalLabParameterView]
}

/// Presentadores compartidos por paciente y médico. Espejo exacto de HospitalCore.clinicalCards (Shared/hospital-core.js).
enum ClinicalCardRules {
    private static func text(_ value: String?) -> String? {
        let clean = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return clean.isEmpty ? nil : clean
    }
    private static func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }
    private static func number(_ value: Double) -> String {
        let format = NumberFormatter(); format.locale = Locale(identifier: "en_US_POSIX")
        format.minimumFractionDigits = 0; format.maximumFractionDigits = 6; format.usesGroupingSeparator = false
        return format.string(from: NSNumber(value: value)) ?? String(value)
    }

    static func rxStatus(_ status: String?) -> ClinicalBadge {
        switch status {
        case "pendiente": return .init(label: "Pendiente de entrega", tone: "pending")
        case "entregada": return .init(label: "Entregada", tone: "done")
        case "parcial": return .init(label: "Entrega parcial", tone: "partial")
        case "anulada": return .init(label: "Anulada", tone: "closed")
        default: return .init(label: "Estado no disponible", tone: "unknown")
        }
    }

    /// Mismo formato que HospitalCore.prescriptionLine: «1 Tabletas», «8 horas», «Oral», «5 días», «15».
    static func medicine(_ item: DoctorPrescriptionItem) -> ClinicalMedicine {
        let route = text(item.route).map { $0.prefix(1).uppercased() + $0.dropFirst() }
        let dose = item.dose.map { value -> String in text(item.dose_unit).map { "\(number(value)) \($0)" } ?? number(value) }
        return ClinicalMedicine(name: text(item.name) ?? "Medicamento", strength: text(item.strength), presentation: text(item.presentation), dose: dose,
                                frequency: item.frequency_hours.map { plural($0, "hora", "horas") }, route: route,
                                duration: item.duration_days.map { plural($0, "día", "días") }, quantity: item.quantity.map(String.init),
                                observations: text(item.observations))
    }

    /// Receta del historial del médico. Con items: un medicamento por fila; sin ellos, cada línea registrada por separado.
    static func prescription(_ rx: DoctorIssuedPrescription) -> ClinicalPrescriptionView {
        let medicines: [ClinicalMedicine]
        if let items = rx.items { medicines = items.map(medicine) }
        else { medicines = rx.lines.compactMap { text($0) }.map { ClinicalMedicine(name: $0, unstructured: true) } }
        return .init(id: rx.id, code: text(rx.code) ?? "Receta", issuedAt: rx.issued_at, doctor: text(rx.doctor_name),
                     status: rxStatus(rx.status), medicines: medicines, structured: rx.items != nil)
    }

    private static let labStates: [String: ClinicalBadge] = [
        "pendiente": .init(label: "Pendiente", tone: "pending"), "en_proceso": .init(label: "En proceso", tone: "processing"),
        "completado": .init(label: "Completado · en validación", tone: "processing"), "anulada": .init(label: "Anulada", tone: "closed"),
        "cancelada": .init(label: "Cancelada", tone: "closed")]

    /// Orden de laboratorio (native_mobile_lab_page): solo trae resultado si está validado y publicado.
    static func labOrder(id: UUID, test: String?, patient: String?, record: String?, reason: String?, status: String, orderedAt: String?,
                         publishedAt: String?, completedAt: String?, summary: String?, parameters: [DoctorLabParameter]?) -> ClinicalLabOrderView {
        let published = publishedAt != nil || text(summary) != nil
        let params = (parameters ?? []).compactMap { p -> ClinicalLabParameterView? in
            guard let label = text(p.label) else { return nil }
            return .init(label: label, value: text(p.value), unit: text(p.unit), reference: text(p.reference), observation: text(p.observation))
        }
        let badge: ClinicalBadge = published ? ClinicalBadge(label: "Resultado publicado", tone: "done")
            : (labStates[status] ?? ClinicalBadge(label: "Estado no disponible", tone: "unknown"))
        return .init(id: id, test: text(test) ?? "Examen", patient: text(patient), record: text(record), reason: text(reason),
                     status: badge,
                     published: published, requestedAt: orderedAt, publishedAt: publishedAt, completedAt: completedAt,
                     observation: published ? text(summary) : nil, parameters: published ? params : [])
    }
    static func labOrder(_ lab: DoctorPatientLab) -> ClinicalLabOrderView {
        labOrder(id: lab.id, test: lab.test_name, patient: lab.patient_name, record: lab.record_number, reason: lab.reason, status: lab.status,
                 orderedAt: lab.ordered_at, publishedAt: lab.published_at, completedAt: lab.completed_at, summary: lab.result_summary, parameters: lab.parameters)
    }
}
