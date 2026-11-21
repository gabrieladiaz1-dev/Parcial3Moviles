import SwiftUI
import MapKit
import CoreLocation

/// Ubicación de recogida: se pide permiso «al usarse» solo cuando el paciente pulsa «Usar mi ubicación actual» y se lee una vez.
/// Si lo deniega, puede seguir escribiendo la dirección. Nunca se rastrea en segundo plano.
@MainActor final class AmbulanceLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var locating = false
    @Published private(set) var error: String?
    private let manager = CLLocationManager()
    private var completion: ((CLLocation) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func request(_ completion: @escaping (CLLocation) -> Void) {
        error = nil
        self.completion = completion
        switch manager.authorizationStatus {
        case .notDetermined: locating = true; manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: locating = true; manager.requestLocation()
        default: self.completion = nil; error = AmbulanceRules.locationDenied
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.authorizationChanged() }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in self.finish(location) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        Task { @MainActor in self.fail(denied: denied) }
    }

    private func authorizationChanged() {
        guard locating else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .notDetermined: break
        default: fail(denied: true)
        }
    }
    private func finish(_ location: CLLocation) {
        guard locating else { return }
        locating = false
        completion?(location); completion = nil
    }
    private func fail(denied: Bool) {
        locating = false; completion = nil
        error = denied ? AmbulanceRules.locationDenied : AmbulanceRules.locationFailed
    }
}

/// Pantalla «Solicitar ambulancia» del paciente (ruta `ambulance`, menú Más → Servicios del hospital).
/// Paridad con web-preview/patient-ambulance.js. El paciente solicita y sigue su solicitud; solo administración asigna y despacha.
struct PatientAmbulanceView: View {
    @ObservedObject var model: PatientAmbulanceModel
    @StateObject private var location = AmbulanceLocationProvider()
    @FocusState private var focus: Field?
    private enum Field: Hashable { case phone, alternate, pickup, reference, reason, situation, notes, cancel }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            hero
            warning
            if let text = model.confirmation { banner(text, success: true) }
            if let text = model.notice { banner(text, success: false) }
            if let text = model.error { banner(text, success: false) }
            if let context = model.context {
                if let active = model.active { tracking(active) } else { form(context) }
                if !model.previous.isEmpty { previous }
            } else if model.loading {
                HospitalCard { ProgressView("Cargando tu información…").frame(maxWidth: .infinity) }
            } else {
                HospitalCard {
                    Text("No pudimos cargar la información de ambulancia.").font(.subheadline.weight(.semibold))
                    Button("Reintentar") { Task { await model.load() } }.tint(HospitalTheme.wine)
                }
            }
        }
        .task(id: model.owner) { await model.watch() }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Listo") { focus = nil } }
        }
    }

    // MARK: Encabezado y advertencia

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("AMBULANCIA DEL HOSPITAL").font(.caption2.weight(.heavy)).tracking(1.3).opacity(0.85)
                Spacer()
                Image(systemName: "cross.case.fill").font(.title3).accessibilityHidden(true)
            }
            Text("Solicitar ambulancia").font(.title2.bold())
            Text("Solicita asistencia de transporte médico y consulta el estado de tu solicitud.").font(.subheadline).opacity(0.9)
        }
        .foregroundStyle(.white).padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient.vinoDestacado, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var warning: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(red: 0.70, green: 0.15, blue: 0.12)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(AmbulanceRules.warning).font(.footnote.weight(.semibold)).foregroundStyle(Color(red: 0.43, green: 0.10, blue: 0.13))
                    .fixedSize(horizontal: false, vertical: true)
                if let phone = AmbulanceRules.emergencyPhone, let url = URL(string: "tel:" + phone.filter { $0.isNumber || $0 == "+" }) {
                    Link(destination: url) { Label("Llamar a emergencias · \(phone)", systemImage: "phone.fill") }
                        .font(.footnote.weight(.bold)).foregroundStyle(.white).padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color(red: 0.70, green: 0.15, blue: 0.12), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.99, green: 0.93, blue: 0.93), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(red: 0.95, green: 0.76, blue: 0.80), lineWidth: 1))
        .accessibilityElement(children: .combine).accessibilityLabel("Advertencia: \(AmbulanceRules.warning)")
    }

    private func banner(_ text: String, success: Bool) -> some View {
        Label(text, systemImage: success ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(success ? Color(red: 0.12, green: 0.42, blue: 0.24) : Color(red: 0.63, green: 0.07, blue: 0.18))
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(success ? Color(red: 0.89, green: 0.96, blue: 0.92) : Color(red: 0.99, green: 0.93, blue: 0.93), in: RoundedRectangle(cornerRadius: 14))
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Formulario

    private func form(_ context: AmbulanceContext) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !context.unit_available {
                Text(AmbulanceRules.unitBusyNote).font(.footnote).foregroundStyle(Color(red: 0.44, green: 0.33, blue: 0.13))
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 1, green: 0.97, blue: 0.91), in: RoundedRectangle(cornerRadius: 14))
            }
            section(1, "Paciente", note: "Tus datos se toman de tu cuenta.") {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nombre del paciente").font(.caption2.weight(.bold)).foregroundStyle(HospitalTheme.secondary)
                    Text(context.person.full_name ?? "Completa tu nombre en Perfil").font(.subheadline.weight(.semibold)).foregroundStyle(HospitalTheme.ink)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(HospitalTheme.background, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityElement(children: .combine)
                input("Teléfono de contacto", text: $model.draft.phone, field: .phone, prompt: "0000-0000", keyboard: .phonePad, content: .telephoneNumber)
                input("Teléfono alternativo (opcional)", text: $model.draft.alternatePhone, field: .alternate, keyboard: .phonePad, content: .telephoneNumber)
            }
            section(2, "Ubicación de recogida", note: "Escribe la dirección; compartir tu ubicación es opcional.") {
                input("Dirección", text: $model.draft.pickup, field: .pickup, prompt: "Calle, número, colonia, municipio", multiline: true, content: .fullStreetAddress)
                input("Punto de referencia (opcional)", text: $model.draft.reference, field: .reference, prompt: "Ej.: frente al parque, portón negro")
                locationControls
            }
            section(3, "Información de la solicitud", note: "Describe brevemente lo necesario para la recogida.") {
                input("Motivo de la solicitud", text: $model.draft.reason, field: .reason, prompt: "Ej.: traslado al hospital")
                input("Descripción breve de la situación (opcional)", text: $model.draft.situation, field: .situation, multiline: true)
                input("Información adicional para la recogida (opcional)", text: $model.draft.notes, field: .notes, prompt: "Ej.: segundo piso, sin ascensor", multiline: true)
            }
            if let problem = model.problem, touched {
                Text(problem.message).font(.footnote.weight(.semibold)).foregroundStyle(Color(red: 0.63, green: 0.07, blue: 0.18))
                    .accessibilityLabel("Revisa el formulario: \(problem.message)")
            }
            Button {
                focus = nil
                Task { await model.submit() }
            } label: {
                HStack(spacing: 8) {
                    if model.saving { ProgressView().tint(.white) } else { Image(systemName: "cross.case.fill") }
                    Text(model.saving ? "Enviando solicitud…" : "Solicitar ambulancia")
                }
            }
            .buttonStyle(HospitalPrimaryButtonStyle()).disabled(!model.canSubmit)
            Text("Enviar la solicitud no asigna la ambulancia: el hospital la revisa y te informa cada cambio de estado.")
                .font(.caption).foregroundStyle(HospitalTheme.secondary)
        }
    }

    private var touched: Bool {
        let d = model.draft
        return ![d.alternatePhone, d.pickup, d.reference, d.reason, d.situation, d.notes].allSatisfy(\.isEmpty) || d.latitude != nil
    }

    @ViewBuilder private var locationControls: some View {
        if let lat = model.draft.latitude, let lon = model.draft.longitude {
            VStack(alignment: .leading, spacing: 8) {
                pickupMap(latitude: lat, longitude: lon)
                Label(coordinates(lat, lon, model.draft.accuracy), systemImage: "location.fill")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Color(red: 0.12, green: 0.42, blue: 0.24))
                Button("Quitar ubicación", role: .destructive) { model.removeLocation() }.font(.footnote)
            }
        } else {
            Button {
                location.request { found in
                    model.shareLocation(latitude: found.coordinate.latitude, longitude: found.coordinate.longitude,
                                        accuracy: found.horizontalAccuracy >= 0 ? found.horizontalAccuracy : nil)
                }
            } label: {
                Label(location.locating ? "Obteniendo ubicación…" : "Usar mi ubicación actual", systemImage: "location")
                    .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered).tint(HospitalTheme.wine).disabled(location.locating || model.saving)
        }
        if let message = location.error { Text(message).font(.footnote).foregroundStyle(Color(red: 0.63, green: 0.07, blue: 0.18)) }
    }

    /// Mapa de la ubicación real compartida por el paciente (nunca coordenadas inventadas ni posición de la ambulancia).
    private func pickupMap(latitude: Double, longitude: Double) -> some View {
        let point = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        return Map(initialPosition: .region(MKCoordinateRegion(center: point, latitudinalMeters: 500, longitudinalMeters: 500)), interactionModes: []) {
            Marker("Recogida", coordinate: point).tint(HospitalTheme.wine)
        }
        .frame(height: 140).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .id("\(latitude),\(longitude)").accessibilityLabel("Mapa con la ubicación de recogida compartida")
    }

    private func coordinates(_ lat: Double, _ lon: Double, _ accuracy: Double?) -> String {
        "Ubicación compartida: " + String(format: "%.5f, %.5f", lat, lon) + (accuracy.map { " · ±\(Int($0.rounded())) m" } ?? "")
    }

    private func section<Content: View>(_ number: Int, _ title: String, note: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(number)").font(.subheadline.weight(.heavy)).foregroundStyle(HospitalTheme.wine)
                    .frame(width: 30, height: 30).background(HospitalTheme.rose, in: RoundedRectangle(cornerRadius: 10)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).foregroundStyle(HospitalTheme.ink)
                    Text(note).font(.caption).foregroundStyle(HospitalTheme.secondary)
                }
            }
            content()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func input(_ label: String, text: Binding<String>, field: Field, prompt: String = "", multiline: Bool = false,
                       keyboard: UIKeyboardType = .default, content: UITextContentType? = nil) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(HospitalTheme.ink)
            Group {
                if multiline { TextField(prompt, text: text, axis: .vertical).lineLimit(2...5) }
                else { TextField(prompt, text: text) }
            }
            .keyboardType(keyboard).textContentType(content).focused($focus, equals: field)
            .padding(12).background(HospitalTheme.background, in: RoundedRectangle(cornerRadius: 12))
            .disabled(model.saving).accessibilityLabel(label)
        }
    }

    // MARK: Seguimiento

    private func tracking(_ row: AmbulanceRequest) -> some View {
        let stage = AmbulanceRules.stage(row)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Solicitud \(AmbulanceRules.code(row.id))").font(.caption.weight(.bold)).foregroundStyle(HospitalTheme.secondary)
                    Text(stage.title).font(.title3.bold()).foregroundStyle(HospitalTheme.wine)
                }
                Spacer(minLength: 8)
                badge(stage)
            }
            Text(stage.message).font(.subheadline).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 0) {
                let steps = AmbulanceRules.timeline(row)
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(spacing: 0) {
                            Circle().fill(step.at == nil ? Color.white : HospitalTheme.wine).frame(width: 16, height: 16)
                                .overlay(Circle().stroke(step.at == nil ? Color.gray.opacity(0.4) : HospitalTheme.wine, lineWidth: 2))
                            if index < steps.count - 1 { Rectangle().fill(Color.gray.opacity(0.25)).frame(width: 2).frame(minHeight: 18) }
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(step.label).font(.subheadline.weight(step.at == nil ? .regular : .semibold))
                                .foregroundStyle(step.at == nil ? HospitalTheme.secondary : HospitalTheme.ink)
                            Text(step.at.map(Self.stamp) ?? "Pendiente").font(.caption).foregroundStyle(HospitalTheme.secondary)
                        }.padding(.bottom, 8)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                fact("Enviada", Self.stamp(row.requested_at))
                fact("Dirección de recogida", row.pickup_location)
                fact("Punto de referencia", row.pickup_reference)
                if let lat = row.pickup_latitude, let lon = row.pickup_longitude {
                    pickupMap(latitude: lat, longitude: lon)
                    fact("Ubicación compartida", String(format: "%.5f, %.5f", lat, lon) + (row.pickup_accuracy_m.map { " · ±\(Int($0.rounded())) m" } ?? ""))
                }
                fact("Motivo", row.reason)
                fact("Teléfono de contacto", [row.contact_phone, row.alternate_phone].compactMap { $0 }.joined(separator: " · "))
                fact("Unidad", row.unit_code)
                fact("Destino confirmado", row.destination)
                fact("Última actualización", Self.stamp(row.updated_at ?? row.requested_at))
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(HospitalTheme.background, in: RoundedRectangle(cornerRadius: 14))
            Text("Esta pantalla se actualiza automáticamente mientras está abierta" + (model.lastSync.map { " · Última consulta: " + $0.formatted(date: .omitted, time: .shortened) } ?? "."))
                .font(.caption).foregroundStyle(HospitalTheme.secondary)
            HStack(spacing: 12) {
                Button("Actualizar estado") { Task { await model.load() } }.buttonStyle(.bordered).tint(HospitalTheme.wine).disabled(model.loading || model.saving)
                if stage.cancellable && model.cancelReason == nil {
                    Button("Cancelar solicitud", role: .destructive) { model.cancelReason = "" }.disabled(model.saving)
                }
            }
            if row.status == "despachada" {
                Text("La ambulancia ya fue asignada. Para cancelar, comunícate con el hospital: el personal autorizado gestionará la cancelación.")
                    .font(.caption).foregroundStyle(HospitalTheme.secondary)
            }
            if model.cancelReason != nil { cancelForm }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(HospitalTheme.rose, lineWidth: 1))
    }

    private var cancelForm: some View {
        let reason = Binding(get: { model.cancelReason ?? "" }, set: { model.cancelReason = $0 })
        let problem = AmbulanceRules.cancelProblem(model.cancelReason)
        return VStack(alignment: .leading, spacing: 10) {
            input("Motivo de la cancelación", text: reason, field: .cancel, multiline: true)
            if let problem, !(model.cancelReason ?? "").isEmpty {
                Text(problem).font(.footnote).foregroundStyle(Color(red: 0.63, green: 0.07, blue: 0.18))
            }
            Button {
                focus = nil
                Task { await model.cancel() }
            } label: { Text(model.saving ? "Cancelando…" : "Confirmar cancelación") }
                .buttonStyle(HospitalPrimaryButtonStyle()).disabled(problem != nil || model.saving)
            Button("Volver") { model.cancelReason = nil }.frame(maxWidth: .infinity).tint(HospitalTheme.wine)
        }
        .padding(12).background(Color(red: 1, green: 0.98, blue: 0.98), in: RoundedRectangle(cornerRadius: 14))
    }

    private var previous: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Solicitudes anteriores").font(.headline).foregroundStyle(HospitalTheme.ink)
            ForEach(model.previous.prefix(5)) { row in
                let stage = AmbulanceRules.stage(row)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(AmbulanceRules.code(row.id)).font(.subheadline.weight(.semibold))
                        Spacer()
                        badge(stage)
                    }
                    Text(Self.stamp(row.requested_at)).font(.caption).foregroundStyle(HospitalTheme.secondary)
                    if let place = row.pickup_location { Text(place).font(.caption).foregroundStyle(HospitalTheme.secondary) }
                    if let reason = row.decision_reason { Text("Motivo: \(reason)").font(.caption).foregroundStyle(HospitalTheme.secondary) }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 14))
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Auxiliares

    private func badge(_ stage: AmbulanceStage) -> some View {
        let colors: (Color, Color) = {
            switch stage.key {
            case "asignada", "en_camino", "en_atencion": return (Color(red: 0.91, green: 0.94, blue: 1), Color(red: 0.10, green: 0.31, blue: 0.63))
            case "finalizada": return (HospitalTheme.green, Color(red: 0.12, green: 0.42, blue: 0.24))
            case "cancelada", "rechazada": return (Color(red: 0.93, green: 0.94, blue: 0.95), Color(red: 0.29, green: 0.32, blue: 0.39))
            default: return (Color(red: 1, green: 0.95, blue: 0.85), Color(red: 0.48, green: 0.33, blue: 0.06))
            }
        }()
        return Text(stage.label).font(.caption.weight(.bold)).foregroundStyle(colors.1)
            .padding(.horizontal, 10).padding(.vertical, 5).background(colors.0, in: Capsule())
            .fixedSize().accessibilityLabel("Estado: \(stage.label)")
    }

    @ViewBuilder private func fact(_ label: String, _ value: String?) -> some View {
        if let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption2.weight(.bold)).foregroundStyle(HospitalTheme.secondary)
                Text(value).font(.footnote).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
            }.accessibilityElement(children: .combine)
        }
    }

    private static func stamp(_ value: String) -> String {
        guard let date = DoctorDate.parse(value) else { return "Sin registrar" }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: Locale(identifier: "es_SV"),
                                               calendar: DoctorClinicalRules.calendar, timeZone: DoctorClinicalRules.timeZone))
    }
}
