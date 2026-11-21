import Foundation

/// Solicitud de ambulancia tal como la devuelve `my_ambulance_context` (supabase/ambulancia-paciente.sql).
/// Solo datos propios del paciente: sin personal, notas internas de cierre ni solicitudes ajenas.
struct AmbulanceRequest: Decodable, Identifiable, Equatable {
    let id: UUID
    let status: String
    let requested_at: String
    var updated_at: String? = nil
    var contact_phone: String? = nil
    var alternate_phone: String? = nil
    var pickup_location: String? = nil
    var pickup_reference: String? = nil
    var pickup_latitude: Double? = nil
    var pickup_longitude: Double? = nil
    var pickup_accuracy_m: Double? = nil
    var reason: String? = nil
    var situation: String? = nil
    var pickup_notes: String? = nil
    var destination: String? = nil
    var decision_reason: String? = nil
    var assigned_at: String? = nil
    var departed_at: String? = nil
    var arrived_at: String? = nil
    var completed_at: String? = nil
    var unit_code: String? = nil
}

struct AmbulanceContext: Decodable, Equatable {
    struct Person: Decodable, Equatable { let full_name: String?; let phone: String? }
    let person: Person
    let unit_available: Bool
    let requests: [AmbulanceRequest]
    var server_time: String? = nil
}

/// Borrador del formulario. La identidad no forma parte de él: el servidor la toma de la sesión.
struct AmbulanceDraft: Equatable {
    var phone = ""
    var alternatePhone = ""
    var pickup = ""
    var reference = ""
    var reason = ""
    var situation = ""
    var notes = ""
    var latitude: Double?
    var longitude: Double?
    var accuracy: Double?
}

struct AmbulanceStage: Equatable {
    let key: String
    let label: String
    let title: String
    let message: String
    let step: Int
    let active: Bool
    let cancellable: Bool
}

struct AmbulanceTimelineStep: Equatable, Identifiable {
    let key: String
    let label: String
    let at: String?
    var id: String { key }
}

/// Reglas de «Solicitar ambulancia». Espejo exacto de `HospitalCore.ambulance` (Shared/hospital-core.js); los textos se comparan
/// en scripts/test-patient-ambulance.mjs. El cliente solo valida y presenta: el servidor vuelve a validar, registra la solicitud
/// como pendiente y solo administración autoriza, asigna y despacha la única ambulancia.
enum AmbulanceRules {
    /// Número oficial de emergencias: sin configurar. No se inventa; sin número no se muestra botón de llamada.
    static let emergencyPhone: String? = nil
    static let warning = "Si existe peligro inmediato para la vida, llama directamente a los servicios de emergencia. Enviar esta solicitud no garantiza una respuesta inmediata."
    static let unitBusyNote = "En este momento la ambulancia del hospital está ocupada o en mantenimiento. Puedes enviar tu solicitud: quedará pendiente de revisión y el hospital te informará."
    static let locationDenied = "No autorizaste la ubicación. Puedes escribir la dirección manualmente."
    static let locationFailed = "No se pudo obtener la ubicación. Escribe la dirección manualmente."
    static let openStates: Set<String> = ["pendiente", "autorizada", "despachada"]
    static let cancellableStates: Set<String> = ["pendiente", "autorizada"]

    private static let stages: [String: (label: String, title: String, message: String, step: Int)] = [
        "pendiente": ("Pendiente", "Solicitud recibida", "Tu solicitud fue enviada al hospital y está pendiente de revisión.", 1),
        "en_revision": ("En revisión", "Solicitud en revisión", "El hospital revisó tu solicitud y está gestionando la asignación. Todavía no hay una ambulancia asignada.", 1),
        "asignada": ("Asignada", "Ambulancia asignada", "El hospital ha asignado una ambulancia a tu solicitud.", 2),
        "en_camino": ("En camino", "Ambulancia en camino", "La ambulancia ha salido para atender tu solicitud.", 3),
        "en_atencion": ("En atención", "Ambulancia en el lugar", "El equipo de la ambulancia registró su llegada y está atendiendo tu solicitud.", 4),
        "finalizada": ("Finalizada", "Servicio finalizado", "El servicio de ambulancia de esta solicitud ha finalizado.", 5),
        "cancelada": ("Cancelada", "Solicitud cancelada", "Esta solicitud fue cancelada.", 0),
        "rechazada": ("Rechazada", "Solicitud no atendida", "El hospital no puede atender esta solicitud.", 0)
    ]
    private static let unknown = (label: "Estado no disponible", title: "Estado no disponible",
                                  message: "No pudimos interpretar el estado de esta solicitud. Actualiza o comunícate con el hospital.", step: 0)

    private static func text(_ value: String?) -> String { (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    static func phoneOK(_ value: String) -> Bool {
        let s = text(value)
        let digits = s.unicodeScalars.filter { ("0"..."9").contains($0) }.count
        return s.count <= 30 && s.range(of: "^\\+?[0-9][0-9 ()-]{6,22}[0-9]$", options: .regularExpression) != nil && (8...15).contains(digits)
    }

    static func validate(_ draft: AmbulanceDraft) -> (field: String, message: String)? {
        let pickup = text(draft.pickup), reason = text(draft.reason)
        if !phoneOK(draft.phone) { return ("phone", "Escribe un teléfono de contacto válido (8 a 15 dígitos).") }
        if !text(draft.alternatePhone).isEmpty && !phoneOK(draft.alternatePhone) { return ("alternatePhone", "El teléfono alternativo no es válido (8 a 15 dígitos).") }
        if pickup.count < 5 || pickup.count > 1000 { return ("pickup", "Escribe la dirección de recogida (entre 5 y 1000 caracteres).") }
        if reason.count < 3 || reason.count > 500 { return ("reason", "Escribe el motivo de la solicitud (entre 3 y 500 caracteres).") }
        if text(draft.reference).count > 500 || text(draft.situation).count > 2000 || text(draft.notes).count > 1000 { return ("text", "El texto supera la longitud permitida.") }
        let invalidLocation: Bool = {
            if (draft.latitude == nil) != (draft.longitude == nil) { return true }
            if let lat = draft.latitude, let lon = draft.longitude, !lat.isFinite || !lon.isFinite || abs(lat) > 90 || abs(lon) > 180 { return true }
            if let accuracy = draft.accuracy, draft.latitude == nil || !accuracy.isFinite || accuracy < 0 || accuracy > 100_000 { return true }
            return false
        }()
        if invalidLocation { return ("location", "La ubicación compartida no es válida. Vuelve a obtenerla o escribe solo la dirección.") }
        return nil
    }

    private static func round(_ value: Double, _ digits: Int) -> Double {
        let factor = pow(10.0, Double(digits)); return (value * factor).rounded() / factor
    }

    /// Parámetros de `submit_my_ambulance_request`. Sin identidad, prioridad, destino ni fecha: los fija el servidor.
    static func submission(_ draft: AmbulanceDraft, key: UUID) -> [String: Any] {
        func optional(_ value: String) -> Any {
            let clean = text(value)
            if clean.isEmpty { return NSNull() }
            return clean
        }
        var latitude: Any = NSNull(), longitude: Any = NSNull(), accuracy: Any = NSNull()
        if let lat = draft.latitude, let lon = draft.longitude {
            latitude = round(lat, 6); longitude = round(lon, 6)
            if let value = draft.accuracy { accuracy = round(value, 1) }
        }
        return ["p_key": key.uuidString.lowercased(), "p_phone": text(draft.phone), "p_pickup": text(draft.pickup), "p_reason": text(draft.reason),
                "p_reference": optional(draft.reference), "p_situation": optional(draft.situation), "p_notes": optional(draft.notes),
                "p_alternate_phone": optional(draft.alternatePhone), "p_latitude": latitude, "p_longitude": longitude, "p_accuracy": accuracy]
    }

    static func cancelProblem(_ reason: String?) -> String? {
        let r = text(reason)
        return r.count < 3 || r.count > 500 ? "Indica el motivo de la cancelación (entre 3 y 500 caracteres)." : nil
    }

    private static func stageKey(_ row: AmbulanceRequest) -> String? {
        if row.status == "despachada" { return row.arrived_at != nil ? "en_atencion" : row.departed_at != nil ? "en_camino" : "asignada" }
        if row.status == "autorizada" { return "en_revision" }
        return stages[row.status] == nil ? nil : row.status
    }

    static func stage(_ row: AmbulanceRequest) -> AmbulanceStage {
        let key = stageKey(row)
        let s = key.flatMap { stages[$0] } ?? unknown
        return AmbulanceStage(key: key ?? "desconocido", label: s.label, title: s.title, message: s.message, step: s.step,
                              active: openStates.contains(row.status), cancellable: cancellableStates.contains(row.status))
    }

    /// Número visible de la solicitud: «SA-» y los 8 primeros caracteres del identificador.
    static func code(_ id: UUID) -> String { "SA-" + String(id.uuidString.replacingOccurrences(of: "-", with: "").prefix(8)).uppercased() }

    /// Solo horas registradas por el servidor; un paso sin hora queda pendiente (nunca se estima).
    static func timeline(_ row: AmbulanceRequest) -> [AmbulanceTimelineStep] {
        let steps = [AmbulanceTimelineStep(key: "enviada", label: "Solicitud enviada", at: row.requested_at),
                     AmbulanceTimelineStep(key: "asignada", label: "Ambulancia asignada", at: row.assigned_at),
                     AmbulanceTimelineStep(key: "en_camino", label: "En camino", at: row.departed_at),
                     AmbulanceTimelineStep(key: "en_atencion", label: "En atención", at: row.arrived_at),
                     AmbulanceTimelineStep(key: "finalizada", label: "Servicio finalizado", at: row.status == "finalizada" ? row.completed_at : nil)]
        let final = row.status == "cancelada" ? "Cancelada" : row.status == "rechazada" ? "Rechazada" : nil
        guard let final else { return steps }
        return steps.filter { $0.at != nil } + [AmbulanceTimelineStep(key: row.status, label: final, at: row.updated_at)]
    }

    static func split(_ rows: [AmbulanceRequest]) -> (active: AmbulanceRequest?, previous: [AmbulanceRequest]) {
        let list = rows.sorted { $0.requested_at > $1.requested_at }
        let active = list.first { openStates.contains($0.status) }
        return (active, list.filter { $0.id != active?.id })
    }
}
