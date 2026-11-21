import Foundation
import Testing
@testable import HospitalUniversitario

/// Mismas reglas que HospitalCore.ambulance (hospital-core.js) y mismo flujo que scripts/test-patient-ambulance.mjs.
/// Pendientes de ejecutar en Xcode (no hay Mac en el entorno de desarrollo actual).
struct AmbulanceRulesTests {
    private func row(_ status: String, assigned: String? = nil, departed: String? = nil, arrived: String? = nil, completed: String? = nil,
                     requested: String = "2026-11-21T10:00:00Z", updated: String? = nil) -> AmbulanceRequest {
        AmbulanceRequest(id: UUID(uuidString: "1A2B3C4D-0000-4000-8000-000000000001")!, status: status, requested_at: requested, updated_at: updated,
                         assigned_at: assigned, departed_at: departed, arrived_at: arrived, completed_at: completed)
    }

    @Test func validationMatchesTheSharedRule() {
        var draft = AmbulanceDraft(phone: "7012-3456", pickup: "Colonia Escalón, casa 14", reason: "Traslado al hospital")
        #expect(AmbulanceRules.validate(draft) == nil)
        draft.phone = "12"
        #expect(AmbulanceRules.validate(draft)?.message == "Escribe un teléfono de contacto válido (8 a 15 dígitos).")
        draft.phone = "+503 7012-3456"; draft.alternatePhone = "abc"
        #expect(AmbulanceRules.validate(draft)?.field == "alternatePhone")
        draft.alternatePhone = ""; draft.pickup = "Col"
        #expect(AmbulanceRules.validate(draft)?.message == "Escribe la dirección de recogida (entre 5 y 1000 caracteres).")
        draft.pickup = "Colonia Escalón"; draft.reason = "x"
        #expect(AmbulanceRules.validate(draft)?.message == "Escribe el motivo de la solicitud (entre 3 y 500 caracteres).")
        draft.reason = "Traslado"; draft.latitude = 13.7
        #expect(AmbulanceRules.validate(draft)?.field == "location", "Coordenadas incompletas")
        draft.longitude = -89.2; draft.accuracy = 12
        #expect(AmbulanceRules.validate(draft) == nil)
    }

    @Test func submissionCarriesNoIdentityAndRoundsCoordinates() {
        let key = UUID()
        let draft = AmbulanceDraft(phone: " 7012-3456 ", pickup: "Colonia X", reason: "Dolor", latitude: 13.7012346, longitude: -89.2, accuracy: 12.34)
        let values = AmbulanceRules.submission(draft, key: key)
        #expect(Set(values.keys) == ["p_key", "p_phone", "p_pickup", "p_reason", "p_reference", "p_situation", "p_notes", "p_alternate_phone", "p_latitude", "p_longitude", "p_accuracy"])
        #expect(values["p_phone"] as? String == "7012-3456")
        #expect(values["p_latitude"] as? Double == 13.701235)
        #expect(values["p_accuracy"] as? Double == 12.3)
        #expect(values["p_reference"] is NSNull)
        #expect(AmbulanceRules.submission(AmbulanceDraft(phone: "70123456", pickup: "Colonia X", reason: "Dolor"), key: key)["p_latitude"] is NSNull)
    }

    @Test func stagesAreDerivedFromRealTimestampsOnly() {
        #expect(AmbulanceRules.stage(row("pendiente")).title == "Solicitud recibida")
        #expect(AmbulanceRules.stage(row("autorizada")).label == "En revisión")
        #expect(AmbulanceRules.stage(row("despachada", assigned: "2026-11-21T10:05:00Z")).title == "Ambulancia asignada")
        #expect(AmbulanceRules.stage(row("despachada", assigned: "x", departed: "y")).title == "Ambulancia en camino")
        #expect(AmbulanceRules.stage(row("despachada", assigned: "x", departed: "y", arrived: "z")).label == "En atención")
        #expect(AmbulanceRules.stage(row("pendiente")).cancellable)
        #expect(!AmbulanceRules.stage(row("despachada")).cancellable, "Tras el despacho solo cancela el personal autorizado")
        #expect(AmbulanceRules.stage(row("algo_nuevo")).label == "Estado no disponible")
        let steps = AmbulanceRules.timeline(row("despachada", assigned: "2026-11-21T10:05:00Z"))
        #expect(steps.map(\.at) == ["2026-11-21T10:00:00Z", "2026-11-21T10:05:00Z", nil, nil, nil], "Sin horas estimadas")
        #expect(AmbulanceRules.timeline(row("cancelada", updated: "2026-11-21T10:02:00Z")).map(\.label) == ["Solicitud enviada", "Cancelada"])
        #expect(AmbulanceRules.code(row("pendiente").id) == "SA-1A2B3C4D")
    }

    @Test func splitKeepsOneActiveRequest() {
        let old = row("finalizada", requested: "2026-11-01T10:00:00Z"), open = row("pendiente", requested: "2026-11-21T10:00:00Z")
        let result = AmbulanceRules.split([old, open])
        #expect(result.active?.status == "pendiente")
        #expect(result.previous.map(\.status) == ["finalizada"])
        #expect(AmbulanceRules.cancelProblem("") != nil && AmbulanceRules.cancelProblem("Me trasladó un familiar") == nil)
    }
}

@MainActor final class FakeAmbulanceRepository: AmbulanceServing {
    var rows: [AmbulanceRequest] = []
    var submitted: [[String: Any]] = []
    var offline = false
    var loseNextResponse = false
    var signals: AsyncStream<Void>.Continuation?
    func context() async throws -> AmbulanceContext {
        if offline { throw URLError(.notConnectedToInternet) }
        return AmbulanceContext(person: .init(full_name: "Paciente", phone: "7000-1111"), unit_available: true, requests: rows)
    }
    func submit(_ parameters: [String: Any]) async throws {
        submitted.append(parameters)
        let key = parameters["p_key"] as? String ?? ""
        if !rows.contains(where: { $0.id.uuidString.lowercased() == key }) {
            rows.append(AmbulanceRequest(id: UUID(uuidString: key)!, status: "pendiente", requested_at: "2026-11-21T10:00:00Z"))
        }
        if loseNextResponse { loseNextResponse = false; throw URLError(.networkConnectionLost) }
    }
    func cancel(request: UUID, reason: String) async throws {}
    func changes(owner: UUID) -> AsyncStream<Void> { AsyncStream { self.signals = $0 } }
}

@MainActor struct PatientAmbulanceModelTests {
    private func ready() async -> (PatientAmbulanceModel, FakeAmbulanceRepository) {
        let repository = FakeAmbulanceRepository(), model = PatientAmbulanceModel(repository: repository)
        model.configure(owner: UUID()); await model.load()
        model.draft.pickup = "Colonia Escalón, casa 14"; model.draft.reason = "Traslado al hospital"
        return (model, repository)
    }

    @Test func phoneIsPrefilledAndDoubleTapSendsOnce() async {
        let (model, repository) = await ready()
        #expect(model.draft.phone == "7000-1111")
        async let first: Void = model.submit()
        async let second: Void = model.submit()
        _ = await (first, second)
        #expect(repository.submitted.count == 1)
        #expect(model.active?.status == "pendiente")
        #expect(model.confirmation?.contains("pendiente de revisión") == true)
    }

    @Test func lostResponseKeepsTheKeyAndShowsTheRealState() async {
        let (model, repository) = await ready()
        repository.loseNextResponse = true
        await model.submit()
        #expect(repository.rows.count == 1, "El servidor la registró")
        #expect(model.active != nil, "Se reconcilia con el estado real")
        #expect(model.notice?.contains("se conserva el identificador") == true)
    }

    @Test func reconnectionKeepsLastStateThenRecovers() async {
        let (model, repository) = await ready()
        await model.submit()
        repository.offline = true
        await model.load()
        #expect(model.error?.hasPrefix("No se pudo actualizar. Se muestra el último estado recibido") == true)
        #expect(model.active != nil)
        repository.offline = false
        repository.rows[0] = AmbulanceRequest(id: repository.rows[0].id, status: "despachada", requested_at: "2026-11-21T10:00:00Z", departed_at: "2026-11-21T10:10:00Z")
        await model.load()
        #expect(model.error == nil)
        #expect(AmbulanceRules.stage(model.active!).title == "Ambulancia en camino")
    }

    @Test func realtimeSignalReloadsFromTheServer() async {
        let (model, repository) = await ready()
        let watcher = Task { await model.watch() }
        await Task.yield()
        repository.rows = [AmbulanceRequest(id: UUID(), status: "pendiente", requested_at: "2026-11-21T11:00:00Z")]
        repository.signals?.yield(())
        for _ in 0..<20 where model.active == nil { await Task.yield() }
        #expect(model.active != nil)
        watcher.cancel(); repository.signals?.finish()
    }
}
