import Foundation
import Combine
import Supabase

/// Acceso a Supabase para «Solicitar ambulancia». Protocolo para poder probar el modelo sin red (AmbulanceRulesTests).
@MainActor protocol AmbulanceServing {
    func context() async throws -> AmbulanceContext
    func submit(_ parameters: [String: Any]) async throws
    func cancel(request: UUID, reason: String) async throws
    /// Señal de cambio de las solicitudes propias. No transporta datos: ante cada señal se vuelve a leer por RPC.
    func changes(owner: UUID) -> AsyncStream<Void>
}

@MainActor final class AmbulanceRepository: AmbulanceServing {
    private let api: HospitalAPI
    init(api: HospitalAPI) { self.api = api }

    func context() async throws -> AmbulanceContext {
        let value = try await api.ambulanceRPC("my_ambulance_context")
        let data = try JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
        return try JSONDecoder().decode(AmbulanceContext.self, from: data)
    }
    func submit(_ parameters: [String: Any]) async throws {
        _ = try await api.ambulanceRPC("submit_my_ambulance_request", parameters: parameters)
    }
    func cancel(request: UUID, reason: String) async throws {
        _ = try await api.ambulanceRPC("cancel_my_ambulance_request", parameters: ["p_request": request.uuidString.lowercased(), "p_reason": reason])
    }
    /// Supabase Realtime (postgres_changes en ambulance_requests filtrado por requester_id; la RLS ambreq_read limita lo que llega).
    /// Un canal por pantalla abierta: al cancelar la tarea de la vista se cierra el flujo y se elimina el canal.
    /// supabase-swift 2.28 reconecta el socket y vuelve a unir el canal tras perder la red.
    func changes(owner: UUID) -> AsyncStream<Void> {
        let client = api.client
        let filterValue = owner.uuidString.lowercased()
        return AsyncStream { continuation in
            let task = Task {
                let channel = client.channel("ambulance-requests-" + filterValue)
                let stream = channel.postgresChange(AnyAction.self, schema: "public", table: "ambulance_requests", filter: .eq("requester_id", value: filterValue))
                await channel.subscribe()
                for await _ in stream { continuation.yield(()) }
                await client.removeChannel(channel)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Estado de la pantalla «Solicitar ambulancia» (paridad con HospitalPatientAmbulance en web-preview/patient-ambulance.js).
@MainActor final class PatientAmbulanceModel: ObservableObject {
    @Published private(set) var context: AmbulanceContext?
    @Published private(set) var loading = false
    @Published private(set) var saving = false
    @Published private(set) var error: String?
    @Published private(set) var notice: String?
    @Published private(set) var confirmation: String?
    @Published private(set) var lastSync: Date?
    @Published var draft = AmbulanceDraft()
    /// nil = formulario de cancelación cerrado.
    @Published var cancelReason: String?
    private let repository: any AmbulanceServing
    private(set) var owner: UUID?
    private var generation = UUID()
    private var requestKey = UUID()
    private var phoneSeeded = false
    private var reloadPending = false
    private var watching = false

    init(repository: any AmbulanceServing) { self.repository = repository }

    var active: AmbulanceRequest? { AmbulanceRules.split(context?.requests ?? []).active }
    var previous: [AmbulanceRequest] { AmbulanceRules.split(context?.requests ?? []).previous }
    var problem: (field: String, message: String)? { AmbulanceRules.validate(draft) }
    var canSubmit: Bool { owner != nil && context != nil && active == nil && !saving && problem == nil }
    /// Solo se consulta periódicamente con una solicitud activa y sin escritura en curso.
    var shouldPoll: Bool { active != nil && !saving && !loading && cancelReason == nil }

    func configure(owner: UUID) {
        guard self.owner != owner else { return }
        clear(); self.owner = owner
    }
    func clear() {
        generation = UUID(); owner = nil; requestKey = UUID(); phoneSeeded = false; reloadPending = false
        context = nil; loading = false; saving = false; error = nil; notice = nil; confirmation = nil; lastSync = nil
        draft = AmbulanceDraft(); cancelReason = nil
    }

    func load() async {
        guard owner != nil else { return }
        if loading { reloadPending = true; return }
        let scope = generation; loading = true
        defer { if scope == generation { loading = false } }
        repeat {
            reloadPending = false
            do {
                let value = try await repository.context()
                guard scope == generation else { return }
                context = value; lastSync = Date(); error = nil
                if !phoneSeeded, draft.phone.isEmpty, let phone = value.person.phone { draft.phone = phone }
                phoneSeeded = true
            } catch {
                guard scope == generation else { return }
                // Sin conexión se conserva el último estado conocido, marcado como no actualizado; al reconectar se vuelve a leer.
                if context != nil {
                    let time = lastSync.map { $0.formatted(date: .omitted, time: .shortened) } ?? "—"
                    self.error = "No se pudo actualizar. Se muestra el último estado recibido a las \(time)."
                } else { self.error = Self.describe(error) }
            }
        } while reloadPending && scope == generation
    }

    func submit() async {
        guard canSubmit else { return }
        let scope = generation, parameters = AmbulanceRules.submission(draft, key: requestKey)
        saving = true; notice = nil; confirmation = nil
        do {
            try await repository.submit(parameters)
            guard scope == generation else { return }
            requestKey = UUID(); draft = AmbulanceDraft(phone: draft.phone)
            confirmation = "Solicitud enviada al hospital. Queda pendiente de revisión: todavía no hay una ambulancia asignada."
        } catch {
            guard scope == generation else { return }
            // Una respuesta perdida puede ocultar un envío confirmado: se conserva la clave (el servidor devuelve la misma solicitud).
            notice = Self.describe(error) + (error is URLError ? " Puedes reintentar: se conserva el identificador para evitar duplicados." : "")
        }
        saving = false
        await load()
    }

    func cancel() async {
        guard let active, AmbulanceRules.cancelProblem(cancelReason) == nil, !saving, let reason = cancelReason else { return }
        let scope = generation
        saving = true; notice = nil
        do {
            try await repository.cancel(request: active.id, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
            guard scope == generation else { return }
            cancelReason = nil; confirmation = "Solicitud cancelada. El hospital ya ve la cancelación."
        } catch {
            guard scope == generation else { return }
            notice = Self.describe(error)
        }
        saving = false
        await load()
    }

    func shareLocation(latitude: Double, longitude: Double, accuracy: Double?) {
        draft.latitude = latitude; draft.longitude = longitude
        draft.accuracy = accuracy.flatMap { $0 >= 0 ? $0 : nil }
    }
    func removeLocation() { draft.latitude = nil; draft.longitude = nil; draft.accuracy = nil }

    /// Escucha Realtime mientras la pantalla está abierta. Sin suscripciones duplicadas: una sola escucha a la vez.
    func watch() async {
        guard let owner, !watching else { return }
        watching = true
        defer { watching = false }
        for await _ in repository.changes(owner: owner) {
            if Task.isCancelled { break }
            await load()
        }
    }

    private static func describe(_ error: Error) -> String {
        if error is URLError { return "No se pudo conectar con el hospital. Revisa tu conexión." }
        if let known = error as? HospitalError { return known.localizedDescription }
        if let known = error as? BackendFailure, known.status == 404 { return "El servicio de ambulancia aún no está activado en el servidor del hospital (migración pendiente). Mientras tanto, comunícate directamente con el hospital." }
        if let known = error as? BackendFailure, known.status == 401 { return known.localizedDescription }
        return "No se pudo completar la operación. Inténtalo de nuevo."
    }
}
