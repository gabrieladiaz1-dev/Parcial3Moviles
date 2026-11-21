import SwiftUI

/// Componentes de presentación compartidos por paciente y médico (paridad web: web-preview/clinical-cards.js).
/// Solo dibujan lo que entregan los presentadores de ClinicalCardRules; no consultan datos ni deciden permisos.
enum ClinicalCardFormat {
    static func stamp(_ value: String?) -> String? {
        guard let value, let date = DoctorDate.parse(value) else { return nil }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: Locale(identifier: "es_SV"),
                                               calendar: DoctorClinicalRules.calendar, timeZone: DoctorClinicalRules.timeZone))
    }
}

struct ClinicalBadgeView: View {
    let badge: ClinicalBadge
    private var colors: (Color, Color) {
        switch badge.tone {
        case "done": return (HospitalTheme.green, Color(red: 0.12, green: 0.42, blue: 0.24))
        case "pending": return (Color(red: 1, green: 0.95, blue: 0.85), Color(red: 0.48, green: 0.33, blue: 0.06))
        case "processing", "partial": return (Color(red: 0.91, green: 0.94, blue: 1), Color(red: 0.10, green: 0.31, blue: 0.63))
        default: return (Color(red: 0.93, green: 0.94, blue: 0.95), Color(red: 0.29, green: 0.32, blue: 0.39))
        }
    }
    var body: some View {
        Text(badge.label).font(.caption.weight(.bold)).foregroundStyle(colors.1)
            .padding(.horizontal, 10).padding(.vertical, 5).background(colors.0, in: Capsule())
            .fixedSize().accessibilityLabel("Estado: \(badge.label)")
    }
}

/// Tarjeta de un medicamento con el estilo de «Mis recetas». Campos ausentes: «No registrado» (sin inventar valores).
struct ClinicalMedicineCard: View {
    let medicine: ClinicalMedicine
    var state: String? = nil
    var stateBackground: Color = HospitalTheme.rose
    var missing = "No registrado"

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let state {
                Text(state).font(.subheadline.weight(.semibold)).foregroundStyle(HospitalTheme.wine).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(stateBackground, in: RoundedRectangle(cornerRadius: 7))
            }
            Label(medicine.name, systemImage: "pills").font(.system(size: 16, weight: .bold)).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
            if medicine.unstructured {
                Text("Detalle registrado (formato anterior del servidor).").font(.footnote).foregroundStyle(HospitalTheme.secondary)
            } else {
                VStack(spacing: 12) {
                    if let strength = medicine.strength { row("Concentración", strength); line }
                    row("Dosis", medicine.dose ?? missing); line
                    row("Cada", medicine.frequency ?? missing); line
                    row("Vía", medicine.route ?? missing); line
                    row("Durante", medicine.duration ?? missing); line
                    row("Cantidad", medicine.quantity ?? missing); line
                }
                DoctorConsultationField(label: "Indicaciones", value: medicine.observations ?? "Sin indicaciones adicionales.")
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(HospitalTheme.rose, lineWidth: 1))
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(label + ":").font(.subheadline.weight(.semibold)); Spacer(minLength: 0)
            Text(value).font(.footnote).multilineTextAlignment(.trailing)
        }.foregroundStyle(HospitalTheme.secondary).accessibilityElement(children: .combine)
    }
    private var line: some View { Rectangle().stroke(HospitalTheme.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(height: 1) }
}

/// Cabecera común: icono, rótulo pequeño, título y estado.
private struct ClinicalCardHeader: View {
    let icon: String
    let caption: String
    let title: String
    let badge: ClinicalBadge
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.subheadline.weight(.bold)).foregroundStyle(HospitalTheme.wine)
                .frame(width: 36, height: 36).background(HospitalTheme.rose, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(caption).font(.caption2.weight(.heavy)).tracking(1).foregroundStyle(HospitalTheme.secondary)
                Text(title).font(.subheadline.weight(.bold)).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            ClinicalBadgeView(badge: badge)
        }
    }
}

private struct ClinicalFacts: View {
    let facts: [(String, String?)]
    var body: some View {
        let shown = facts.compactMap { fact in fact.1.map { (fact.0, $0) } }
        if !shown.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .topLeading)], alignment: .leading, spacing: 8) {
                ForEach(Array(shown.enumerated()), id: \.offset) { _, fact in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(fact.0).font(.caption2.weight(.bold)).foregroundStyle(HospitalTheme.secondary)
                        Text(fact.1).font(.caption).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
                }
            }
            .padding(10).background(HospitalTheme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct ClinicalCardContainer<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(HospitalTheme.rose, lineWidth: 1))
    }
}

/// Receta resumida (identificador, fecha, médico, estado, nº de medicamentos) con «Ver receta» desplegable.
struct ClinicalPrescriptionCard: View {
    let view: ClinicalPrescriptionView
    @State private var open = false
    var body: some View {
        ClinicalCardContainer {
            ClinicalCardHeader(icon: "doc.text", caption: "RECETA", title: view.code, badge: view.status)
            ClinicalFacts(facts: [("Fecha", ClinicalCardFormat.stamp(view.issuedAt)), ("Médico", view.doctor),
                                  ("Medicamentos", view.count > 0 ? "\(view.count)" : "Sin medicamentos registrados")])
            Button(open ? "Ocultar receta" : "Ver receta") { withAnimation(.easeInOut(duration: 0.2)) { open.toggle() } }
                .buttonStyle(.bordered).tint(HospitalTheme.wine).font(.subheadline.weight(.semibold))
                .accessibilityValue(open ? "Desplegada" : "Contraída")
            if open {
                VStack(spacing: 10) {
                    ForEach(Array(view.medicines.enumerated()), id: \.offset) { _, medicine in ClinicalMedicineCard(medicine: medicine) }
                    if view.medicines.isEmpty { Text("La receta no tiene medicamentos registrados.").font(.footnote).foregroundStyle(HospitalTheme.secondary) }
                }
            }
        }
    }
}

/// Orden de laboratorio con «Ver resultado»: parámetros reales o, si solo hay texto, la observación del laboratorio.
struct ClinicalLabOrderCard: View {
    let view: ClinicalLabOrderView
    var showPatient = true
    @State private var open = false
    var body: some View {
        ClinicalCardContainer {
            ClinicalCardHeader(icon: view.published ? "checkmark.seal" : "testtube.2", caption: "LABORATORIO", title: view.test, badge: view.status)
            ClinicalFacts(facts: [("Paciente", showPatient ? view.patient : nil), ("Solicitado", ClinicalCardFormat.stamp(view.requestedAt)),
                                  ("Publicado", ClinicalCardFormat.stamp(view.publishedAt)), ("Expediente", showPatient ? view.record : nil)])
            if let reason = view.reason {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Motivo e indicaciones").font(.caption.weight(.semibold)).foregroundStyle(HospitalTheme.ink)
                    Text(reason).font(.caption).foregroundStyle(HospitalTheme.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if !view.published {
                Text("El laboratorio está procesando la orden o aún no ha publicado un resultado validado.").font(.footnote).foregroundStyle(HospitalTheme.secondary)
            } else {
                Button(open ? "Ocultar resultado" : "Ver resultado") { withAnimation(.easeInOut(duration: 0.2)) { open.toggle() } }
                    .buttonStyle(.bordered).tint(HospitalTheme.wine).font(.subheadline.weight(.semibold))
                if open { result }
            }
        }
    }
    @ViewBuilder private var result: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !view.parameters.isEmpty {
                Text("PARÁMETROS ANALIZADOS").font(.caption.weight(.heavy)).foregroundStyle(HospitalTheme.wine)
                ForEach(Array(view.parameters.enumerated()), id: \.offset) { _, p in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.label).font(.subheadline.weight(.semibold)).foregroundStyle(HospitalTheme.ink)
                                if let reference = p.reference { Text("Referencia: \(reference)").font(.caption).foregroundStyle(HospitalTheme.secondary) }
                            }
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(p.value ?? "No informado").font(.headline.monospacedDigit()).foregroundStyle(HospitalTheme.wine)
                                if let unit = p.unit { Text(unit).font(.caption).foregroundStyle(HospitalTheme.secondary) }
                            }
                        }
                        if let observation = p.observation { Text("Observación: \(observation)").font(.caption).foregroundStyle(HospitalTheme.secondary) }
                    }
                    .padding(10).background(HospitalTheme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
            if let observation = view.observation {
                VStack(alignment: .leading, spacing: 4) {
                    Text(view.parameters.isEmpty ? "Observación del laboratorio" : "Comentario del laboratorio").font(.caption.weight(.bold)).foregroundStyle(HospitalTheme.wine)
                    Text(observation).font(.subheadline).foregroundStyle(HospitalTheme.ink).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(red: 0.98, green: 0.97, blue: 0.97), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(HospitalTheme.rose, lineWidth: 1))
            }
            if view.parameters.isEmpty && view.observation == nil {
                Text("El laboratorio publicó el resultado sin valores ni observaciones.").font(.footnote).foregroundStyle(HospitalTheme.secondary)
            }
            Label("Resultado validado y publicado por el laboratorio" + (ClinicalCardFormat.stamp(view.completedAt).map { " · completado el \($0)" } ?? ""), systemImage: "checkmark.seal.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(Color(red: 0.12, green: 0.42, blue: 0.24))
        }
    }
}
