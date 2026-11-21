package sv.edu.catolica.hospital_universitario

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject

// ---------- Directorio y laboratorio del paciente (DoctorViewModel) ----------
fun DoctorNativeActivity.loadPatients(more: Boolean = false, done: () -> Unit) {
    val query = ctx.patientQuery.trim()
    if (query.length > 120) { ctx.directoryError = s(R.string.dx_search_limit); return done() }
    if (!more) { ctx.lastDirectoryQuery = query; ctx.directory = emptyList(); ctx.directoryPage = null }
    ctx.directoryError = null
    val offset = if (more) ctx.directoryPage?.optInt("next_offset") ?: 0 else 0
    work({ repo.patients(query, offset) }, { ctx.directoryError = describe(it); done() }) { page ->
        if (query != ctx.patientQuery.trim()) return@work done()
        ctx.directory = if (more) ctx.directory + page.list("patients") else page.list("patients"); ctx.directoryPage = page; done()
    }
}
fun DoctorNativeActivity.loadPatientLabs(more: Boolean = false, done: () -> Unit) {
    val patient = ctx.patientId ?: return done()
    ctx.patientLabsError = null
    if (!more) { ctx.patientLabs = emptyList(); ctx.patientLabPage = null; ctx.stays = null; ctx.staysError = null }
    val offset = if (more) ctx.patientLabPage?.optInt("next_offset") ?: 0 else 0
    work({
        val stays = if (more) null else runCatching { DoctorStays.present(repo.call("patient_hospitalizations", args("p_patient" to patient)) as? JSONArray) }
        stays to runCatching { repo.call("patient_labs", args("p_patient" to patient, "p_offset" to offset)) as JSONObject }
    }) { (stays, labs) ->
        if (ctx.patientId != patient) return@work done()
        stays?.onSuccess { ctx.stays = it }?.onFailure { e ->
            ctx.staysError = if (e is DoctorFailure && (e.resource == R.string.doc_contract_missing || e.status == 404)) s(R.string.dx_stays_pending) else describe(e)
        }
        labs.onSuccess { page -> ctx.patientLabs = if (more) ctx.patientLabs + page.list("items") else page.list("items"); ctx.patientLabPage = page }
            .onFailure { ctx.patientLabsError = describe(it) }
        done()
    }
}
fun DoctorNativeActivity.loadOwnLabOrders(more: Boolean = false, done: () -> Unit) {
    ctx.ownLabsError = null
    val offset = if (more) ctx.ownLabPage?.optInt("next_offset") ?: 0 else 0
    work({ repo.call("lab_orders", args("p_offset" to offset)) as JSONObject }, { ctx.ownLabs = emptyList(); ctx.ownLabsError = describe(it); done() }) { page ->
        ctx.ownLabs = if (more) ctx.ownLabs + page.list("items") else page.list("items"); ctx.ownLabPage = page; done()
    }
}
/** ClinicalLabStateBadge */
fun DoctorNativeActivity.labStateBadge(parent: LinearLayout, status: String) {
    when (status) {
        "pendiente" -> ui.pill(s(R.string.dx_lab_pending), R.drawable.ic_d_clock, DoctorTheme.wine, DoctorTheme.warnFill, DFont.CAPTION_SEMI, parent, 10, 6)
        "en_proceso" -> ui.pill(s(R.string.dx_lab_processing), R.drawable.ic_d_refresh, DoctorTheme.wine, DoctorTheme.blueFill, DFont.CAPTION_SEMI, parent, 10, 6)
        "completado" -> ui.pill(s(R.string.dx_lab_completed), R.drawable.ic_d_check_circle, DoctorTheme.wine, DoctorTheme.green, DFont.CAPTION_SEMI, parent, 10, 6)
        else -> ui.text(s(DoctorRules.genericStatus(status)), DFont.CAPTION, DoctorTheme.ink, parent)
    }
}
fun DoctorNativeActivity.labOrderCard(parent: LinearLayout, order: JSONObject) {
    val card = ui.card(parent, 10)
    val published = order.txt("result_summary") != null
    val head = ui.hbox(12, card, center = false)
    ui.icon(if (published) R.drawable.ic_d_seal else R.drawable.ic_d_testtube, if (published) DoctorTheme.greenInk else DoctorTheme.wine, 20, head, 42,
        ui.rounded(if (published) DoctorTheme.green else DoctorTheme.rose, 12))
    val t = ui.vbox(3, head).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
    ui.text(order.value("test_name"), DFont.HEADLINE, DoctorTheme.ink, t)
    order.txt("patient_name")?.let { ui.text(it, DFont.SUBHEAD, DoctorTheme.alpha(DoctorTheme.ink, 0.85f), t) }
    ui.text(DoctorFormat.display(order.value("ordered_at"), s(R.string.dx_unavailable)), DFont.CAPTION, DoctorTheme.secondary, t)
    labStateBadge(head, order.value("status"))
    ui.disclosure(card, s(R.string.dx_view_test_detail), DFont.SUBHEAD_SEMI, DoctorTheme.wine) { body ->
        val box = ui.vbox(10, body)
        order.txt("record_number")?.let { ui.detail(s(R.string.dx_record), it, box) }
        ui.detail(s(R.string.dx_reason_instructions), order.value("reason"), box)
        order.txt("result_summary")?.let { summary ->
            val result = ui.vbox(4, box).apply { background = ui.rounded(DoctorTheme.green, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
            ui.text(s(R.string.dx_result_published), DFont.CAPTION_SEMI, DoctorTheme.greenInk, result)
            ui.text(summary, DFont.SUBHEAD, DoctorTheme.ink, result)
            order.list("parameters").forEach { p ->
                val row = ui.vbox(3, box).apply { background = ui.rounded(DoctorTheme.background, 10); setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10)) }
                val line = ui.hbox(8, row)
                ui.text(p.value("label"), DFont.CAPTION_SEMI, DoctorTheme.secondary, line).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                ui.text(listOfNotNull(p.txt("value"), p.txt("unit")).joinToString(" "), DFont.SUBHEAD_BOLD, DoctorTheme.ink, line).fontFeatureSettings = "tnum"
                p.txt("reference")?.let { ui.text(s(R.string.dx_lab_reference, it), DFont.CAPTION2, DoctorTheme.secondary, row) }
                p.txt("observation")?.let { ui.text(s(R.string.dx_lab_observation, it), DFont.CAPTION2, DoctorTheme.secondary, row) }
            }
            order.txt("published_at")?.let { ui.label(s(R.string.dx_published_on, DoctorFormat.display(it, it)), R.drawable.ic_d_calendar, DFont.CAPTION, DoctorTheme.secondary, box) }
        } ?: ui.label(s(R.string.dx_lab_processing_long), R.drawable.ic_d_hourglass, DFont.FOOTNOTE, DoctorTheme.secondary, box)
    }
}

// ======================================================================
// Expedientes (DoctorRecordsView): pantallas iOS «patients» y «chart»
// ======================================================================

open class DoctorNativePatientsActivity : DoctorNativeActivity() {
    override val screen = "patients"
    private val debounce = Handler(Looper.getMainLooper())
    private var showHistory = false
    private var historyLimit = DoctorRules.HISTORY_PAGE
    private var openedFor: String? = null
    private var listHolder: LinearLayout? = null

    override fun onCreate(state: android.os.Bundle?) {
        super.onCreate(state)
        if (!ready) return
        ctx.adoptAppointmentPatient()
        if (ctx.selectedPatient == null && (ctx.directoryPage == null || ctx.lastDirectoryQuery != ctx.patientQuery.trim())) loadPatients { rerender() }
    }
    override fun onPoll() { if (ctx.selectedPatient != null && !busy) loadChart(silent = true) { rerender() } }
    override fun render() {
        clear(false)
        moduleTop()
        if (ctx.workspace == null && error != null) return
        val patient = ctx.selectedPatient
        if (patient == null) searchScreen() else record(patient)
    }

    // ---------- Búsqueda ----------
    private fun searchScreen() {
        val box = ui.vbox(16, content)
        val hero = ui.hero(box, 10, 24)
        ui.label(s(R.string.dx_records_upper), R.drawable.ic_d_folder, DFont.CAPTION_BOLD, Color.WHITE, hero, tracking = 1.2f)
        ui.text(s(R.string.dx_records_title), DFont.TITLE2, Color.WHITE, hero)
        ui.text(s(R.string.dx_records_body), DFont.SUBHEAD, Color.WHITE, hero, alpha = 0.9f)
        lateinit var input: EditText
        input = ui.searchField(box, s(R.string.dx_records_search), ctx.patientQuery, Color.WHITE, DoctorTheme.rose, 1.5f, 58, 18, busy && ctx.directory.isEmpty(), 20) {
            ctx.patientQuery = it
            debounce.removeCallbacksAndMessages(null)
            debounce.postDelayed({ if (ctx.patientQuery.trim() != ctx.lastDirectoryQuery || ctx.directoryError != null) loadPatients { fill() } }, 350)
        }
        input.contentDescription = s(R.string.dx_records_search_a11y)
        (input.parent as View).apply { elevation = ui.dpf(2f) }
        input.setOnFocusChangeListener { _, focus -> (input.parent as View).background = ui.rounded(Color.WHITE, 18, if (focus) DoctorTheme.wine else DoctorTheme.rose, if (focus) 2f else 1.5f) }
        listHolder = ui.vbox(16, box)
        fill()
    }
    private fun fill() {
        val box = listHolder ?: return
        box.removeAllViews()
        val page = ctx.directoryPage
        val q = ctx.patientQuery.trim()
        if (page != null && ctx.directoryError == null) {
            val total = page.optInt("total")
            ui.text(if (q.isEmpty()) s(R.string.dx_authorized_count, total) else resources.getQuantityString(R.plurals.dx_results_for, total, total, q),
                DFont.SUBHEAD_SEMI, DoctorTheme.secondary, box)
        }
        ctx.directoryError?.let { ui.notice(it, box); ui.linkButton(s(R.string.dx_retry_search), R.drawable.ic_d_refresh, box) { loadPatients { fill() } } }
        if (busy && ctx.directory.isEmpty()) ui.progress(box, s(R.string.dx_searching_records)).setPadding(0, ui.dp(24), 0, ui.dp(24))
        else if (ctx.directory.isEmpty() && page != null && ctx.directoryError == null)
            ui.emptyState(box, R.drawable.ic_d_person, s(R.string.dx_no_matches), s(if (q.isEmpty()) R.string.dx_no_assigned else R.string.dx_no_authorized_match), big = true)
        val list = ui.vbox(12, box)
        ctx.directory.forEach { resultCard(list, it) }
        if (page?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_more_results), null, box) { loadPatients(true) { fill() } }
    }
    private fun resultCard(parent: LinearLayout, p: JSONObject) {
        val card = ui.hbox(14, parent).apply { background = ui.rounded(Color.WHITE, 18, DoctorTheme.rose); setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }
        ui.circleText(DoctorRules.initials(p.value("full_name")), 52, DoctorTheme.wine, DoctorTheme.rose, DFont.HEADLINE, card)
        val t = ui.vbox(7, card).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(p.value("full_name"), DFont.HEADLINE, DoctorTheme.ink, t)
        val flow = ui.flow(6, t)
        p.txt("patient_code")?.let { ui.pill(s(R.string.dx_code, it), R.drawable.ic_d_number, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION_SEMI, flow, 9, 4) }
        p.txt("record_number")?.let { ui.pill(s(R.string.dx_exp_short, it), R.drawable.ic_d_folder, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION_SEMI, flow, 9, 4) }
        p.txt("dui")?.let { ui.pill(s(R.string.dx_dui_value, it), R.drawable.ic_d_idcard, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION_SEMI, flow, 9, 4) }
        if (!p.isNull("age") && p.has("age")) ui.pill(s(R.string.dx_years, p.optInt("age")), R.drawable.ic_d_calendar, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION_SEMI, flow, 9, 4)
        val states = ui.flow(6, t)
        val linked = p.txt("record_number") != null
        ui.statusPill(s(if (linked) R.string.dx_record_active else R.string.dx_no_record_linked), if (linked) R.drawable.ic_d_seal else R.drawable.ic_d_info, linked, states)
        if (p.txt("active_encounter_id") != null) ui.statusPill(s(R.string.dx_st_in_consult), R.drawable.ic_d_stethoscope, true, states)
        ui.icon(R.drawable.ic_d_chevron_right, DoctorTheme.wine, 16, card)
        card.contentDescription = s(R.string.dx_open_record_a11y, p.value("full_name"))
        ui.clickable(card) {
            if (ctx.rxLines.length() > 0 || ctx.pendingLabs != null) { error = s(R.string.doc_pending); rerender(); return@clickable }
            ctx.openPatient(p); showHistory = false; historyLimit = DoctorRules.HISTORY_PAGE; openedFor = null; rerender()
        }
    }

    // ---------- Expediente ----------
    private fun record(patient: JSONObject) {
        val id = patient.value("id")
        if (openedFor != id) { openedFor = id; loadChart { loadPatientLabs { rerender() } } }
        val chart = ctx.chart?.takeIf { it.optJSONObject("patient")?.value("id") == id }
        val box = ui.vbox(18, content)
        ui.linkButton(s(R.string.dx_back_to_search), R.drawable.ic_d_chevron_left, box, DFont.SUBHEAD_SEMI) { ctx.select(null); openedFor = null; rerender() }
        header(box, patient, chart)
        if (chart == null && busy) { ui.progress(box, s(R.string.dx_loading_record)).setPadding(0, ui.dp(20), 0, ui.dp(20)); return }
        if (chart == null) {
            if (error == null) {
                ui.emptyState(box, R.drawable.ic_d_folder, s(R.string.dx_record_unavailable_title), s(R.string.dx_record_unavailable_body), big = true)
                ui.linkButton(s(R.string.dx_retry), R.drawable.ic_d_refresh, box) { loadChart { rerender() } }
            }
            return
        }
        clinicalSummary(box, chart)
        hospitalizations(box)
        actions(box, patient)
        historyButton(box, chart)
        if (showHistory) history(box, chart)
    }
    private fun header(parent: LinearLayout, patient: JSONObject, chart: JSONObject?) {
        val cp = chart?.optJSONObject("patient")
        val hero = ui.hero(parent, 16, 24)
        val row = ui.hbox(14, hero)
        ui.circleText(DoctorRules.initials(patient.value("full_name")), 72, DoctorTheme.wine, Color.WHITE, DFont.TITLE, row, ring = true)
        val t = ui.vbox(5, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(s(R.string.dx_clinical_record_upper), DFont.CAPTION2_HEAVY, Color.WHITE, t, tracking = 1.2f, alpha = 0.8f)
        ui.text(cp?.txt("full_name") ?: patient.value("full_name"), DFont.TITLE2, Color.WHITE, t)
        val flow = ui.flow(8, hero)
        val code = cp?.txt("patient_code") ?: patient.txt("patient_code")
        val record = cp?.txt("record_number") ?: patient.txt("record_number")
        code?.let { ui.headerPill(s(R.string.dx_code, it), R.drawable.ic_d_number, flow) }
        ui.headerPill(record?.let { s(R.string.dx_record_value, it) } ?: s(R.string.dx_no_record), R.drawable.ic_d_folder, flow)
        if (patient.has("age") && !patient.isNull("age")) ui.headerPill(s(R.string.dx_years, patient.optInt("age")), R.drawable.ic_d_person, flow)
        if (patient.txt("active_encounter_id") != null) ui.headerPill(s(R.string.dx_st_in_consult), R.drawable.ic_d_stethoscope, flow)
        val birth = (cp?.txt("birth_date") ?: patient.txt("birth_date"))?.let { raw ->
            runCatching { DoctorFormat.longDate(java.time.LocalDate.parse(raw.take(10))) }.getOrDefault(raw)
        }
        val rows = listOf(Triple(R.drawable.ic_d_calendar, R.string.dx_birth, birth), Triple(R.drawable.ic_d_idcard, R.string.dx_dui, cp?.txt("identification") ?: patient.txt("dui")),
            Triple(R.drawable.ic_d_phone, R.string.dx_phone, cp?.txt("phone") ?: patient.txt("phone")), Triple(R.drawable.ic_d_mail, R.string.dx_email, cp?.txt("email") ?: patient.txt("email")),
            Triple(R.drawable.ic_d_pin, R.string.dx_city, cp?.txt("address"))).filter { it.third != null }
        if (rows.isNotEmpty()) ui.grid(hero, rows.map { (icon, label, value) -> { cell: LinearLayout ->
            ui.hbox(8, cell, center = false).apply {
                background = ui.rounded(DoctorTheme.alpha(Color.WHITE, 0.14f), 12); setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10))
                ui.icon(icon, Color.WHITE, 14, this, 18)
                val v = ui.vbox(2, this).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
                ui.text(s(label), DFont.CAPTION2, Color.WHITE, v, alpha = 0.8f)
                ui.text(value!!, DFont.FOOTNOTE_SEMI, Color.WHITE, v).setTextIsSelectable(true)
            }
        } })
    }
    private fun clinicalSummary(parent: LinearLayout, chart: JSONObject) {
        val grouped = setOf("alergia", "alergias", "condicion", "enfermedad")
        val others = chart.strings("medical_history").filter { it.substringBefore(":").trim().lowercase() !in grouped }
        val groups = listOf(Triple(R.drawable.ic_d_warning, R.string.dx_allergies, chart.strings("allergies")), Triple(R.drawable.ic_d_heart, R.string.dx_conditions, chart.strings("conditions")),
            Triple(R.drawable.ic_d_clipboard, R.string.dx_other_history, others), Triple(R.drawable.ic_d_pills, R.string.dx_meds_registered, chart.strings("medications"))).filter { it.third.isNotEmpty() }
        val card = ui.card(parent, 14)
        ui.blockHeader(card, R.drawable.ic_d_medical_case, s(R.string.dx_clinical_info), s(R.string.dx_clinical_info_sub))
        val blood = chart.txt("blood_type")
        blood?.let { summaryRow(card, R.drawable.ic_d_drop, s(R.string.dx_blood), listOf(it)) }
        if (groups.isEmpty() && blood == null) ui.text(s(R.string.dx_no_history), DFont.SUBHEAD, DoctorTheme.secondary, card)
        groups.forEach { (icon, title, values) -> summaryRow(card, icon, s(title), values) }
    }
    private fun summaryRow(parent: LinearLayout, icon: Int, title: String, values: List<String>) {
        val row = ui.hbox(12, parent, center = false)
        ui.icon(icon, DoctorTheme.wine, 16, row, 32, ui.rounded(DoctorTheme.rose, 9))
        val t = ui.vbox(4, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(title, DFont.CAPTION_SEMI, DoctorTheme.secondary, t)
        values.forEach { ui.text(it, DFont.SUBHEAD, DoctorTheme.ink, t) }
    }
    private fun hospitalizations(parent: LinearLayout) {
        val card = ui.vbox(10, parent).apply { background = ui.rounded(Color.WHITE, 18); setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }
        ui.label(s(R.string.dx_hospitalization), R.drawable.ic_d_bed, DFont.HEADLINE, DoctorTheme.ink, card)
        val stays = ctx.stays
        when {
            ctx.staysError != null -> ui.text(ctx.staysError!!, DFont.FOOTNOTE, DoctorTheme.secondary, card)
            stays != null -> {
                val list = listOfNotNull(stays.first) + stays.second
                if (list.isEmpty()) ui.text(s(R.string.dx_no_stays), DFont.FOOTNOTE, DoctorTheme.secondary, card)
                list.forEach { stay(card, it) }
            }
            else -> ui.progress(card, s(R.string.dx_loading_stays))
        }
    }
    private fun stay(parent: LinearLayout, r: JSONObject) {
        val assignments = r.list("assignments")
        val current = assignments.lastOrNull { it.txt("released_at") == null } ?: assignments.lastOrNull()
        val kind = (current?.txt("room_kind") ?: r.txt("requested_kind"))?.let { k -> when (k) { "vip" -> "VIP"; "semiprivada" -> s(R.string.desk_semi); "privada" -> s(R.string.dx_private); else -> k.replaceFirstChar { it.uppercase() } } }
        val room = current?.txt("room")?.let { s(R.string.dx_room_n, it) } ?: s(R.string.dx_room_tbd)
        val admitted = DoctorRules.local(assignments.firstOrNull()?.txt("assigned_at") ?: r.txt("ordered_at"))
        val discharged = DoctorRules.local(r.txt("discharged_at"))
        val box = ui.vbox(4, parent).apply { background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
        val head = ui.hbox(8, box)
        ui.text(listOfNotNull(room, kind).joinToString(" · "), DFont.SUBHEAD_SEMI, DoctorTheme.ink, head).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.badge(stayStatus(r.value("status")), false, head)
        fun stamp(t: java.time.ZonedDateTime) = DoctorFormat.longDate(t.toLocalDate()) + " · " + DoctorFormat.time(t, "")
        admitted?.let { ui.text(s(R.string.dx_admitted, stamp(it)), DFont.CAPTION, DoctorTheme.secondary, box) }
        discharged?.let { ui.text(s(R.string.dx_discharged, stamp(it)), DFont.CAPTION, DoctorTheme.secondary, box) }
        r.txt("doctor_name")?.let { ui.text(s(R.string.dx_responsible_value, it), DFont.CAPTION, DoctorTheme.secondary, box) }
    }
    private fun stayStatus(v: String) = s(when (v) { "solicitado" -> R.string.dx_stay_requested; "asignado" -> R.string.dx_stay_assigned; "hospitalizado" -> R.string.dx_stay_hospitalized
        "alta_medica", "cerrado" -> R.string.dx_stay_discharged; "cancelado" -> R.string.desk_admission_cancelled; else -> R.string.dx_g_unknown })
    private fun actions(parent: LinearLayout, patient: JSONObject) {
        val buttons = mutableListOf<Triple<Int, Int, () -> Unit>>()
        if (patient.txt("active_encounter_id") != null) buttons.add(Triple(R.drawable.ic_d_stethoscope, R.string.dx_continue_consult_short) { go("consultation") })
        buttons.add(Triple(R.drawable.ic_d_testtube, R.string.doc_labs) { go("laboratory") })
        buttons.add(Triple(R.drawable.ic_d_bed, R.string.doc_request_admission) { ctx.admissionForm = true; go("admissions") })
        val box = if (buttons.size > 2) ui.vbox(10, parent) else ui.hbox(10, parent)
        buttons.forEach { (icon, title, run) ->
            ui.borderedButton(s(title), icon, box, onClick = run).apply { if (buttons.size <= 2) layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        }
    }
    private fun historyButton(parent: LinearLayout, chart: JSONObject) {
        val count = DoctorRules.finishedHistory(chart.list("history")).size
        val row = ui.hbox(12, parent).apply { background = ui.gradient(18); minimumHeight = ui.dp(64); setPadding(ui.dp(18), ui.dp(10), ui.dp(18), ui.dp(10)) }
        ui.icon(R.drawable.ic_d_clock, Color.WHITE, 22, row)
        val t = ui.vbox(2, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(s(if (showHistory) R.string.dx_hide_history else R.string.dx_show_history), DFont.HEADLINE, Color.WHITE, t)
        ui.text(if (count == 0) s(R.string.dx_no_finished_consults) else resources.getQuantityString(R.plurals.dx_finished_consults, count, count), DFont.CAPTION, Color.WHITE, t, alpha = 0.9f)
        ui.icon(if (showHistory) R.drawable.ic_d_chevron_up else R.drawable.ic_d_chevron_down, Color.WHITE, 18, row)
        row.contentDescription = s(R.string.dx_history_hint)
        ui.clickable(row) { showHistory = !showHistory; rerender() }
    }
    private fun history(parent: LinearLayout, chart: JSONObject) {
        val entries = DoctorRules.finishedHistory(chart.list("history"))
        val card = ui.card(parent, 14)
        ui.blockHeader(card, R.drawable.ic_d_clipboard, s(R.string.dx_medical_history), s(R.string.dx_medical_history_sub))
        if (entries.isEmpty()) ui.emptyState(card, R.drawable.ic_d_doc, s(R.string.dx_no_history_yet), s(R.string.dx_no_history_yet_body), big = true)
        val shown = entries.take(historyLimit)
        shown.forEachIndexed { i, e -> timelineCard(card, e, i == shown.size - 1) }
        if (entries.size > historyLimit) ui.linkButton(s(R.string.dx_show_older, entries.size - historyLimit), null, card) { historyLimit += DoctorRules.HISTORY_PAGE; rerender() }
    }
    private fun doctorName(entry: JSONObject) = entry.txt("doctor_name") ?: ctx.workspace?.txt("doctor_name") ?: s(R.string.dx_responsible)
    private fun timelineCard(parent: LinearLayout, entry: JSONObject, last: Boolean) {
        val date = DoctorRules.local(entry.value("started_at"))
        val row = ui.hbox(12, parent, center = false)
        val rail = ui.vbox(0, row).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(12), -1); gravity = android.view.Gravity.CENTER_HORIZONTAL; setPadding(0, ui.dp(6), 0, 0) }
        View(this).apply { background = ui.oval(DoctorTheme.wine, DoctorTheme.rose, 3); rail.addView(this, LinearLayout.LayoutParams(ui.dp(12), ui.dp(12))) }
        if (!last) View(this).apply { setBackgroundColor(DoctorTheme.rose); rail.addView(this, LinearLayout.LayoutParams(ui.dp(2), 0, 1f)) }
        val un = s(R.string.dx_unavailable)
        val card = ui.vbox(10, row).apply {
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { bottomMargin = if (last) 0 else ui.dp(6) }
            background = ui.rounded(DoctorTheme.background, 16); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14))
        }
        val head = ui.hbox(8, card)
        ui.text(DoctorFormat.date(date, un), DFont.SUBHEAD_BOLD, DoctorTheme.ink, head).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.text(DoctorFormat.time(date, un), DFont.CAPTION_SEMI, DoctorTheme.wine, head)
        val who = ui.flow(6, card)
        ui.label(doctorName(entry), R.drawable.ic_d_stethoscope, DFont.CAPTION, DoctorTheme.secondary, who)
        entry.txt("specialty")?.let { ui.text("· $it", DFont.CAPTION, DoctorTheme.secondary, who) }
        listOf(R.string.dx_reason to entry.txt("reason"), R.string.dx_f_diagnosis to entry.txt("assessment"),
            R.string.dx_observations to entry.txt("objective"), R.string.dx_treatment to entry.txt("plan")).forEach { (label, value) ->
            if (value != null) ui.vbox(2, card).apply {
                ui.text(s(label), DFont.CAPTION2_SEMI, DoctorTheme.secondary, this); ui.text(value, DFont.FOOTNOTE, DoctorTheme.ink, this, lines = 3)
            }
        }
        val more = ui.hbox(0, card); ui.spacerView(more)
        ui.label(s(R.string.dx_view_detail), R.drawable.ic_d_chevron_right, DFont.CAPTION_BOLD, DoctorTheme.wine, more)
        card.contentDescription = s(R.string.dx_consult_of_a11y, DoctorFormat.date(date, un), DoctorFormat.time(date, un))
        ui.clickable(card) { detail(entry) }
    }
    private fun detail(entry: JSONObject) {
        val date = DoctorRules.local(entry.value("started_at"))
        val un = s(R.string.dx_unavailable)
        sheet(s(R.string.dx_ticket_title), null, s(R.string.dx_close)) { body, _ ->
            val hero = ui.hero(body, 8, 20, 18)
            ui.label(s(R.string.dx_finished_readonly), R.drawable.ic_d_lock, DFont.CAPTION2_HEAVY, Color.WHITE, hero, alpha = 0.85f)
            ctx.chart?.optJSONObject("patient")?.txt("full_name")?.let { ui.text(it, DFont.TITLE3, Color.WHITE, hero) }
            ui.text(DoctorFormat.date(date, un), DFont.SUBHEAD_SEMI, Color.WHITE, hero)
            val end = DoctorRules.local(entry.txt("ended_at"))
            val range = if (date != null && end != null) "${DoctorFormat.time(date, un)} – ${DoctorFormat.time(end, un)} · ${s(R.string.dx_minutes_short, maxOf(0, java.time.Duration.between(date, end).toMinutes()))}" else DoctorFormat.time(date, un)
            ui.label(range, R.drawable.ic_d_clock, DFont.SUBHEAD, Color.WHITE, hero)
            ui.label(doctorName(entry), R.drawable.ic_d_stethoscope, DFont.SUBHEAD, Color.WHITE, hero)
            entry.txt("specialty")?.let { ui.label(it, R.drawable.ic_d_medical_case, DFont.SUBHEAD, Color.WHITE, hero) }
            entry.txt("reason")?.let { ui.label(s(R.string.dx_reason_value, it), R.drawable.ic_d_chat, DFont.SUBHEAD, Color.WHITE, hero) }
            val reported = entry.strings("reported_symptoms")
            if (reported.isNotEmpty() || entry.txt("reported_other") != null) {
                val c = ui.card(body, 10)
                ui.blockHeader(c, R.drawable.ic_d_person, s(R.string.dx_initial_symptoms), s(R.string.dx_initial_symptoms_sub))
                reportedSymptoms(c, reported, entry.txt("reported_other"))
            }
            val vitals = DoctorRules.recordedVitals.mapNotNull { (key, label, unit) -> entry.optJSONObject("vitals")?.txt(key)?.let { Triple(label, unit, it) } }
            if (vitals.isNotEmpty()) {
                val c = ui.card(body, 12)
                ui.blockHeader(c, R.drawable.ic_d_person, s(R.string.dx_physical), s(R.string.dx_physical_recorded))
                ui.grid(c, vitals.map { (label, unit, value) -> { cell: LinearLayout -> ui.vbox(4, cell).apply {
                    background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
                    ui.text(s(label), DFont.CAPTION, DoctorTheme.secondary, this)
                    ui.text("$value $unit", DFont(20f, 1), DoctorTheme.ink, this).fontFeatureSettings = "tnum"
                } } })
                DoctorRules.bmi(entry.optJSONObject("vitals"))?.let { ui.text(s(R.string.dx_bmi_calc_value, it), DFont.FOOTNOTE_SEMI, DoctorTheme.wine, c) }
            }
            val eval = ui.card(body, 12)
            ui.blockHeader(eval, R.drawable.ic_d_stethoscope, s(R.string.dx_evaluation), s(R.string.dx_saved_at_finish))
            fun section(label: Int, value: String) = ui.vbox(4, eval).apply {
                background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
                ui.text(s(label), DFont.CAPTION_SEMI, DoctorTheme.secondary, this); ui.text(value, DFont.BODY, DoctorTheme.ink, this).setTextIsSelectable(true)
            }
            entry.txt("subjective")?.let { section(R.string.dx_symptoms, it) }
            entry.txt("assessment")?.let { section(R.string.dx_f_diagnosis, it + (entry.txt("diagnosis_code")?.let { c -> "\n" + s(R.string.dx_code_line, c) } ?: "")) }
            entry.txt("objective")?.let { section(R.string.dx_observations, it) }
            entry.txt("plan")?.let { section(R.string.dx_treatment, it) }
            val all = ctx.chart?.list("prescriptions").orEmpty()
            val rx = all.filter { it.value("encounter_id") == entry.value("id") }
            val rxCard = ui.card(body, 12)
            ui.blockHeader(rxCard, R.drawable.ic_d_pills, s(R.string.doc_rx), s(R.string.dx_rx_in_consult))
            if (rx.isEmpty()) ui.text(s(if (all.isNotEmpty() && all.all { it.txt("encounter_id") == null }) R.string.dx_rx_unlinked else R.string.dx_no_rx_consult), DFont.FOOTNOTE, DoctorTheme.secondary, rxCard)
            rx.forEach { p ->
                val box = ui.vbox(6, rxCard).apply { background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
                val h = ui.hbox(8, box)
                ui.text(p.value("code"), DFont.SUBHEAD_BOLD, DoctorTheme.ink, h).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                ui.text(if (p.value("status") == "pendiente") s(R.string.dx_pending_delivery) else p.value("status").replaceFirstChar { it.uppercase() }, DFont.CAPTION_BOLD, DoctorTheme.wine, h)
                p.strings("lines").forEach { ui.label(it, R.drawable.ic_d_pills, DFont.FOOTNOTE, DoctorTheme.ink, box) }
            }
            val labs = ctx.patientLabs.filter { it.value("encounter_id") == entry.value("id") }
            val labCard = ui.card(body, 12)
            ui.blockHeader(labCard, R.drawable.ic_d_testtube, s(R.string.dx_exams), s(R.string.dx_exams_in_consult))
            if (labs.isEmpty()) ui.text(s(R.string.dx_no_exams_consult), DFont.FOOTNOTE, DoctorTheme.secondary, labCard)
            labs.forEach { lab ->
                val box = ui.vbox(6, labCard).apply { background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
                val h = ui.hbox(8, box)
                val published = lab.txt("published_at") != null
                ui.text(lab.value("test_name"), DFont.SUBHEAD_BOLD, DoctorTheme.ink, h).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                ui.text(if (published) s(R.string.dx_result_published_short) else lab.value("status").replaceFirstChar { it.uppercase() }, DFont.CAPTION_BOLD, DoctorTheme.wine, h)
                if (published) {
                    lab.txt("result_summary")?.let { ui.text(it, DFont.FOOTNOTE, DoctorTheme.ink, box) }
                    lab.list("parameters").forEach { p -> p.txt("value")?.let { v -> ui.text("${p.value("label")}: $v${p.txt("unit")?.let { u -> " $u" } ?: ""}", DFont.CAPTION, DoctorTheme.ink, box) } }
                }
            }
        }
    }
}
/** Expedientes desde «Más» (misma vista DoctorRecordsView). */
class DoctorNativeChartActivity : DoctorNativePatientsActivity() { override val screen = "chart" }

// ======================================================================
// Laboratorios (directory(workspace, laboratory: true))
// ======================================================================

class DoctorNativeLabsActivity : DoctorNativeActivity() {
    override val screen = "laboratory"
    private var labsFor: String? = null
    override fun onCreate(state: android.os.Bundle?) {
        super.onCreate(state)
        if (!ready) return
        ctx.adoptAppointmentPatient()
        val after = { loadLabCatalog { loadOwnLabOrders { rerender() } } }
        if (ctx.directoryPage == null) loadPatients { after() } else after()
    }
    override fun render() {
        clear(false)
        moduleTop()
        val box = ui.vbox(18, content)
        val hero = ui.hero(box, 10, 22)
        ui.label(s(R.string.dx_labs_upper), R.drawable.ic_d_testtube, DFont.CAPTION_BOLD, Color.WHITE, hero, tracking = 1.2f)
        ui.text(s(R.string.dx_labs_title), DFont.TITLE2, Color.WHITE, hero)
        ui.text(s(R.string.dx_labs_body), DFont.SUBHEAD, Color.WHITE, hero)
        ctx.directoryPage?.let { val n = it.optInt("total"); ui.text(resources.getQuantityString(R.plurals.dx_patients_found, n, n), DFont.CAPTION_BOLD, Color.WHITE, hero) }
        val bar = ui.hbox(10, box).apply { background = ui.rounded(Color.WHITE, 16); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        ui.icon(R.drawable.ic_d_search, DoctorTheme.wine, 17, bar)
        val input = ui.edit(s(R.string.dx_labs_search), ctx.patientQuery) { ctx.patientQuery = it }
        input.layoutParams = LinearLayout.LayoutParams(0, -2, 1f); bar.addView(input)
        val submit = { ctx.select(null); labsFor = null; loadPatients { rerender() } }
        input.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
        input.setOnEditorActionListener { _, _, _ -> submit(); true }
        ui.linkButton(s(R.string.dx_search), null, bar, DFont.SUBHEAD_BOLD, enabled = !busy) { submit() }
        if (busy && ctx.directory.isEmpty()) ui.progress(box, s(R.string.dx_searching_patients))
        ctx.directoryError?.let { ui.notice(it, box); ui.linkButton(s(R.string.dx_retry_search), null, box) { loadPatients { rerender() } } }
        val patient = ctx.selectedPatient
        if (patient == null) { ownOrders(box); directory(box); return }
        val id = patient.value("id")
        if (labsFor != id) { labsFor = id; loadPatientLabs { loadChart { rerender() } } }
        ui.linkButton(s(R.string.dx_back_to_list), R.drawable.ic_d_chevron_left, box, DFont.SUBHEAD_SEMI) { ctx.select(null); labsFor = null; rerender() }
        val card = ui.hospitalCard(box)
        val row = ui.hbox(14, card, center = false)
        ui.circleText(DoctorRules.initials(patient.value("full_name")), 54, DoctorTheme.wine, DoctorTheme.rose, DFont.TITLE3, row)
        val t = ui.vbox(6, row)
        ui.text(patient.value("full_name"), DFont.TITLE3, DoctorTheme.ink, t)
        ui.text(patient.txt("record_number")?.let { s(R.string.dx_record_value, it) } ?: s(R.string.dx_record_unavailable), DFont.SUBHEAD, DoctorTheme.wine, t)
        ui.text(if (patient.has("age") && !patient.isNull("age")) s(R.string.dx_years, patient.optInt("age")) else s(R.string.dx_age_unregistered), DFont.CAPTION, DoctorTheme.secondary, t)
        ui.divider(card)
        ui.label(patient.txt("dui") ?: s(R.string.dx_dui_unregistered), R.drawable.ic_d_idcard, DFont.SUBHEAD, DoctorTheme.ink, card)
        ui.label(patient.txt("email") ?: s(R.string.dx_email_unregistered), R.drawable.ic_d_mail, DFont.SUBHEAD, DoctorTheme.ink, card)
        ui.label(patient.txt("phone") ?: s(R.string.dx_phone_unregistered), R.drawable.ic_d_phone, DFont.SUBHEAD, DoctorTheme.ink, card)
        val chartBox = ui.vbox(0, box).apply { background = ui.rounded(Color.WHITE, 16); setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }
        ui.disclosure(chartBox, s(R.string.dx_view_full_record), DFont.SUBHEAD_SEMI, DoctorTheme.wine) { patientChart(it) }
        if (ctx.canEdit || ctx.pendingLabs != null) labSelection(box, { rerender() }, inSheet = false)
        else {
            val c = ui.card(box, 10)
            ui.blockHeader(c, R.drawable.ic_d_testtube, s(R.string.dx_request_labs), s(R.string.dx_orders_in_consult))
            ui.text(s(R.string.dx_no_open_consult), DFont.FOOTNOTE, DoctorTheme.secondary, c)
            ui.borderedButton(s(R.string.dx_go_consult), R.drawable.ic_d_medical_case, c) { go("consultation") }.layoutParams = LinearLayout.LayoutParams(-2, -2)
        }
        val labs = ui.vbox(12, box)
        ui.blockHeader(labs, R.drawable.ic_d_doc, s(R.string.dx_patient_exams), s(R.string.dx_patient_exams_sub))
        if (busy && ctx.patientLabs.isEmpty()) ui.progress(labs, s(R.string.dx_loading_exams))
        ctx.patientLabsError?.let { ui.notice(it, labs); ui.linkButton(s(R.string.dx_retry_labs), null, labs) { loadPatientLabs { rerender() } } }
        if (ctx.patientLabs.isEmpty() && !busy && ctx.patientLabsError == null) ui.emptyState(labs, R.drawable.ic_d_testtube, s(R.string.dx_no_exams), s(R.string.dx_no_exams_body))
        ctx.patientLabs.forEach { labOrderCard(labs, it) }
        if (ctx.patientLabPage?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_more_exams), null, labs) { loadPatientLabs(true) { rerender() } }
    }
    private fun ownOrders(parent: LinearLayout) {
        val box = ui.vbox(12, parent)
        val head = ui.hbox(8, box)
        ui.label(s(R.string.dx_my_lab_orders), R.drawable.ic_d_testtube, DFont.HEADLINE, DoctorTheme.ink, head)
        ui.spacerView(head)
        ui.circleIconButton(R.drawable.ic_d_refresh, s(R.string.dx_refresh_orders), head) { loadOwnLabOrders { rerender() } }
        ctx.pendingLabs?.let { p ->
            val c = ui.card(box, 8)
            ui.label(s(R.string.dx_unconfirmed_of, p.label), R.drawable.ic_d_refresh, DFont.SUBHEAD_BOLD, DoctorTheme.wine, c)
            ui.text(resources.getQuantityString(R.plurals.dx_exams_reason, p.count, p.count, p.reason), DFont.FOOTNOTE, DoctorTheme.ink, c, lines = 3)
            ui.solidButton(s(R.string.dx_retry_same), c) {
                confirm(s(R.string.dx_send_labs_title), s(R.string.dx_send_labs_short), listOf(s(R.string.dx_confirm_labs) to { issueSelectedLabs { loadOwnLabOrders { rerender() } } }))
            }
        }
        ctx.ownLabsError?.let { ui.notice(it, box) }
        if (ctx.ownLabs.isEmpty() && !busy && ctx.ownLabsError == null) ui.emptyState(box, R.drawable.ic_d_testtube, s(R.string.dx_no_orders), s(R.string.dx_no_orders_body))
        ctx.ownLabs.forEach { labOrderCard(box, it) }
        if (ctx.ownLabPage?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_more_orders), null, box) { loadOwnLabOrders(true) { rerender() } }
        ui.label(s(R.string.dx_labs_hint), R.drawable.ic_d_info, DFont.FOOTNOTE, DoctorTheme.secondary, box)
    }
    private fun directory(parent: LinearLayout) {
        if (ctx.directory.isEmpty() && !busy && ctx.directoryError == null) {
            val card = ui.hospitalCard(parent)
            ui.label(s(R.string.dx_no_patients_found), R.drawable.ic_d_person, DFont.HEADLINE, DoctorTheme.ink, card)
            ui.text(s(if (ctx.patientQuery.isEmpty()) R.string.dx_assigned_here else R.string.dx_try_other), DFont.SUBHEAD, DoctorTheme.secondary, card)
        }
        val list = ui.vbox(12, parent)
        ctx.directory.forEach { p ->
            val card = ui.hbox(12, list).apply { minimumHeight = ui.dp(125); background = ui.rounded(Color.WHITE, 18, DoctorTheme.rose); setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }
            ui.circleText(DoctorRules.initials(p.value("full_name")), 46, DoctorTheme.wine, DoctorTheme.rose, DFont.HEADLINE, card)
            val t = ui.vbox(6, card).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            ui.text(p.value("full_name"), DFont.HEADLINE, DoctorTheme.ink, t)
            ui.text(p.txt("record_number") ?: s(R.string.dx_record_unavailable), DFont.CAPTION_BOLD, DoctorTheme.wine, t)
            ui.text(p.txt("email") ?: s(R.string.dx_email_unregistered), DFont.CAPTION, DoctorTheme.secondary, t)
            ui.text(s(R.string.dx_open_labs_record), DFont.CAPTION_SEMI, DoctorTheme.wine, t)
            ui.icon(R.drawable.ic_d_chevron_right, DoctorTheme.wine, 14, card)
            card.contentDescription = s(R.string.dx_open_record_a11y, p.value("full_name"))
            ui.clickable(card) {
                if (ctx.rxLines.length() > 0 || ctx.pendingLabs != null) { error = s(R.string.doc_pending); rerender(); return@clickable }
                ctx.openPatient(p); labsFor = null; rerender()
            }
        }
        if (ctx.directoryPage?.optBoolean("has_more") == true) ui.linkButton(s(R.string.dx_more_patients), null, parent) { loadPatients(true) { rerender() } }
    }
}
