import SwiftUI

struct PatientPrescriptionMedicine: Codable {
    let name: String
    let dose: String
    let frequency: String
    let route: String
    let duration: String
    let quantity: String
    let observations: String
    var strength: String? = nil
}
struct PatientPrescriptionRecord: Identifiable, Codable {
    let id: String
    let issuedAt: String
    let dateLabel: String
    let pickup: String
    let medicines: [PatientPrescriptionMedicine]
    static let missing = "No hay datos reales"
    static let examples: [Self] = [
        .init(id: "rx-demo-1", issuedAt: "2026-10-30T09:00:00-06:00", dateLabel: "30 oct 2026", pickup: "Pendiente", medicines: [
            .init(name: "MEDICAMENTO DE EJEMPLO", dose: "1 unidad", frequency: "24 horas", route: "Oral", duration: "5 días", quantity: "5 unidades", observations: "Ejemplo de receta pendiente de retirar.")]),
        .init(id: "rx-demo-2", issuedAt: "2026-10-01T14:25:00-06:00", dateLabel: "1 oct 2026", pickup: "Retirada", medicines: [
            .init(name: "CLARITROMICINA 500 MG / TABLETA", dose: "1 tableta", frequency: "12 horas", route: "Oral", duration: "10 días", quantity: "20 tabletas", observations: "Datos ilustrativos de la referencia visual.")])
    ]
    static func from(_ item: MobileItem) -> Self {
        let state = item.details.first { $0.label.localizedCaseInsensitiveCompare("Estado de retiro") == .orderedSame }?.value.lowercased() ?? item.status.lowercased()
        let normalized = state.trimmingCharacters(in: .whitespacesAndNewlines)
        let pickup = ["retirada", "dispensed", "collected", "withdrawn"].contains(normalized) ? "Retirada" : ["pendiente", "pickup_pending", "pending"].contains(normalized) ? "Pendiente" : "Retiro por confirmar"
        let format = DateFormatter(); format.locale = Locale(identifier: "es_GT"); format.timeZone = TimeZone(identifier: "America/Guatemala"); format.dateFormat = "d MMM yyyy"
        // Campos reales de cada medicamento (paridad con HospitalPatientPrescriptions.fromItems en web-preview).
        func real(_ value: String?) -> String? { let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""; return text.isEmpty ? nil : text }
        let lines = (item.medicines ?? []).map {
            PatientPrescriptionMedicine(name: real($0.name) ?? "Medicamento", dose: real($0.dose) ?? missing, frequency: real($0.frequency) ?? missing, route: real($0.route) ?? missing,
                duration: real($0.duration) ?? missing, quantity: real($0.quantity) ?? missing, observations: real($0.observations) ?? "Sin observaciones", strength: real($0.strength))
        }
        let dateLabel = DoctorDate.parse(item.event_at).map { format.string(from: $0) } ?? missing
        if !lines.isEmpty { return .init(id: item.id.uuidString, issuedAt: item.event_at, dateLabel: dateLabel, pickup: pickup, medicines: lines) }
        let rows = item.details.filter { $0.label.localizedCaseInsensitiveCompare("Estado de retiro") != .orderedSame }.map {
            PatientPrescriptionMedicine(name: $0.label, dose: missing, frequency: missing, route: missing, duration: missing, quantity: missing, observations: $0.value.isEmpty ? missing : $0.value)
        }
        return .init(id: item.id.uuidString, issuedAt: item.event_at, dateLabel: DoctorDate.parse(item.event_at).map { format.string(from: $0) } ?? missing,
            pickup: pickup, medicines: rows.isEmpty ? [.init(name: item.title, dose: missing, frequency: missing, route: missing, duration: missing, quantity: missing, observations: item.subtitle ?? missing)] : rows)
    }
}
struct PatientPrescriptionsView: View {
    let records: [PatientPrescriptionRecord]
    let demonstration: Bool
    let search: String
    var loading = false
    var error: String? = nil
    var hasMore = false
    var retry: () -> Void = {}
    var loadMore: () -> Void = {}
    private var filtered: [PatientPrescriptionRecord] {
        records.filter { record in search.isEmpty || (record.dateLabel + " " + record.pickup + " " + record.medicines.map { $0.name + " " + $0.observations }.joined(separator: " ")).localizedStandardContains(search) }
            .sorted { (DoctorDate.parse($0.issuedAt) ?? .distantPast) > (DoctorDate.parse($1.issuedAt) ?? .distantPast) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Mis recetas").font(.system(size: 22, weight: .bold)).foregroundStyle(HospitalTheme.ink)
            if demonstration { Text("Recetas de ejemplo · No corresponden a una prescripción real").font(.caption).foregroundStyle(HospitalTheme.secondary) }
            if loading { ProgressView("Cargando tus recetas…") }
            if let error { Text(error).font(.footnote); Button("Reintentar", action: retry) }
            if filtered.isEmpty && !loading && error == nil { HospitalCard { Text("No tienes recetas registradas.").font(.subheadline); Text("Tus recetas aparecerán aquí cuando estén disponibles.").font(.footnote).foregroundStyle(HospitalTheme.secondary) } }
            ForEach(filtered) { record in
                Text(record.dateLabel).font(.subheadline.weight(.semibold)).foregroundStyle(HospitalTheme.secondary)
                // Misma tarjeta de medicamento que ve el médico (ClinicalMedicineCard).
                ForEach(Array(record.medicines.enumerated()), id: \.offset) { _, medicine in
                    ClinicalMedicineCard(medicine: ClinicalMedicine(name: medicine.name, strength: medicine.strength, dose: medicine.dose, frequency: medicine.frequency,
                                                                    route: medicine.route, duration: medicine.duration, quantity: medicine.quantity, observations: medicine.observations),
                                         state: record.pickup,
                                         stateBackground: record.pickup == "Retirada" ? HospitalTheme.green : record.pickup == "Pendiente" ? Color(red: 1, green: 0.95, blue: 0.85) : HospitalTheme.rose)
                }
            }
            if hasMore { Button("Cargar más", action: loadMore).disabled(loading) }
        }
    }
}
#Preview("Recetas del paciente") { ScrollView { PatientPrescriptionsView(records: PatientPrescriptionRecord.examples, demonstration: true, search: "").padding(17) }.background(HospitalTheme.background) }
