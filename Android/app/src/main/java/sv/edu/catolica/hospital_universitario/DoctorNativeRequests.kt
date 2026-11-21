package sv.edu.catolica.hospital_universitario

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject

/** Base de Ingresos y Ambulancia: buscador de pacientes autorizados (patientStep) y piezas comunes. */
abstract class DoctorRequestActivity : DoctorNativeActivity() {
    override val loadsWorkspace = true
    private val debounce = Handler(Looper.getMainLooper())
    private var stepHolder: LinearLayout? = null
    abstract val formOpen: Boolean

    fun heroBlock(parent: LinearLayout, label: Int, icon: Int, title: Int, body: Int) {
        val hero = ui.hero(parent, 10, 24)
        ui.label(s(label), icon, DFont.CAPTION2_HEAVY, Color.WHITE, hero, tracking = 1.2f, alpha = 0.85f)
        ui.text(s(title), DFont.TITLE2, Color.WHITE, hero)
        ui.text(s(body), DFont.SUBHEAD, Color.WHITE, hero, alpha = 0.9f)
    }
    fun gradientButton(parent: LinearLayout, title: Int, onClick: () -> Unit) =
        ui.primaryButton(s(title), R.drawable.ic_d_add_circle, parent, true, 56, onClick = onClick)
    fun listHeader(parent: LinearLayout, title: Int, refresh: Int, onRefresh: () -> Unit) {
        val row = ui.hbox(8, parent).apply { setPadding(0, ui.dp(4), 0, 0) }
        ui.label(s(title), R.drawable.ic_d_clipboard, DFont.HEADLINE, DoctorTheme.ink, row)
        ui.spacerView(row)
        if (busy) ui.smallSpinner(row)
        ui.circleIconButton(R.drawable.ic_d_refresh, s(refresh), row, onClick = onRefresh)
    }
    fun formHeader(parent: LinearLayout, title: Int, onCancel: () -> Unit) {
        val row = ui.hbox(8, parent)
        ui.text(s(title), DFont.TITLE3, DoctorTheme.ink, row).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.linkButton(s(R.string.desk_cancel), null, row, DFont.SUBHEAD_SEMI, onClick = onCancel)
    }
    fun pendingBox(parent: LinearLayout, lines: List<Pair<String, DFont>>) {
        val box = ui.vbox(8, parent).apply { background = ui.rounded(DoctorTheme.rose, 14); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        ui.label(s(R.string.dx_unconfirmed), R.drawable.ic_d_refresh, DFont.SUBHEAD_BOLD, DoctorTheme.wine, box)
        ui.text(s(R.string.dx_retry_avoid_dup), DFont.FOOTNOTE, DoctorTheme.wine, box)
        lines.forEach { (text, font) -> ui.text(text, font, DoctorTheme.wine, box, lines = 3) }
    }
    fun statusCapsule(parent: LinearLayout, text: String, done: Boolean, closed: Boolean) =
        ui.pill(text, null, if (done) DoctorTheme.greenInk else if (closed) DoctorTheme.secondary else DoctorTheme.wine,
            if (done) DoctorTheme.green else if (closed) DoctorTheme.background else DoctorTheme.rose, DFont.CAPTION2_BOLD, parent)

    /** Paso 1: paciente elegido o buscador (nombre, apellido o DUI). Sin texto no se muestra ningún listado. */
    fun patientStep(parent: LinearLayout, title: Int, searchLabel: Int, pendingName: String?, pendingRecord: String?) {
        val box = ui.vbox(12, parent)
        ui.blockHeader(box, R.drawable.ic_d_person, s(title), s(R.string.dx_step_patient_sub), "1")
        val name = pendingName ?: ctx.selectedPatient?.txt("full_name") ?: ctx.selectedAppointment?.txt("patient_name")
        if (name != null) {
            val row = ui.hbox(12, box).apply { background = ui.rounded(DoctorTheme.background, 14); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
            ui.circleText(DoctorRules.initials(name), 48, DoctorTheme.wine, DoctorTheme.rose, DFont(17f, 2), row)
            val t = ui.vbox(3, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            ui.text(name, DFont.HEADLINE, DoctorTheme.ink, t)
            val record = pendingRecord ?: ctx.selectedPatient?.txt("record_number") ?: ctx.selectedAppointment?.txt("record_number")
            ui.text(s(R.string.dx_record_value, record ?: s(R.string.dx_record_na)), DFont.CAPTION_SEMI, DoctorTheme.wine, t)
            ctx.selectedPatient?.txt("dui")?.let { ui.text(s(R.string.dx_dui_value, it), DFont.CAPTION, DoctorTheme.secondary, t) }
            if (pendingName == null) ui.linkButton(s(R.string.dx_change), null, row, DFont.SUBHEAD_SEMI) { ctx.select(null); ctx.patientQuery = ""; rerender() }
            return
        }
        val input = ui.searchField(box, s(R.string.dx_step_search_ph), ctx.patientQuery, DoctorTheme.background, DoctorTheme.rose, 1.5f, 50, 14) { q ->
            ctx.patientQuery = q
            debounce.removeCallbacksAndMessages(null)
            fillStep()
            if (q.trim().length >= 2) debounce.postDelayed({ if (ctx.patientQuery.trim() != ctx.lastDirectoryQuery || ctx.directoryError != null) loadPatients { fillStep() } }, 350)
        }
        input.contentDescription = s(searchLabel)
        stepHolder = ui.vbox(10, box)
        fillStep()
    }
    private fun fillStep() {
        val box = stepHolder ?: return
        box.removeAllViews()
        val q = ctx.patientQuery.trim()
        when {
            q.length < 2 -> ui.label(s(R.string.dx_type_two), R.drawable.ic_d_info, DFont.FOOTNOTE, DoctorTheme.secondary, box)
            busy || ctx.lastDirectoryQuery != q -> ui.progress(box, s(R.string.dx_searching_patients))
            ctx.directoryError != null -> ui.notice(ctx.directoryError!!, box)
            ctx.directory.isEmpty() -> ui.label(s(R.string.dx_no_authorized_q, q), R.drawable.ic_d_person, DFont.FOOTNOTE, DoctorTheme.secondary, box)
            else -> {
                ctx.directory.forEach { p ->
                    val row = ui.hbox(12, box).apply { background = ui.rounded(Color.WHITE, 14, DoctorTheme.rose); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
                    ui.circleText(DoctorRules.initials(p.value("full_name")), 42, DoctorTheme.wine, DoctorTheme.rose, DFont.SUBHEAD_BOLD, row)
                    val t = ui.vbox(3, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
                    ui.text(p.value("full_name"), DFont.SUBHEAD_SEMI, DoctorTheme.ink, t)
                    ui.text(listOfNotNull(p.txt("record_number")?.let { s(R.string.dx_exp_short, it) }, p.txt("dui")?.let { s(R.string.dx_dui_value, it) },
                        if (p.has("age") && !p.isNull("age")) s(R.string.dx_years, p.optInt("age")) else null).joinToString(" · "), DFont.CAPTION, DoctorTheme.secondary, t)
                    ui.icon(R.drawable.ic_d_add_circle, DoctorTheme.wine, 22, row)
                    row.contentDescription = s(R.string.dx_select_patient_a11y, p.value("full_name"))
                    ui.clickable(row) { ctx.openPatient(p); onPatientPicked(); rerender() }
                }
                if (ctx.directoryPage?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_more_patients), null, box) { loadPatients(true) { fillStep() } }
            }
        }
    }
    open fun onPatientPicked() {}
    fun detailDisclosure(parent: LinearLayout, title: Int, build: (LinearLayout) -> Unit) =
        ui.disclosure(parent, s(title), DFont.SUBHEAD_SEMI, DoctorTheme.wine) { body -> build(ui.vbox(12, body)) }
}

/** Ingresos hospitalarios: admissionsView de DoctorModuleView. */
class DoctorNativeAdmissionsActivity : DoctorRequestActivity() {
    override val screen = "admissions"
    override val formOpen get() = ctx.admissionForm
    override fun onCreate(state: android.os.Bundle?) { super.onCreate(state); if (ready) loadAdmissions() }
    private fun loadAdmissions(more: Boolean = false) {
        ctx.admissionsError = null
        val offset = if (more) ctx.admissionsPage?.optInt("next_offset") ?: 0 else 0
        work({ repo.call("admissions", args("p_offset" to offset)) as JSONObject }, { ctx.admissions = emptyList(); ctx.admissionsError = describe(it); rerender() }) { page ->
            ctx.admissions = if (more) ctx.admissions + page.list("items") else page.list("items"); ctx.admissionsPage = page
            rerender()
        }
    }
    private fun status(v: String) = when (v) { "solicitado" -> s(R.string.dx_ad_requested); "asignado" -> s(R.string.dx_ad_assigned); "hospitalizado" -> s(R.string.dx_ad_admitted)
        "alta_medica" -> s(R.string.dx_ad_discharge); "cerrado" -> s(R.string.dx_ad_closed); "cancelado" -> s(R.string.dx_ad_cancelled_m); "rechazada" -> s(R.string.dx_ad_rejected)
        "cancelada" -> s(R.string.dx_ad_cancelled_f); else -> v }
    private fun category(v: String) = when (v) { "vip" -> "VIP"; "semiprivada" -> s(R.string.desk_semi); else -> v }
    private fun priority(v: String) = s(if (v == "urgente") R.string.desk_urgent else R.string.desk_normal)
    override fun render() {
        clear(false)
        moduleTop()
        val box = ui.vbox(16, content)
        heroBlock(box, R.string.dx_ad_upper, R.drawable.ic_d_bed, R.string.dx_ad_title, R.string.dx_ad_body)
        ctx.admissionsError?.let { ui.notice(it, box); ui.linkButton(s(R.string.dx_ad_refresh), R.drawable.ic_d_refresh, box) { loadAdmissions() } }
        if (!ctx.admissionForm) gradientButton(box, R.string.dx_ad_new) { ctx.patientQuery = ""; ctx.admissionForm = true; rerender() }
        else form(box)
        listHeader(box, R.string.dx_ad_mine, R.string.dx_ad_refresh) { loadAdmissions() }
        if (ctx.admissions.isEmpty() && !busy && ctx.admissionsError == null) ui.emptyState(box, R.drawable.ic_d_bed, s(R.string.dx_ad_empty), s(R.string.dx_ad_empty_body))
        ctx.admissions.forEach { card(box, it) }
        if (ctx.admissionsPage?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_ad_more), null, box, enabled = !busy) { loadAdmissions(true) }
    }
    private fun form(parent: LinearLayout) {
        val card = ui.card(parent, 18)
        formHeader(card, R.string.dx_ad_form_title) { ctx.admissionForm = false; rerender() }
        val pending = ctx.pendingAdmission
        pending?.let { p -> pendingBox(card, listOf("${p.label} · ${p.record.ifBlank { s(R.string.dx_record_unavailable) }} · ${category(p.values.value("p_kind"))}" to DFont.CAPTION_SEMI, p.reason to DFont.CAPTION)) }
        val locked = pending != null
        patientStep(card, R.string.dx_ad_patient, R.string.dx_ad_search_a11y, pending?.label, pending?.record)
        ui.divider(card)
        val care = ui.vbox(14, card)
        ui.blockHeader(care, R.drawable.ic_d_bed, s(R.string.dx_ad_care), s(R.string.dx_ad_care_sub), "2")
        ui.text(s(R.string.dx_ad_category), DFont.SUBHEAD_SEMI, DoctorTheme.ink, care)
        val page = ctx.admissionsPage
        val categories = page?.strings("categories").orEmpty()
        if (categories.isEmpty()) ui.text(s(R.string.dx_ad_no_categories), DFont.FOOTNOTE, DoctorTheme.secondary, care)
        val flow = ui.flow(8, care)
        categories.forEach { kind -> ui.choiceChip(category(kind), if (kind == "vip") R.drawable.ic_d_star else R.drawable.ic_d_bed, ctx.admissionCategory == kind, flow) { if (!locked) { ctx.admissionCategory = kind; rerender() } } }
        ui.text(s(R.string.doc_priority), DFont.SUBHEAD_SEMI, DoctorTheme.ink, care)
        val priorities = page?.strings("priorities").orEmpty()
        if (priorities.isNotEmpty()) ui.segmented(care, priorities.map { it to priority(it) }, ctx.admissionPriority) { if (!locked) { ctx.admissionPriority = it; paintSubmit() } }
        ui.label(s(R.string.dx_ad_requesting, page?.txt("doctor_name") ?: s(R.string.dx_loading_identity)), R.drawable.ic_d_stethoscope, DFont.CAPTION, DoctorTheme.secondary, care)
        ui.divider(card)
        val reason = ui.vbox(14, card)
        ui.blockHeader(reason, R.drawable.ic_d_chat, s(R.string.dx_ad_reason_block), s(R.string.dx_ad_reason_block_sub), "3")
        noteField(reason, R.drawable.ic_d_medical_case, s(R.string.dx_ad_reason), s(R.string.dx_ad_reason_ph), ctx.admissionReason) { ctx.admissionReason = it; paintSubmit() }.isEnabled = !locked
        val obs = ui.vbox(8, reason)
        ui.label(s(R.string.dx_ad_observations), R.drawable.ic_d_note, DFont.SUBHEAD_SEMI, DoctorTheme.ink, obs)
        ui.field(obs, s(R.string.dx_ad_observations_ph), ctx.admissionObservations, multiline = true, minLines = 3, max = 10000) { ctx.admissionObservations = it }.apply { maxLines = 8; isEnabled = !locked }
        submitHolder = ui.vbox(0, card); paintSubmit()
    }
    private var submitHolder: LinearLayout? = null
    private fun paintSubmit() {
        val box = submitHolder ?: return
        box.removeAllViews()
        ui.primaryButton(s(if (ctx.pendingAdmission == null) R.string.dx_ad_submit else R.string.dx_retry_same), R.drawable.ic_d_send, box,
            ctx.canRequestAdmission && ctx.admissionsPage != null) {
            confirm(s(R.string.dx_ad_confirm_title), s(R.string.dx_ad_confirm_body), listOf(s(R.string.dx_confirm_send) to { request() }))
        }
    }
    private fun request() {
        if (!ctx.canRequestAdmission) return
        if (ctx.pendingAdmission == null) {
            val patient = ctx.patientId ?: return
            ctx.pendingAdmission = DoctorPending("admission_request", args("p_patient" to patient, "p_kind" to ctx.admissionCategory, "p_reason" to ctx.admissionReason.trim(),
                "p_instructions" to ctx.admissionObservations.trim(), "p_priority" to ctx.admissionPriority, "p_encounter" to ctx.activeConsultation?.txt("id")),
                DoctorNativeContext.uuid(), ctx.selectedPatient?.txt("full_name") ?: ctx.selectedAppointment?.value("patient_name").orEmpty(),
                ctx.selectedPatient?.txt("record_number") ?: ctx.selectedAppointment?.txt("record_number").orEmpty(), ctx.admissionReason.trim())
        }
        val input = ctx.pendingAdmission ?: return
        ctx.admissionsError = null; ctx.confirmation = null
        work({ repo.call("admission_request", JSONObject(input.values.toString()).put("p_key", input.key)) }, { e ->
            ctx.admissionsError = describe(e)
            if (e is DoctorFailure && (e.status in setOf(400, 401, 403, 409, 422) || e.resource == R.string.doc_validation)) ctx.pendingAdmission = null
            rerender()
        }) {
            ctx.resetAdmissionForm(); ctx.confirmation = s(R.string.dx_ad_sent); loadAdmissions()
        }
    }
    private fun card(parent: LinearLayout, a: JSONObject) {
        val state = a.txt("decision") ?: a.value("status")
        val done = state in setOf("asignado", "hospitalizado", "alta_medica", "cerrado"); val rejected = state in setOf("rechazada", "cancelado", "cancelada")
        val card = ui.card(parent, 10)
        val head = ui.hbox(12, card, center = false)
        ui.icon(R.drawable.ic_d_bed, DoctorTheme.wine, 20, head, 42, ui.rounded(DoctorTheme.rose, 12))
        val t = ui.vbox(4, head).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(a.value("patient_name"), DFont.HEADLINE, DoctorTheme.ink, t)
        ui.text(DoctorFormat.display(a.value("ordered_at"), s(R.string.dx_unavailable)), DFont.CAPTION, DoctorTheme.secondary, t)
        statusCapsule(head, status(state), done, rejected)
        val chips = ui.flow(6, card)
        ui.choiceChip(category(a.value("category")), R.drawable.ic_d_bed, false, chips)
        val urgent = a.value("priority") == "urgente"
        ui.choiceChip(priority(a.value("priority")), if (urgent) R.drawable.ic_d_warning else R.drawable.ic_d_clock, urgent, chips)
        val assignment = a.optJSONObject("assignment")
        val place = assignment?.let { "${it.value("room")} · ${it.value("bed")} · ${it.value("floor")}" }
        place?.let { ui.label(it, R.drawable.ic_d_seal, DFont.SUBHEAD_SEMI, DoctorTheme.greenInk, card) }
        detailDisclosure(card, R.string.dx_ad_detail) { box ->
            ui.detail(s(R.string.dx_record), a.txt("record_number") ?: s(R.string.dx_not_available), box)
            ui.detail(s(R.string.dx_ad_requesting_label), a.value("doctor_name"), box)
            ui.detail(s(R.string.dx_ad_reason_label), a.value("reason"), box)
            a.txt("observations")?.let { ui.detail(s(R.string.dx_observations), it, box) }
            a.txt("decision_reason")?.let { ui.detail(s(R.string.dx_ad_reception_answer), it, box) }
            if (assignment != null) {
                ui.detail(s(R.string.dx_ad_room_bed), place!!, box)
                ui.detail(s(R.string.dx_ad_assigned_at), DoctorFormat.display(assignment.value("assigned_at"), s(R.string.dx_unavailable)), box)
            } else ui.text(s(R.string.dx_ad_no_room), DFont.FOOTNOTE, DoctorTheme.secondary, box)
            a.list("history").forEach { e ->
                ui.label("${status(e.txt("decision") ?: e.value("status"))} · ${DoctorFormat.display(e.value("at"), s(R.string.dx_unavailable))}", R.drawable.ic_d_dot, DFont.CAPTION, DoctorTheme.secondary, box)
            }
        }
    }
}

/** Ambulancia: ambulanceView de DoctorModuleView (request_medical_transport y traslados visibles por RLS). */
class DoctorNativeAmbulanceActivity : DoctorRequestActivity() {
    override val screen = "ambulance"
    override val formOpen get() = ctx.transportForm
    override fun onCreate(state: android.os.Bundle?) { super.onCreate(state); if (ready) loadTransports() }
    override fun onPatientPicked() { if (ctx.transportForm) ctx.prefillTransportContact() }
    private fun loadTransports() {
        ctx.transportsError = null
        work({
            val units = (repo.rest("ambulances?select=code,status,active&active=eq.true&order=id") as JSONArray).objects()
            val items = (repo.rest("ambulance_requests?select=id,patient_id,contact_name,contact_phone,pickup_location,destination,reason,priority,status,requested_at,decision_reason,patient:patients(first_name,last_name)&order=requested_at.desc&limit=20") as JSONArray).objects()
            units to items
        }, { ctx.transportsError = describe(it); rerender() }) { (units, items) -> ctx.units = units; ctx.transports = items; rerender() }
    }
    private fun status(v: String) = when (v) { "pendiente" -> s(R.string.dx_tr_pending); "autorizada" -> s(R.string.dx_tr_authorized); "despachada" -> s(R.string.dx_tr_dispatched)
        "finalizada" -> s(R.string.dx_tr_finished); "rechazada" -> s(R.string.dx_tr_rejected); "cancelada" -> s(R.string.dx_tr_cancelled); else -> v }
    private fun unitStatus(v: String) = when (v) { "disponible" -> s(R.string.dx_un_available); "en_servicio" -> s(R.string.dx_un_service); "en_mantenimiento" -> s(R.string.dx_un_maintenance); else -> v }
    override fun render() {
        clear(false)
        moduleTop()
        val box = ui.vbox(16, content)
        heroBlock(box, R.string.dx_tr_upper, R.drawable.ic_d_medical_case, R.string.dx_tr_title, R.string.dx_tr_body)
        ctx.units.forEach { unit ->
            val available = unit.value("status") == "disponible"
            val card = ui.card(box, 0)
            val row = ui.hbox(12, card)
            ui.icon(R.drawable.ic_d_car, DoctorTheme.wine, 20, row, 42, ui.rounded(DoctorTheme.rose, 12))
            val t = ui.vbox(3, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            ui.text(s(R.string.dx_unit, unit.value("code")), DFont.HEADLINE, DoctorTheme.ink, t)
            ui.text(s(if (available) R.string.dx_unit_ready else R.string.dx_unit_wait), DFont.CAPTION, DoctorTheme.secondary, t)
            statusCapsule(row, unitStatus(unit.value("status")), available, false)
        }
        ctx.transportsError?.let { ui.notice(it, box); ui.linkButton(s(R.string.dx_tr_refresh), R.drawable.ic_d_refresh, box) { loadTransports() } }
        if (!ctx.transportForm) gradientButton(box, R.string.dx_tr_new) { ctx.patientQuery = ""; ctx.transportForm = true; ctx.prefillTransportContact(); rerender() }
        else form(box)
        listHeader(box, R.string.dx_tr_mine, R.string.dx_tr_refresh) { loadTransports() }
        val items = ctx.transports.orEmpty()
        if (items.isEmpty() && !busy && ctx.transportsError == null) ui.emptyState(box, R.drawable.ic_d_medical_case, s(R.string.dx_tr_empty), s(R.string.dx_tr_empty_body))
        items.forEach { card(box, it) }
    }
    private var submitHolder: LinearLayout? = null
    private fun form(parent: LinearLayout) {
        val card = ui.card(parent, 18)
        formHeader(card, R.string.dx_tr_form_title) { ctx.resetTransportForm(); rerender() }
        val pending = ctx.pendingTransport
        pending?.let { p -> pendingBox(card, listOf("${p.label} · ${p.values.value("p_origin")} → ${p.values.value("p_destination")}" to DFont.CAPTION_SEMI)) }
        val locked = pending != null
        patientStep(card, R.string.dx_tr_patient, R.string.dx_tr_search_a11y, pending?.label, null)
        ui.divider(card)
        val route = ui.vbox(14, card)
        ui.blockHeader(route, R.drawable.ic_d_map, s(R.string.dx_tr_route), s(R.string.dx_tr_route_sub), "2")
        ui.labeledField(route, s(R.string.dx_tr_origin), s(R.string.dx_tr_origin_ph), ctx.transportOrigin) { ctx.transportOrigin = it; paintSubmit() }.isEnabled = !locked
        ui.labeledField(route, s(R.string.dx_tr_destination), s(R.string.dx_tr_destination_ph), ctx.transportDestination) { ctx.transportDestination = it; paintSubmit() }.isEnabled = !locked
        ui.text(s(R.string.doc_priority), DFont.SUBHEAD_SEMI, DoctorTheme.ink, route)
        ui.segmented(route, listOf("normal" to s(R.string.desk_normal), "urgente" to s(R.string.desk_urgent)), ctx.transportPriority) { if (!locked) { ctx.transportPriority = it; paintSubmit() } }
        ui.divider(card)
        val contact = ui.vbox(14, card)
        ui.blockHeader(contact, R.drawable.ic_d_phone, s(R.string.dx_tr_contact), s(R.string.dx_tr_contact_sub), "3")
        ui.labeledField(contact, s(R.string.dx_tr_person), s(R.string.dx_tr_person_ph), ctx.transportContact, max = 200) { ctx.transportContact = it; paintSubmit() }.isEnabled = !locked
        ui.labeledField(contact, s(R.string.dx_tr_phone), s(R.string.dx_phone), ctx.transportPhone, phone = true, max = 50) { ctx.transportPhone = it; paintSubmit() }.isEnabled = !locked
        noteField(contact, R.drawable.ic_d_medical_case, s(R.string.dx_tr_reason), s(R.string.dx_tr_reason_ph), ctx.transportReason) { ctx.transportReason = it; paintSubmit() }.isEnabled = !locked
        submitHolder = ui.vbox(0, card); paintSubmit()
    }
    private fun paintSubmit() {
        val box = submitHolder ?: return
        box.removeAllViews()
        ui.primaryButton(s(if (ctx.pendingTransport == null) R.string.dx_tr_submit else R.string.dx_retry_same), R.drawable.ic_d_send, box, ctx.canRequestTransport) {
            confirm(s(R.string.dx_tr_confirm_title), s(R.string.dx_tr_confirm_body), listOf(s(R.string.dx_tr_confirm) to { request() }))
        }
    }
    private fun request() {
        if (!ctx.canRequestTransport) return
        if (ctx.pendingTransport == null) {
            val patient = ctx.patientId ?: return
            ctx.pendingTransport = DoctorPending("transport", args("p_patient" to patient, "p_contact" to ctx.transportContact.trim(), "p_phone" to ctx.transportPhone.trim(),
                "p_origin" to ctx.transportOrigin.trim(), "p_destination" to ctx.transportDestination.trim(), "p_reason" to ctx.transportReason.trim(), "p_priority" to ctx.transportPriority),
                DoctorNativeContext.uuid(), ctx.selectedPatient?.txt("full_name") ?: ctx.selectedAppointment?.value("patient_name").orEmpty())
        }
        val input = ctx.pendingTransport ?: return
        ctx.transportsError = null; ctx.confirmation = null
        work({ repo.rest("rpc/request_medical_transport", "POST", JSONObject(input.values.toString()).put("p_key", input.key)) }, { e ->
            ctx.transportsError = describe(e)
            if (e is DoctorFailure && (e.status in setOf(400, 401, 403, 409, 422) || e.resource == R.string.doc_validation)) ctx.pendingTransport = null
            rerender()
        }) { ctx.resetTransportForm(); ctx.confirmation = s(R.string.dx_tr_sent); loadTransports() }
    }
    private fun card(parent: LinearLayout, item: JSONObject) {
        val done = item.value("status") in setOf("despachada", "finalizada"); val closed = item.value("status") in setOf("rechazada", "cancelada")
        val card = ui.card(parent, 10)
        val head = ui.hbox(12, card, center = false)
        ui.icon(R.drawable.ic_d_medical_case, DoctorTheme.wine, 20, head, 42, ui.rounded(DoctorTheme.rose, 12))
        val t = ui.vbox(4, head).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val patient = item.optJSONObject("patient")
        val name = listOfNotNull(patient?.txt("first_name"), patient?.txt("last_name")).joinToString(" ").ifBlank { item.value("contact_name") }
        ui.text(name, DFont.HEADLINE, DoctorTheme.ink, t)
        ui.text(DoctorFormat.display(item.value("requested_at"), s(R.string.dx_unavailable)), DFont.CAPTION, DoctorTheme.secondary, t)
        statusCapsule(head, status(item.value("status")), done, closed)
        ui.label("${item.value("pickup_location")} → ${item.txt("destination") ?: s(R.string.dx_tr_destination_tbd)}", R.drawable.ic_d_map, DFont.SUBHEAD, DoctorTheme.ink, card)
        if (item.value("priority") == "urgente") ui.flow(6, card).also { ui.choiceChip(s(R.string.desk_urgent), R.drawable.ic_d_warning, true, it) }
        detailDisclosure(card, R.string.dx_tr_detail) { box ->
            ui.detail(s(R.string.dx_reason), item.value("reason"), box)
            ui.detail(s(R.string.doc_contact), "${item.value("contact_name")} · ${item.value("contact_phone")}", box)
            item.txt("decision_reason")?.let { ui.detail(s(R.string.dx_tr_admin_answer), it, box) }
        }
    }
}
