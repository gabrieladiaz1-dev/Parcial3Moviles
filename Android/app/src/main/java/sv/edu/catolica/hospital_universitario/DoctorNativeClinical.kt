package sv.edu.catolica.hospital_universitario

import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

// ======================================================================
// Piezas compartidas por consulta, recetas, expedientes y laboratorio
// ======================================================================

fun DoctorNativeActivity.vitalIssues(): Map<String, String> = DoctorRules.vitalIssues(ctx.draft.vitals) { id, a -> getString(id, *a) }
fun DoctorNativeActivity.missing() = s(R.string.dx_no_real_data)
fun DoctorNativeActivity.valueOrMissing(text: String?) = text?.trim()?.ifBlank { null } ?: missing()
fun DoctorNativeActivity.age(a: JSONObject) = if (a.has("age") && !a.isNull("age") && a.optInt("age") >= 0) s(R.string.dx_years, a.optInt("age")) else missing()
fun DoctorNativeActivity.symptoms(a: JSONObject) = a.strings("symptoms").map { it.trim() }.filter { it.isNotEmpty() }
fun DoctorNativeActivity.timeRange(a: JSONObject): String {
    val start = DoctorRules.start(a) ?: return s(R.string.dx_unavailable)
    val minutes = if (a.isNull("duration_minutes")) 0 else a.optInt("duration_minutes")
    val un = s(R.string.dx_unavailable)
    return if (minutes <= 0) DoctorFormat.time(start, un) else DoctorFormat.time(start, un) + " – " + DoctorFormat.time(start.plusMinutes(minutes.toLong()), un)
}
fun DoctorNativeActivity.openingBlocker(a: JSONObject): String? {
    if (a.txt("encounter_id") != null) return null
    if (a.value("status") !in setOf("scheduled", "confirmed", "in_progress")) return s(R.string.dx_cannot_open, s(DoctorRules.statusLabel(a.value("status"))).lowercase())
    val lead = DoctorRules.openingLeadMinutes ?: return null
    val start = DoctorRules.start(a) ?: return null
    return if (start.isAfter(java.time.ZonedDateTime.now(DoctorRules.zone).plusMinutes(lead))) s(R.string.dx_open_from, lead) else null
}

/** ConsultationReportedSymptoms */
fun DoctorNativeActivity.reportedSymptoms(parent: LinearLayout, list: List<String>, other: String?) {
    val box = ui.vbox(8, parent).apply { background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
    ui.label(s(R.string.dx_reported_by_patient), R.drawable.ic_d_person, DFont.CAPTION_SEMI, DoctorTheme.secondary, box)
    if (list.isEmpty() && other.isNullOrBlank()) ui.text(s(R.string.dx_no_symptoms), DFont.FOOTNOTE, DoctorTheme.secondary, box)
    else {
        val flow = ui.flow(6, box)
        list.forEach { ui.pill(it, null, DoctorTheme.wine, DoctorTheme.rose, DFont.FOOTNOTE_SEMI, flow, 11, 6) }
        if (!other.isNullOrBlank()) ui.text(s(R.string.dx_other_symptoms, other), DFont.FOOTNOTE, DoctorTheme.ink, box)
    }
}
/** ConsultationNoteField: icono, título, insignia Obligatorio/Completo y campo amplio. */
fun DoctorNativeActivity.noteField(parent: LinearLayout, icon: Int, title: String, placeholder: String, value: String, hint: String? = null,
                                   onChange: (String) -> Unit): EditText {
    val box = ui.vbox(10, parent)
    val head = ui.hbox(8, box)
    ui.icon(icon, DoctorTheme.wine, 15, head, 30, ui.oval(DoctorTheme.rose))
    ui.text(title, DFont.SUBHEAD_SEMI, DoctorTheme.ink, head).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
    val badgeHolder = LinearLayout(this).also { head.addView(it) }
    lateinit var input: EditText
    fun paint(text: String) {
        val empty = text.isBlank()
        badgeHolder.removeAllViews()
        ui.pill(s(if (empty) R.string.dx_required else R.string.dx_complete), if (empty) R.drawable.ic_d_asterisk else R.drawable.ic_d_check_circle,
            if (empty) DoctorTheme.wine else DoctorTheme.greenInk, if (empty) DoctorTheme.rose else DoctorTheme.green, DFont.CAPTION2_BOLD, badgeHolder)
        input.background = ui.rounded(DoctorTheme.background, 12, if (empty) DoctorTheme.rose else DoctorTheme.alpha(DoctorTheme.secondary, 0.15f), if (empty) 1.5f else 1f)
    }
    input = ui.field(box, placeholder, value, multiline = true, minLines = 4, max = 10000) { paint(it); onChange(it) }
    input.minHeight = ui.dp(110); input.maxLines = 14
    input.contentDescription = s(R.string.dx_required_a11y, title)
    if (hint != null) ui.text(hint, DFont.CAPTION, DoctorTheme.secondary, box)
    paint(value)
    return input
}
fun DoctorNativeActivity.consultationRecord(parent: LinearLayout, record: JSONObject) {
    val box = ui.vbox(10, parent)
    ui.text(DoctorFormat.display(record.value("started_at"), s(R.string.dx_unavailable)), DFont.SUBHEAD_SEMI, DoctorTheme.ink, box)
    ui.badge(s(DoctorRules.genericStatus(record.value("status"))), false, box)
    ui.detail(s(R.string.dx_f_symptoms), record.txt("subjective") ?: s(R.string.dx_unregistered), box)
    ui.detail(s(R.string.dx_f_diagnosis), record.txt("assessment") ?: s(R.string.dx_unregistered), box)
    record.txt("diagnosis_code")?.let { ui.detail(s(R.string.dx_diagnosis_code), it, box) }
    ui.detail(s(R.string.dx_f_exploration), record.txt("objective") ?: s(R.string.dx_unregistered), box)
    record.txt("plan")?.let { ui.detail(s(R.string.dx_f_plan), it, box) }
    val vitals = record.optJSONObject("vitals")
    DoctorRules.recordedVitals.forEach { (key, label, unit) -> vitals?.txt(key)?.let { ui.detail("${s(label)} ($unit)", it, box) } }
    DoctorRules.bmi(vitals)?.let { ui.detail(s(R.string.dx_bmi_calculated), s(R.string.dx_bmi_value, it), box) }
}
/** patientChart(showPicker: false) de DoctorModuleView. */
fun DoctorNativeActivity.patientChart(parent: LinearLayout) {
    val box = ui.vbox(16, parent)
    ctx.chart?.let { chart ->
        val p = chart.optJSONObject("patient") ?: JSONObject()
        ui.text(s(R.string.dx_identity_contact), DFont.HEADLINE, DoctorTheme.ink, box)
        val id = ui.hospitalCard(box)
        listOf(R.string.dx_name to p.value("full_name"), R.string.dx_record to p.value("record_number"),
            R.string.dx_identification to (p.txt("identification") ?: s(R.string.dx_unreg_f)), R.string.dx_birth to (p.txt("birth_date") ?: s(R.string.dx_unreg_f)),
            R.string.dx_sex to (p.txt("sex") ?: s(R.string.dx_unreg_m)), R.string.dx_phone to (p.txt("phone") ?: s(R.string.dx_unreg_m)),
            R.string.dx_email to (p.txt("email") ?: s(R.string.dx_unreg_m)), R.string.dx_address to (p.txt("address") ?: s(R.string.dx_unreg_f))
        ).forEach { (label, value) -> ui.detail(s(label), value, id) }
        ui.text(s(R.string.dx_clinical_data), DFont.HEADLINE, DoctorTheme.ink, box)
        val clinical = ui.hospitalCard(box)
        fun joined(key: String) = chart.strings(key).let { if (it.isEmpty()) s(R.string.dx_no_records) else it.joinToString("\n") }
        ui.detail(s(R.string.dx_blood), chart.txt("blood_type") ?: s(R.string.dx_unreg_m), clinical)
        ui.detail(s(R.string.dx_allergies_reg), joined("allergies"), clinical)
        ui.detail(s(R.string.dx_conditions_reg), joined("conditions"), clinical)
        ui.detail(s(R.string.doc_background), joined("medical_history"), clinical)
        ui.detail(s(R.string.dx_medications), joined("medications"), clinical)
        chart.list("vitals").forEach { v ->
            val raw = v.value("value"); ui.detail(v.value("label"), if (DoctorRules.parse(raw) == null) raw else DoctorFormat.display(raw, raw), clinical)
        }
    }
    if (ctx.selectedAppointment == null && ctx.selectedPatient == null) return
    ui.text(s(R.string.dx_my_history), DFont.HEADLINE, DoctorTheme.ink, box)
    ui.field(box, s(R.string.dx_search_history), ctx.historyQuery, bg = Color.WHITE, stroke = DoctorTheme.divider, padding = 10, radius = 6) { ctx.historyQuery = it }
    val toggle = ui.hbox(8, box)
    ui.text(s(R.string.dx_filter_dates), DFont.BODY, DoctorTheme.ink, toggle).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
    toggle.addView(com.google.android.material.materialswitch.MaterialSwitch(this).apply {
        isChecked = ctx.filterDates
        trackTintList = android.content.res.ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(DoctorTheme.wine, DoctorTheme.divider))
        setOnCheckedChangeListener { _, on -> ctx.filterDates = on; rerender() }
    })
    if (ctx.filterDates) {
        datePickerRow(box, s(R.string.doc_filter_from), ctx.historyFrom) { ctx.historyFrom = it; rerender() }
        datePickerRow(box, s(R.string.doc_filter_to), ctx.historyTo) { ctx.historyTo = it; rerender() }
    }
    ui.linkButton(s(R.string.dx_search_consults), R.drawable.ic_d_search, box) { loadChart(filtered = true) { rerender() } }
    ctx.chart?.let { chart ->
        val history = chart.list("history")
        if (history.isEmpty()) empty(s(R.string.dx_no_filtered), box)
        history.forEach { consultationRecord(ui.hospitalCard(box), it) }
    }
}
/** DatePicker compacto de iOS: etiqueta + fecha en cápsula gris. */
fun DoctorNativeActivity.datePickerRow(parent: LinearLayout, label: String, day: LocalDate, changed: (LocalDate) -> Unit) {
    val row = ui.hbox(8, parent)
    ui.text(label, DFont.SUBHEAD, DoctorTheme.ink, row).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
    ui.text(DoctorFormat.shortDay(day), DFont.BODY, DoctorTheme.ink, row).apply {
        background = ui.rounded(DoctorTheme.segmentTrack, 6); setPadding(ui.dp(11), ui.dp(6), ui.dp(11), ui.dp(6))
        ui.clickable(this) { pickDate(day, changed) }
    }
}
fun DoctorNativeActivity.pickDate(day: LocalDate, changed: (LocalDate) -> Unit) {
    val picker = android.widget.DatePicker(android.view.ContextThemeWrapper(this, R.style.ThemeOverlay_Doctor))
    picker.init(day.year, day.monthValue - 1, day.dayOfMonth, null)
    com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle(R.string.dx_pick_date).setView(picker)
        .setNeutralButton(R.string.dx_go_today) { _, _ -> changed(DoctorRules.today()) }
        .setPositiveButton(R.string.dx_done) { _, _ -> changed(LocalDate.of(picker.year, picker.month + 1, picker.dayOfMonth)) }
        .show()
}
/** Lista de opciones (Menu/Picker de iOS). */
fun DoctorNativeActivity.chooser(title: String, options: List<Pair<String?, String>>, picked: (String?) -> Unit) {
    com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle(title)
        .setItems(options.map { it.second }.toTypedArray()) { _, i -> picked(options[i].first) }.show()
}

// ---------- Carga y mutaciones (DoctorViewModel) ----------
fun DoctorNativeActivity.loadChart(filtered: Boolean = false, silent: Boolean = false, done: () -> Unit) {
    val patient = ctx.patientId ?: return done()
    if (filtered && ctx.filterDates && ctx.historyFrom.isAfter(ctx.historyTo)) { error = s(R.string.dx_dates_invalid); return done() }
    val from = if (filtered && ctx.filterDates) ctx.historyFrom.atStartOfDay(DoctorRules.zone).toOffsetDateTime().toString() else null
    val to = if (filtered && ctx.filterDates) ctx.historyTo.plusDays(1).atStartOfDay(DoctorRules.zone).toOffsetDateTime().toString() else null
    val query = if (filtered) ctx.historyQuery.trim() else ""
    val selection = ctx.selectedAppointmentId to ctx.selectedPatient?.value("id")
    work({ repo.chart(patient, from, to, query) }, { e ->
        if (!silent) { ctx.chart = null; if (!filtered) ctx.contextChart = null; error = describe(e) }; done()
    }) { value ->
        if (selection != (ctx.selectedAppointmentId to ctx.selectedPatient?.value("id"))) return@work
        ctx.applyChart(value, filtered); done()
    }
}
/** mutate(): ejecuta, confirma y recarga agenda y expediente. */
fun DoctorNativeActivity.mutate(success: Int, operation: () -> Unit, failed: ((Throwable) -> Unit)? = null, done: (Boolean) -> Unit) {
    ctx.confirmation = null; error = null
    work({ operation() }, { e -> error = describe(e); failed?.invoke(e); done(false) }) {
        ctx.confirmation = s(success)
        refreshWorkspace { loadChart { done(true) } }
    }
}
fun DoctorNativeActivity.saveConsultation(done: (Boolean) -> Unit) {
    val encounter = ctx.activeConsultation
    if (encounter == null || !ctx.canEdit || ctx.conflict != null) return done(false)
    if (!ctx.draft.canSave) { error = s(R.string.dx_save_lengths); ctx.saveState = "failed"; ctx.saveError = s(R.string.dx_save_lengths_short); return done(false) }
    vitalIssues().values.firstOrNull()?.let { error = s(R.string.dx_save_vitals, it); ctx.saveState = "failed"; ctx.saveError = s(R.string.dx_save_vitals_short); return done(false) }
    val values = ctx.draft.values(); val key = ctx.saveKey
    val version = if (encounter.isNull("note_version")) 0 else encounter.optInt("note_version")
    ctx.saveState = "saving"; rerender()
    mutate(R.string.dx_saved_ok, {
        repo.call("save", args("p_encounter" to encounter.value("id"), "p_values" to values, "p_version" to version, "p_key" to key))
        ctx.saveKey = DoctorNativeContext.uuid(); ctx.draftInitialized = false
    }, { e ->
        if (e is DoctorFailure && e.resource == R.string.doc_version_conflict) {
            work({ repo.chart(ctx.patientId!!) }) { value ->
                ctx.contextChart = value; ctx.chart = value; ctx.conflict = ctx.activeConsultation
                error = s(R.string.dx_conflict_error); ctx.saveState = "failed"; ctx.saveError = error.orEmpty(); rerender()
            }
        }
        ctx.saveState = "failed"; ctx.saveError = describe(e)
    }) { ok -> if (ok) ctx.saveState = "saved"; done(ok && error == null) }
}
fun DoctorNativeActivity.resolveConflict(keepMine: Boolean) {
    val server = ctx.conflict ?: return
    ctx.conflict = null; error = null
    ctx.savedDraft = DoctorDraft.from(server)
    if (keepMine) saveConsultation { rerender() } else { ctx.draft = DoctorDraft.from(server); ctx.saveState = "idle"; rerender() }
}
fun DoctorNativeActivity.closeConsultation(done: (Boolean) -> Unit) {
    if (!ctx.canEdit) return done(false)
    val blockers = ctx.finishBlockers(vitalIssues())
    if (!ctx.draft.canSave || blockers.isNotEmpty()) { error = blockers.joinToString(". ") { blockerText(it) } + "."; return done(false) }
    saveConsultation { saved ->
        val encounter = ctx.activeConsultation
        if (!saved || encounter == null || encounter.txt("note_id") == null || encounter.isNull("note_version")) {
            if (ctx.conflict == null) error = s(R.string.dx_unsaved_finish); return@saveConsultation done(false)
        }
        val plan = ctx.draft.plan
        mutate(R.string.dx_finished_ok, {
            repo.call("finish", args("p_encounter" to encounter.value("id"), "p_version" to encounter.optInt("row_version")))
        }, { e ->
            if (e is DoctorFailure && e.detail.contains("tratamiento", true) && plan.isBlank()) error = s(R.string.dx_finish_migration)
        }) { ok ->
            if (ok) { val message = ctx.confirmation; ctx.select(null); ctx.confirmation = message }
            done(ok)
        }
    }
}
fun DoctorNativeActivity.blockerText(id: Int) = if (id < 0) s(R.string.dx_complete_field, s(-id)) else s(id)

// ======================================================================
// Agenda y consulta
// ======================================================================

/** Consultas (agenda + espacio de consulta). Pantallas iOS "consultation" y "agenda". */
open class DoctorNativeConsultActivity : DoctorNativeActivity() {
    override val screen = "consultation"
    private var query = ""
    private var chartRequested: String? = null
    private var statusHolder: LinearLayout? = null
    private var finishHolder: LinearLayout? = null
    private var bmiHolder: LinearLayout? = null
    private var openSheet: Dialog? = null

    override fun onPoll() { if (!busy && ctx.selectedAppointmentId == null) refreshWorkspace { rerender() } }
    override fun onSearchChanged() { if (ctx.selectedAppointmentId == null) rerender() }

    override fun render() {
        clear(false)
        moduleTop()
        if (ctx.workspace == null) { if (!busy && error == null) empty(s(R.string.dx_no_info)); return }
        val a = ctx.selectedAppointment
        if (a == null) agenda() else consultation(a)
    }

    // ---------- Agenda ----------
    private fun agenda() {
        val day = ctx.day
        fun visible(list: List<JSONObject>) = list.filter { DoctorRules.matches(it, query) && DoctorRules.matches(it, search) }
        val pending = visible(DoctorRules.pending(ctx.appointments, day))
        val finished = visible(DoctorRules.finished(ctx.appointments, day))
        val showFinished = ctx.statusFilter == "finished"
        val rows = if (showFinished) finished else pending
        val box = ui.vbox(14, content)

        val hero = ui.hero(box, 14, 22, 18)
        val top = ui.hbox(8, hero, center = false)
        val titles = ui.vbox(3, top).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.label(s(R.string.dx_agenda_label), R.drawable.ic_d_calendar, DFont.CAPTION2_HEAVY, Color.WHITE, titles, tracking = 1.2f, alpha = 0.85f)
        ui.text(s(R.string.dx_t_consultation), DFont(28f, 2), Color.WHITE, titles)
        ui.text(DoctorFormat.dayMonth(day), DFont.CAPTION_SEMI, Color.WHITE, top, alpha = 0.9f).gravity = Gravity.END
        val indicators = ui.hbox(10, hero)
        indicator(indicators, "pending", s(R.string.dx_m_pending), pending.size, R.drawable.ic_d_clock)
        indicator(indicators, "finished", s(R.string.dx_m_finished), finished.size, R.drawable.ic_d_seal)

        dateBar(box)
        ui.searchField(box, s(R.string.dx_agenda_search), query, Color.WHITE, DoctorTheme.rose, 1f, 46) { query = it; rerenderList() }
        listHolder = ui.vbox(14, box)
        fillList(rows, showFinished)
    }
    private var listHolder: LinearLayout? = null
    private fun rerenderList() {
        val day = ctx.day
        fun visible(list: List<JSONObject>) = list.filter { DoctorRules.matches(it, query) && DoctorRules.matches(it, search) }
        val showFinished = ctx.statusFilter == "finished"
        fillList(visible(if (showFinished) DoctorRules.finished(ctx.appointments, day) else DoctorRules.pending(ctx.appointments, day)), showFinished)
    }
    private fun fillList(rows: List<JSONObject>, showFinished: Boolean) {
        val box = listHolder ?: return
        box.removeAllViews()
        val head = ui.hbox(8, box)
        ui.text(s(if (showFinished) R.string.dx_finished_list else R.string.dx_pending_list), DFont.HEADLINE, DoctorTheme.ink, head).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.text(s(if (showFinished) R.string.dx_last_first else R.string.dx_by_hour), DFont.CAPTION, DoctorTheme.secondary, head)
        if (rows.isEmpty()) {
            val filtering = query.isNotBlank() || search.isNotBlank()
            ui.emptyState(box, if (showFinished) R.drawable.ic_d_seal else R.drawable.ic_d_calendar,
                s(if (filtering) R.string.dx_no_matches else if (showFinished) R.string.dx_no_finished else R.string.dx_no_pending),
                s(if (filtering) R.string.dx_no_matches_body else if (showFinished) R.string.dx_no_finished_body else R.string.dx_no_pending_body))
        }
        val cards = ui.vbox(10, box)
        rows.forEach { appointmentCard(cards, it, showFinished) }
        if (showFinished) {
            val closed = DoctorRules.closedWithoutCare(ctx.appointments, ctx.day).filter { DoctorRules.matches(it, query) && DoctorRules.matches(it, search) }
            if (closed.isNotEmpty()) {
                ui.text(s(R.string.dx_closed_without_care), DFont.HEADLINE, DoctorTheme.ink, box).setPadding(0, ui.dp(6), 0, 0)
                val list = ui.vbox(10, box); closed.forEach { appointmentCard(list, it, false) }
            }
        }
    }
    private fun indicator(parent: LinearLayout, value: String, title: String, count: Int, icon: Int) {
        val selected = ctx.statusFilter == value
        val fg = if (selected) DoctorTheme.wine else Color.WHITE
        val cell = ui.hbox(10, parent).apply {
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f); minimumHeight = ui.dp(60)
            background = ui.rounded(if (selected) Color.WHITE else DoctorTheme.alpha(Color.WHITE, 0.15f), 14)
            setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10)); contentDescription = "$title: $count"
        }
        ui.icon(icon, fg, 18, cell)
        val t = ui.vbox(0, cell)
        ui.text(count.toString(), DFont(24f, 2), fg, t).fontFeatureSettings = "tnum"
        ui.text(title, DFont.CAPTION2_BOLD, fg, t, tracking = 0.6f, upper = true)
        ui.clickable(cell) { ctx.statusFilter = value; rerender() }
    }
    private fun dateBar(parent: LinearLayout) {
        val today = DoctorRules.today(); val isToday = ctx.day == today
        val bar = ui.hbox(8, parent).apply { background = ui.rounded(Color.WHITE, 16, DoctorTheme.rose); setPadding(ui.dp(6), ui.dp(6), ui.dp(6), ui.dp(6)) }
        ui.circleIconButton(R.drawable.ic_d_chevron_left, s(R.string.dx_prev_day), bar, 40) { changeDay(ctx.day.minusDays(1)) }
        val center = ui.hbox(10, bar).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f); minimumHeight = ui.dp(44); setPadding(ui.dp(10), 0, ui.dp(10), 0) }
        ui.icon(R.drawable.ic_d_calendar, DoctorTheme.wine, 17, center)
        val texts = ui.vbox(1, center).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val offset = java.time.temporal.ChronoUnit.DAYS.between(today, ctx.day)
        ui.text(when { offset == 0L -> s(R.string.dx_rel_today); offset == -1L -> s(R.string.dx_rel_yesterday); offset == 1L -> s(R.string.dx_rel_tomorrow)
            offset < 0 -> s(R.string.dx_rel_ago, -offset); else -> s(R.string.dx_rel_in, offset) }, DFont.CAPTION2_BOLD, DoctorTheme.wine, texts)
        ui.text(DoctorFormat.shortDay(ctx.day), DFont.SUBHEAD_SEMI, DoctorTheme.ink, texts, lines = 1)
        ui.icon(R.drawable.ic_d_chevron_down, DoctorTheme.secondary, 14, center)
        center.contentDescription = s(R.string.dx_date_a11y, DoctorFormat.dayMonth(ctx.day))
        ui.clickable(center) { pickDate(ctx.day) { changeDay(it) } }
        ui.circleIconButton(R.drawable.ic_d_chevron_right, s(R.string.dx_next_day), bar, 40) { changeDay(ctx.day.plusDays(1)) }
        ui.text(s(R.string.dx_today), DFont.SUBHEAD_BOLD, if (isToday) DoctorTheme.secondary else Color.WHITE, bar).apply {
            background = if (isToday) ui.capsule(DoctorTheme.background) else ui.gradientCapsule()
            setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10)); minHeight = ui.dp(40); gravity = Gravity.CENTER
            if (!isToday) ui.clickable(this) { changeDay(today) }
        }
    }
    private fun changeDay(day: LocalDate) { ctx.day = day; ctx.select(null); refreshWorkspace { rerender() } }

    private fun appointmentCard(parent: LinearLayout, a: JSONObject, finished: Boolean) {
        val start = DoctorRules.start(a)
        val inProgress = a.value("status") == "in_progress"
        val earlier = start != null && start.toLocalDate() != ctx.day
        val card = ui.hbox(12, parent, center = false).apply {
            background = ui.rounded(Color.WHITE, 18, if (inProgress) DoctorTheme.wine else DoctorTheme.rose, if (inProgress) 2f else 1f)
            setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
            contentDescription = s(R.string.dx_view_detail_a11y, valueOrMissing(a.txt("patient_name")), s(DoctorRules.statusLabel(a.value("status"))))
        }
        val fg = if (inProgress) Color.WHITE else DoctorTheme.wine
        val time = ui.vbox(2, card).apply {
            layoutParams = LinearLayout.LayoutParams(ui.dp(74), -2); gravity = Gravity.CENTER_HORIZONTAL
            background = if (inProgress) ui.gradient(14) else ui.rounded(DoctorTheme.rose, 14); setPadding(0, ui.dp(12), 0, ui.dp(12))
        }
        ui.text(DoctorFormat.hour12(start), DFont(20f, 2), fg, time, center = true).fontFeatureSettings = "tnum"
        ui.text(if (start == null) "" else s(if (start.hour < 12) R.string.dx_am else R.string.dx_pm), DFont.CAPTION2_BOLD, fg, time, center = true)
        val minutes = if (a.isNull("duration_minutes")) 0 else a.optInt("duration_minutes")
        if (minutes > 0) ui.text(s(R.string.dx_minutes_short, minutes), DFont.CAPTION2, fg, time, center = true, alpha = 0.8f)
        val body = ui.vbox(6, card).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val title = ui.hbox(6, body, center = false)
        ui.text(valueOrMissing(a.txt("patient_name")), DFont.HEADLINE, DoctorTheme.ink, title, lines = 2).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        statusBadge(title, a.value("status"))
        a.txt("reason")?.let { ui.text(it, DFont.SUBHEAD, DoctorTheme.alpha(DoctorTheme.ink, 0.85f), body, lines = 2) }
        val meta = ui.flow(10, body)
        ui.label(a.txt("room_code")?.let { s(R.string.dx_room, it) } ?: s(R.string.dx_no_room), R.drawable.ic_d_door, DFont.CAPTION, DoctorTheme.secondary, meta)
        ui.label(a.txt("patient_code") ?: a.value("record_number"), R.drawable.ic_d_folder, DFont.CAPTION, DoctorTheme.secondary, meta)
        if (finished) ui.label(DoctorRules.finished(a)?.let { s(R.string.dx_finished_at, DoctorFormat.time(it, "")) } ?: s(R.string.dx_finished_appt_time),
            R.drawable.ic_d_seal, DFont.CAPTION_SEMI, DoctorTheme.greenInk, body)
        else if (earlier && start != null) ui.label(s(R.string.dx_opened_on, DoctorFormat.abbrDay(start)), R.drawable.ic_d_info, DFont.CAPTION_SEMI, DoctorTheme.wine, body)
        ui.icon(R.drawable.ic_d_chevron_right, DoctorTheme.alpha(DoctorTheme.wine, 0.7f), 14, card).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(6) }
        ui.clickable(card) { ticket(a) }
    }
    private fun statusBadge(parent: LinearLayout, status: String) {
        val inProgress = status == "in_progress"; val done = status == "completed"
        ui.pill(s(DoctorRules.statusLabel(status)), null, if (inProgress) Color.WHITE else if (done) DoctorTheme.greenInk else DoctorTheme.wine,
            if (inProgress) DoctorTheme.wine else if (done) DoctorTheme.green else DoctorTheme.rose, DFont.CAPTION2_BOLD, parent)
    }

    /** DoctorConsultationTicketView en hoja inferior. */
    private fun ticket(a: JSONObject) {
        val dialog = BottomSheetDialog(this)
        val scroll = android.widget.ScrollView(this)
        val body = ui.vbox(22).apply { setPadding(ui.dp(22), ui.dp(22), ui.dp(22), ui.dp(30)); gravity = Gravity.CENTER_HORIZONTAL; setBackgroundColor(DoctorTheme.background) }
        scroll.addView(body); scroll.setBackgroundColor(DoctorTheme.background)
        ui.icon(R.drawable.ic_d_check, Color.WHITE, 34, body, 82, ui.oval(DoctorTheme.wine)).importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        ui.text(s(R.string.dx_ticket_title), DFont(27f, 2), DoctorTheme.ink, body, center = true)
        ui.pill(s(DoctorRules.statusLabel(a.value("status"))), null, DoctorTheme.wine, DoctorTheme.rose, DFont.FOOTNOTE_SEMI, body, 12, 6)
        val when_ = ui.vbox(8, body).apply { background = ui.rounded(DoctorTheme.rose, 16); setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(18)); gravity = Gravity.CENTER_HORIZONTAL }
        ui.text(s(R.string.dx_date_time), DFont.CAPTION, DoctorTheme.secondary, when_, center = true)
        val period = DoctorFormat.period(a, "")
        ui.text(if (period.isBlank()) missing() else DoctorFormat.longWeekday(DoctorRules.start(a)?.toLocalDate() ?: ctx.day), DFont.HEADLINE, DoctorTheme.ink, when_, center = true)
        ui.text(period.ifBlank { missing() }, DFont.HEADLINE, DoctorTheme.ink, when_, center = true)
        val fields = ui.vbox(18, body).apply { background = ui.rounded(Color.WHITE, 16); setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(18)) }
        fun field(parent: LinearLayout, label: String, value: String) = ui.vbox(5, parent).apply {
            ui.text(label, DFont.CAPTION_SEMI, DoctorTheme.secondary, this); ui.text(value, DFont.SUBHEAD, DoctorTheme.ink, this)
        }
        field(fields, s(R.string.dx_patient), valueOrMissing(a.txt("patient_name")))
        field(fields, s(R.string.dx_record), valueOrMissing(a.txt("record_number")))
        field(fields, s(R.string.dx_consulting_room), valueOrMissing(a.txt("room_code")))
        field(fields, s(R.string.dx_requested_specialty), a.txt("specialty") ?: s(R.string.dx_direct_appt))
        val pair = ui.hbox(16, fields, center = false)
        field(pair, s(R.string.dx_age), age(a)).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        field(pair, s(R.string.dx_phone), valueOrMissing(a.txt("phone"))).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.divider(fields)
        field(fields, s(R.string.dx_consult_reason), valueOrMissing(a.txt("reason")))
        field(fields, s(R.string.dx_symptoms), symptoms(a).joinToString(", ").ifBlank { missing() })
        a.txt("other_symptoms")?.let { field(fields, s(R.string.dx_other_symptoms_label), it) }
        val blocker = openingBlocker(a)
        val label = s(if (a.txt("encounter_id") == null) R.string.dx_open_consult else if (a.value("status") == "completed") R.string.dx_view_finished else R.string.dx_continue_consult)
        val open = ui.hbox(8, body).apply {
            gravity = Gravity.CENTER; minimumHeight = ui.dp(56); background = ui.rounded(if (blocker == null) DoctorTheme.wine else DoctorTheme.secondary, 14)
        }
        ui.icon(if (a.txt("encounter_id") == null) R.drawable.ic_d_stethoscope else R.drawable.ic_d_doc, Color.WHITE, 18, open)
        ui.text(label, DFont.HEADLINE, Color.WHITE, open)
        if (blocker == null) ui.clickable(open) { dialog.dismiss(); openCare(a) }
        blocker?.let { ui.text(it, DFont.FOOTNOTE, DoctorTheme.secondary, body, center = true) }
        ui.linkButton(s(R.string.dx_back_to_consults), null, body, DFont.SUBHEAD_SEMI) { dialog.dismiss() }.apply { minimumHeight = ui.dp(44) }
        dialog.setContentView(scroll)
        dialog.window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED; dialog.behavior.skipCollapsed = true
        dialog.show()
    }
    /** select(id) + startConsultation() de la agenda. */
    private fun openCare(a: JSONObject) {
        ctx.select(a.value("id")); ctx.confirmation = null
        if (screen == "agenda") { ctx.pendingStart = true; go("consultation"); return }
        startConsultation()
    }
    fun startConsultation() {
        val a = ctx.selectedAppointment ?: return
        if (a.txt("encounter_id") != null) { rerender(); loadChart { rerender() }; return }
        val key = ctx.startKey
        mutate(R.string.dx_started, {
            repo.call("start", args("p_appointment" to a.value("id"), "p_key" to key))
            ctx.startKey = DoctorNativeContext.uuid(); ctx.draftInitialized = false
        }, { e -> if (e is DoctorFailure && DoctorRules.openingLeadMinutes == null && e.detail.contains("todavía no puede iniciarse", true)) error = s(R.string.dx_start_migration) }) { rerender() }
    }
    override fun onCreate(state: android.os.Bundle?) {
        super.onCreate(state)
        if (ready && ctx.pendingStart) { ctx.pendingStart = false; handlerPost { startConsultation() } }
    }
    private fun handlerPost(run: () -> Unit) = binding.root.post(run)

    // ---------- Espacio de consulta ----------
    private fun consultation(a: JSONObject) {
        val box = ui.vbox(16, content)
        ui.linkButton(s(R.string.dx_back_to_agenda), R.drawable.ic_d_chevron_left, box, DFont.SUBHEAD_SEMI) {
            if (ctx.hasUnsavedChanges && ctx.canEdit) confirm(s(R.string.dx_unsaved_title), s(R.string.dx_unsaved_body), listOf(
                s(R.string.dx_save_and_back) to { saveConsultation { ok -> if (ok) ctx.select(null); rerender() } },
                s(R.string.dx_leave_unsaved) to { ctx.select(null); rerender() }), s(R.string.dx_stay), destructive = 1)
            else { ctx.select(null); rerender() }
        }
        patientCard(box, a)
        val encounter = a.txt("encounter_id")
        if (encounter == null) {
            apptDataCard(box, a, null)
            val card = ui.card(box, 12)
            ui.blockHeader(card, R.drawable.ic_d_clipboard, s(R.string.dx_reported_symptoms), s(R.string.dx_reported_symptoms_sub))
            reportedSymptoms(card, symptoms(a), a.txt("other_symptoms"))
            val blocker = openingBlocker(a)
            ui.primaryButton(s(R.string.dx_open_consult), R.drawable.ic_d_stethoscope, box, blocker == null, 58) { startConsultation() }
            blocker?.let { ui.notice(it, box) }
            return
        }
        val active = ctx.activeConsultation
        if (active == null) {
            if (chartRequested != encounter) { chartRequested = encounter; ui.progress(box, s(R.string.dx_loading_consult)); loadChart { rerender() }; return }
            if (busy) { ui.progress(box, s(R.string.dx_loading_consult)); return }
            ui.notice(s(R.string.dx_consult_load_failed), box)
            ui.linkButton(s(R.string.dx_refresh_consult), R.drawable.ic_d_refresh, box) { loadChart { rerender() } }
            return
        }
        if (ctx.canEdit) {
            statusHolder = ui.vbox(0, box); paintStatus()
            ctx.conflict?.let { conflictCard(box, it) }
            apptDataCard(box, a, DoctorRules.local(active.value("started_at")))
            val chartCard = ui.card(box, 0)
            ui.disclosure(chartCard, s(R.string.dx_chart_previous), leading = { row ->
                ui.label(s(R.string.dx_chart_previous), R.drawable.ic_d_folder, DFont.HEADLINE, DoctorTheme.ink, row)
            }) { patientChart(it) }
            physicalData(box)
            evaluation(box, a)
            services(box)
            finishHolder = ui.card(box, 12); paintFinish()
        } else {
            val card = ui.card(box, 12)
            ui.label(s(R.string.dx_consult_finished), R.drawable.ic_d_seal, DFont.HEADLINE, DoctorTheme.wine, card)
            ui.text(s(R.string.dx_consult_finished_body), DFont.FOOTNOTE, DoctorTheme.secondary, card)
            ui.divider(card)
            consultationRecord(card, active)
        }
    }
    /** ConsultationPatientCard */
    private fun patientCard(parent: LinearLayout, a: JSONObject) {
        val hero = ui.hero(parent, 16, 24)
        val row = ui.hbox(14, hero)
        ui.circleText(DoctorRules.initials(a.value("patient_name")), 64, DoctorTheme.wine, Color.WHITE, DFont.TITLE2, row, ring = true)
        val t = ui.vbox(6, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(s(R.string.dx_patient_upper), DFont.CAPTION2_HEAVY, Color.WHITE, t, tracking = 1.2f, alpha = 0.75f)
        ui.text(a.value("patient_name"), DFont.TITLE2, Color.WHITE, t, lines = 3)
        val flow = ui.flow(8, hero)
        val code = a.txt("patient_code") ?: ctx.contextChart?.optJSONObject("patient")?.takeIf { it.value("id") == a.value("patient_id") }?.txt("patient_code")
        code?.let { ui.headerPill(s(R.string.dx_code, it), R.drawable.ic_d_number, flow) }
        ui.headerPill(s(R.string.dx_record_value, a.value("record_number")), R.drawable.ic_d_folder, flow)
        ui.headerPill(age(a), R.drawable.ic_d_person, flow)
        val icon = when (a.value("status")) { "in_progress" -> R.drawable.ic_d_stethoscope; "completed" -> R.drawable.ic_d_seal
            "cancelled", "no_show", "rejected" -> R.drawable.ic_d_clear; else -> R.drawable.ic_d_calendar }
        ui.pill(s(DoctorRules.statusLabel(a.value("status"))), icon, DoctorTheme.wine, Color.WHITE, DFont.CAPTION_BOLD, flow, 12, 7)
    }
    /** ConsultationAppointmentCard */
    private fun apptDataCard(parent: LinearLayout, a: JSONObject, openedAt: java.time.ZonedDateTime?) {
        val card = ui.card(parent, 18)
        ui.blockHeader(card, R.drawable.ic_d_calendar, s(R.string.dx_appt_data), s(R.string.dx_appt_data_sub))
        val un = s(R.string.dx_unavailable)
        val tiles = mutableListOf(Triple(R.drawable.ic_d_calendar, s(R.string.dx_consult_date), DoctorFormat.date(DoctorRules.start(a), un)),
            Triple(R.drawable.ic_d_clock, s(R.string.dx_consult_time), timeRange(a)),
            Triple(R.drawable.ic_d_stethoscope, s(R.string.dx_responsible), ctx.workspace?.txt("doctor_name") ?: un),
            Triple(R.drawable.ic_d_medical_case, s(R.string.dx_specialty), a.txt("specialty") ?: s(R.string.dx_direct_short)),
            Triple(R.drawable.ic_d_door, s(R.string.dx_consulting_room), a.txt("room_code") ?: s(R.string.dx_not_assigned)))
        if (openedAt != null) tiles.add(Triple(R.drawable.ic_d_play, s(R.string.dx_opened_at), DoctorFormat.time(openedAt, un)))
        else a.txt("ticket_number")?.let { tiles.add(Triple(R.drawable.ic_d_ticket, s(R.string.dx_turn), it)) }
        ui.grid(card, tiles.map { (icon, title, value) -> { cell: LinearLayout ->
            ui.hbox(10, cell, center = false).apply {
                background = ui.rounded(DoctorTheme.background, 14); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
                ui.icon(icon, DoctorTheme.wine, 16, this, 32, ui.rounded(DoctorTheme.rose, 9))
                val t = ui.vbox(3, this).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
                ui.text(title, DFont.CAPTION, DoctorTheme.secondary, t); ui.text(value, DFont.SUBHEAD_SEMI, DoctorTheme.ink, t)
            }
        } }, spacing = 12)
        val reason = ui.vbox(8, card)
        ui.label(s(R.string.dx_reason_sent), R.drawable.ic_d_chat, DFont.SUBHEAD_SEMI, DoctorTheme.ink, reason)
        val quote = ui.hbox(10, reason, center = false).apply { background = ui.rounded(DoctorTheme.alpha(DoctorTheme.rose, 0.55f), 14); setPadding(0, ui.dp(10), ui.dp(14), ui.dp(10)) }
        View(this).apply { background = ui.capsule(DoctorTheme.wine); quote.addView(this, LinearLayout.LayoutParams(ui.dp(4), -1)) }
        ui.text(a.txt("reason") ?: s(R.string.dx_no_request), DFont.BODY, if (a.txt("reason") == null) DoctorTheme.secondary else DoctorTheme.ink, quote)
            .apply { setPadding(ui.dp(4), ui.dp(4), 0, ui.dp(4)); setTextIsSelectable(true) }
    }
    private fun paintStatus() {
        val box = statusHolder ?: return
        box.removeAllViews()
        if (!ctx.hasUnsavedChanges && ctx.saveState == "idle") return
        val (text, icon) = when {
            ctx.saveState == "saving" -> s(R.string.dx_saving_short) to R.drawable.ic_d_refresh
            ctx.saveState == "failed" -> s(R.string.dx_save_failed, ctx.saveError) to R.drawable.ic_d_warning
            ctx.hasUnsavedChanges -> s(R.string.dx_unsaved_changes) to R.drawable.ic_d_signature
            ctx.saveState == "saved" -> s(R.string.dx_saved_short) to R.drawable.ic_d_check_circle
            else -> s(R.string.dx_no_changes) to R.drawable.ic_d_check_circle
        }
        val bar = ui.hbox(10, box).apply { background = ui.rounded(DoctorTheme.rose, 14); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
        ui.icon(icon, DoctorTheme.wine, 17, bar)
        ui.text(text, DFont.FOOTNOTE_SEMI, DoctorTheme.wine, bar).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.linkButton(s(R.string.dx_save_progress), null, bar, DFont.FOOTNOTE_BOLD, enabled = ctx.hasUnsavedChanges && !busy) { saveConsultation { rerender() } }
    }
    private fun conflictCard(parent: LinearLayout, server: JSONObject) {
        val card = ui.hospitalCard(parent)
        ui.label(s(R.string.dx_conflict_title), R.drawable.ic_d_refresh, DFont.HEADLINE, DoctorTheme.wine, card)
        ui.text(s(R.string.dx_conflict_body), DFont.FOOTNOTE, DoctorTheme.ink, card)
        ui.detail(s(R.string.dx_saved_symptoms), server.txt("subjective") ?: s(R.string.dx_unregistered), card)
        ui.detail(s(R.string.dx_saved_diagnosis), server.txt("assessment") ?: s(R.string.dx_unregistered), card)
        ui.detail(s(R.string.dx_saved_observations), server.txt("objective") ?: s(R.string.dx_unregistered), card)
        ui.borderedButton(s(R.string.dx_use_saved), null, card) { resolveConflict(false) }
        ui.solidButton(s(R.string.dx_keep_mine), card) { resolveConflict(true) }
    }
    private fun onDraftChanged() { paintStatus(); paintFinish(); paintBmi() }
    /** Bloque A: datos físicos. */
    private fun physicalData(parent: LinearLayout) {
        val card = ui.card(parent, 16)
        ui.blockHeader(card, R.drawable.ic_d_person, s(R.string.dx_physical), s(R.string.dx_physical_sub), "A")
        val icons = mapOf("weight_kg" to R.drawable.ic_d_scale, "height_cm" to R.drawable.ic_d_ruler, "temperature_c" to R.drawable.ic_d_thermo)
        ui.grid(card, DoctorRules.vitals.map { vital -> { cell: LinearLayout -> measureField(cell, vital, icons[vital.key] ?: R.drawable.ic_d_number) } }, spacing = 12)
        bmiHolder = ui.vbox(0, card); paintBmi()
    }
    private fun paintBmi() {
        val box = bmiHolder ?: return
        box.removeAllViews()
        val bmi = DoctorRules.bmi(ctx.draft.vitals) ?: return
        if (vitalIssues().let { it.containsKey("weight_kg") || it.containsKey("height_cm") }) return
        val row = ui.hbox(8, box).apply { background = ui.rounded(DoctorTheme.rose, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
        ui.label(s(R.string.dx_bmi), R.drawable.ic_d_function, DFont.SUBHEAD_SEMI, DoctorTheme.wine, row)
        ui.spacerView(row)
        ui.text(s(R.string.dx_bmi_value, bmi), DFont.SUBHEAD_BOLD, DoctorTheme.wine, row).fontFeatureSettings = "tnum"
        row.contentDescription = s(R.string.dx_bmi_hint)
    }
    /** ConsultationMeasureField */
    private fun measureField(parent: LinearLayout, vital: DoctorRules.Vital, icon: Int): View {
        val box = ui.vbox(10, parent).apply { background = ui.rounded(Color.WHITE, 16, DoctorTheme.rose); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        val head = ui.hbox(8, box)
        ui.icon(icon, DoctorTheme.wine, 15, head, 30, ui.oval(DoctorTheme.rose))
        ui.text(s(vital.label), DFont.SUBHEAD_SEMI, DoctorTheme.ink, head)
        val row = ui.hbox(6, box)
        val hint = (if (vital.lowExclusive) s(R.string.dx_vital_hint_gt, vital.low.toInt()) else s(R.string.dx_vital_hint_from, vital.low.toInt())) +
            s(R.string.dx_vital_hint_to, vital.high.toInt(), vital.unit)
        lateinit var issueView: TextView
        fun paint() {
            val issue = vitalIssues()[vital.key]
            row.background = ui.rounded(DoctorTheme.background, 12, if (issue == null) DoctorTheme.alpha(DoctorTheme.secondary, 0.15f) else DoctorTheme.wine, if (issue == null) 1f else 1.5f)
            issueView.text = issue ?: hint; issueView.setTextColor(if (issue == null) DoctorTheme.secondary else DoctorTheme.wine)
            issueView.typeface = ui.face(if (issue == null) 0 else 1)
        }
        lateinit var input: EditText
        input = ui.edit("—", ctx.draft.vitals.value(vital.key), decimal = !vital.integer, numeric = vital.integer, font = DFont(28f, 1)) { raw ->
            val clean = DoctorRules.sanitize(raw, vital.integer)
            if (clean != raw) { input.setText(clean); input.setSelection(clean.length); return@edit }
            if (clean.isEmpty()) ctx.draft.vitals.remove(vital.key) else ctx.draft.vitals.put(vital.key, clean)
            paint(); onDraftChanged()
        }
        input.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); input.fontFeatureSettings = "tnum"
        input.layoutParams = LinearLayout.LayoutParams(0, -2, 1f); input.contentDescription = s(R.string.dx_vital_a11y, s(vital.label), vital.unit)
        row.addView(input)
        row.setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(10))
        ui.text(vital.unit, DFont.HEADLINE, DoctorTheme.wine, row)
        issueView = ui.text(hint, DFont.CAPTION2, DoctorTheme.secondary, box)
        paint()
        return box
    }
    /** Bloque B: evaluación médica. */
    private fun evaluation(parent: LinearLayout, a: JSONObject) {
        val card = ui.card(parent, 18)
        ui.blockHeader(card, R.drawable.ic_d_stethoscope, s(R.string.dx_evaluation), s(R.string.dx_evaluation_sub), "B")
        val ro = ui.vbox(8, card)
        ui.label(s(R.string.dx_readonly_reported), R.drawable.ic_d_lock, DFont.CAPTION_SEMI, DoctorTheme.secondary, ro)
        reportedSymptoms(ro, symptoms(a), a.txt("other_symptoms"))
        noteField(card, R.drawable.ic_d_clipboard, s(R.string.dx_f_symptoms), s(R.string.dx_ph_symptoms), ctx.draft.subjective, s(R.string.dx_hint_symptoms)) { ctx.draft.subjective = it; onDraftChanged() }
        ui.divider(card)
        noteField(card, R.drawable.ic_d_note, s(R.string.dx_f_exploration), s(R.string.dx_ph_exploration), ctx.draft.objective) { ctx.draft.objective = it; onDraftChanged() }
        ui.divider(card)
        noteField(card, R.drawable.ic_d_medical_case, s(R.string.dx_f_diagnosis), s(R.string.dx_ph_diagnosis), ctx.draft.assessment) { ctx.draft.assessment = it; onDraftChanged() }
        ui.divider(card)
        noteField(card, R.drawable.ic_d_testtube, s(R.string.dx_f_plan), s(R.string.dx_ph_plan), ctx.draft.plan) { ctx.draft.plan = it; onDraftChanged() }
    }
    /** Bloque C: servicios adicionales. */
    private fun services(parent: LinearLayout) {
        val card = ui.card(parent, 14)
        ui.blockHeader(card, R.drawable.ic_d_grid, s(R.string.dx_services_extra), s(R.string.dx_services_extra_sub), "C")
        serviceButton(card, R.drawable.ic_d_testtube, s(R.string.dx_request_labs), s(R.string.dx_request_labs_sub),
            if (ctx.pendingLabs != null) s(R.string.dx_pending_send) else null) { clinicalSheet(true) }
        serviceButton(card, R.drawable.ic_d_pills, s(R.string.dx_prescribe), s(R.string.dx_prescribe_sub),
            if (ctx.rxLines.length() == 0) null else s(R.string.dx_rx_unissued, ctx.rxLines.length())) { clinicalSheet(false) }
    }
    private fun serviceButton(parent: LinearLayout, icon: Int, title: String, subtitle: String, badge: String?, onClick: () -> Unit) {
        val row = ui.hbox(14, parent).apply {
            minimumHeight = ui.dp(80); background = ui.rounded(Color.WHITE, 16, DoctorTheme.rose, 1.5f); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14))
        }
        ui.icon(icon, DoctorTheme.wine, 26, row, 52, ui.rounded(DoctorTheme.rose, 15))
        val t = ui.vbox(4, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(title, DFont.HEADLINE, DoctorTheme.ink, t); ui.text(subtitle, DFont.CAPTION, DoctorTheme.secondary, t)
        badge?.let { ui.pill(it, null, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION2_BOLD, t, 8, 3) }
        ui.icon(R.drawable.ic_d_chevron_right, DoctorTheme.alpha(DoctorTheme.wine, 0.7f), 18, row)
        row.contentDescription = title; ui.clickable(row, onClick)
    }
    private fun paintFinish() {
        val card = finishHolder ?: return
        card.removeAllViews()
        val blockers = ctx.finishBlockers(vitalIssues())
        if (blockers.isEmpty()) ui.label(s(R.string.dx_ready_finish), R.drawable.ic_d_check_circle, DFont.SUBHEAD_BOLD, DoctorTheme.greenInk, card)
        else {
            val box = ui.vbox(8, card).apply { background = ui.rounded(DoctorTheme.rose, 14); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
            ui.label(s(R.string.dx_missing_finish), R.drawable.ic_d_checklist, DFont.SUBHEAD_BOLD, DoctorTheme.wine, box)
            blockers.forEach { ui.label(blockerText(it), R.drawable.ic_d_circle, DFont.FOOTNOTE, DoctorTheme.wine, box) }
        }
        ui.borderedButton(s(R.string.dx_save_consult), R.drawable.ic_d_save, card, !busy && ctx.draft.canSave, 50, DFont.HEADLINE) { saveConsultation { rerender() } }
        ui.primaryButton(s(R.string.dx_finish_consult), R.drawable.ic_d_seal, card, blockers.isEmpty() && !busy, 58) {
            confirm(s(R.string.dx_finish_title), s(R.string.dx_finish_body), listOf(s(R.string.dx_finish_confirm) to {
                closeConsultation { ok -> if (ok) go("agenda") else rerender() }
            }), s(R.string.dx_back_to_consult))
        }.contentDescription = s(if (blockers.isEmpty()) R.string.dx_finish_hint_ok else R.string.dx_finish_hint_missing)
    }

    // ---------- Hojas de exámenes y receta ----------
    private fun clinicalSheet(labs: Boolean) {
        openSheet = sheet(s(if (labs) R.string.dx_request_labs else R.string.dx_prescribe_sheet), s(R.string.dx_back_to_consult), null) { body, dialog ->
            fun paint() {
                body.removeAllViews()
                ctx.selectedAppointment?.let { a ->
                    ui.label(s(R.string.dx_sheet_patient, a.value("patient_name"), a.value("record_number")), R.drawable.ic_d_person_circle, DFont.SUBHEAD_BOLD, DoctorTheme.wine, body)
                }
                if (busy) ui.progress(body, s(R.string.dx_sending))
                error?.let { ui.notice(it, body) }
                ctx.confirmation?.let { ui.label(it, R.drawable.ic_d_check_circle, DFont.FOOTNOTE_BOLD, DoctorTheme.wine, body) }
                if (labs) labSelection(body, { paint() }) else prescriptionForm(body, { paint() })
            }
            paint()
            if (labs && ctx.labCatalog.isEmpty()) loadLabCatalog { paint() }
            dialog.setOnDismissListener { openSheet = null; rerender() }
        }
    }
}

/** Agenda médica (misma vista con el título «Agenda médica»). */
class DoctorNativeAgendaActivity : DoctorNativeConsultActivity() { override val screen = "agenda" }

// ======================================================================
// Laboratorio dentro de la consulta y receta (formularios existentes)
// ======================================================================

fun DoctorNativeActivity.loadLabCatalog(done: () -> Unit) {
    ctx.labCatalogError = null
    work({ (repo.call("lab_catalog") as JSONArray).objects() }, { ctx.labCatalogError = describe(it); done() }) { ctx.labCatalog = it; done() }
}
fun DoctorNativeActivity.labSelection(parent: LinearLayout, repaint: () -> Unit, inSheet: Boolean = true) {
    val card = ui.card(parent, 16)
    val categories = ctx.labCatalog.map { it.txt("category") ?: s(R.string.dx_no_category) }.distinct().sorted()
    val selected = ctx.labCatalog.filter { ctx.selectedLabs.contains(it.optLong("id")) }
    ui.blockHeader(card, R.drawable.ic_d_testtube, s(R.string.dx_choose_tests), s(R.string.dx_choose_tests_sub), "1")
    if (busy && ctx.labCatalog.isEmpty()) ui.progress(card, s(R.string.dx_loading_catalog))
    ctx.labCatalogError?.let { ui.notice(it, card); ui.linkButton(s(R.string.dx_retry_catalog), null, card) { loadLabCatalog(repaint) } }
    val locked = ctx.pendingLabs != null
    val results = LinearLayout(this)
    fun fill() {
        results.removeAllViews()
        val list = ctx.labCatalog.filter { (ctx.labCategory == "all" || (it.txt("category") ?: s(R.string.dx_no_category)) == ctx.labCategory) &&
            (ctx.labQuery.isBlank() || it.value("name").contains(ctx.labQuery, true)) }
        val box = ui.vbox(10, results)
        if (list.isEmpty() && !busy) ui.text(s(if (ctx.labCatalog.isEmpty()) R.string.dx_no_tests else R.string.dx_no_tests_match), DFont.FOOTNOTE, DoctorTheme.secondary, box)
        list.forEach { test ->
            val id = test.optLong("id"); val on = ctx.selectedLabs.contains(id)
            val row = ui.hbox(10, box, center = false).apply {
                minimumHeight = ui.dp(64); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
                background = ui.rounded(if (on) DoctorTheme.rose else Color.WHITE, 14, if (on) DoctorTheme.wine else DoctorTheme.rose, if (on) 1.5f else 1f)
                contentDescription = s(R.string.dx_select_test, test.value("name")); isSelected = on
            }
            ui.icon(if (on) R.drawable.ic_d_check_circle else R.drawable.ic_d_circle, if (on) DoctorTheme.wine else DoctorTheme.alpha(DoctorTheme.secondary, 0.6f), 22, row)
            val t = ui.vbox(4, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            ui.text(test.value("name"), DFont.SUBHEAD_BOLD, DoctorTheme.ink, t)
            ui.text(test.txt("category") ?: s(R.string.dx_no_category), DFont.CAPTION, DoctorTheme.secondary, t)
            if (!locked) ui.clickable(row) { if (on) ctx.selectedLabs.remove(id) else if (ctx.selectedLabs.size < 30) ctx.selectedLabs.add(id); repaint() }
        }
    }
    val search = ui.searchField(card, s(R.string.dx_search_tests), ctx.labQuery) { ctx.labQuery = it; fill() }
    search.isEnabled = !locked
    val chips = ui.horizontalChips(card)
    ui.choiceChip(s(R.string.doc_all), R.drawable.ic_d_grid, ctx.labCategory == "all", chips) { if (!locked) { ctx.labCategory = "all"; repaint() } }
    categories.forEach { c -> ui.choiceChip(c, R.drawable.ic_d_drop, ctx.labCategory == c, chips) { if (!locked) { ctx.labCategory = c; repaint() } } }
    card.addView(results, LinearLayout.LayoutParams(-1, -2)); fill()
    ui.divider(card)
    ui.blockHeader(card, R.drawable.ic_d_clipboard, s(R.string.dx_summary_reason),
        resources.getQuantityString(R.plurals.dx_tests_selected, ctx.selectedLabs.size, ctx.selectedLabs.size), "2")
    if (selected.isEmpty()) ui.text(s(R.string.dx_no_tests_selected), DFont.FOOTNOTE, DoctorTheme.secondary, card)
    else {
        val flow = ui.flow(6, card)
        selected.forEach { test ->
            ui.pill(test.value("name"), R.drawable.ic_d_xmark, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION_SEMI, flow, 10, 6).apply {
                contentDescription = s(R.string.dx_remove_test, test.value("name"))
                if (!locked) ui.clickable(this) { ctx.selectedLabs.remove(test.optLong("id")); repaint() }
            }
        }
    }
    val submitHolder = LinearLayout(this)
    fun paintSubmit() {
        submitHolder.removeAllViews()
        ui.primaryButton(s(if (ctx.pendingLabs == null) R.string.dx_review_send_labs else R.string.dx_retry_same), R.drawable.ic_d_send, submitHolder, ctx.canIssueLabs) {
            val names = ctx.labCatalog.filter { ctx.selectedLabs.contains(it.optLong("id")) }.joinToString(", ") { it.value("name") }
            confirm(s(R.string.dx_send_labs_title), (if (names.isEmpty()) "" else "$names. ") + s(R.string.dx_send_labs_body),
                listOf(s(R.string.dx_confirm_labs) to { issueSelectedLabs(repaint) }), s(if (inSheet) R.string.dx_keep_editing else R.string.desk_cancel))
        }.layoutParams = LinearLayout.LayoutParams(-1, -2)
    }
    noteField(card, R.drawable.ic_d_chat, s(R.string.dx_lab_reason), s(R.string.dx_lab_reason_ph), ctx.instructions) { ctx.instructions = it; paintSubmit() }.isEnabled = !locked
    ctx.pendingLabs?.let { p ->
        val box = ui.vbox(6, card).apply { background = ui.rounded(DoctorTheme.rose, 14); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        ui.label(s(R.string.dx_unconfirmed), R.drawable.ic_d_refresh, DFont.SUBHEAD_BOLD, DoctorTheme.wine, box)
        ui.text(s(R.string.dx_unconfirmed_labs), DFont.FOOTNOTE, DoctorTheme.wine, box)
        ui.text("${p.label} · ${p.record.ifBlank { s(R.string.dx_record_unavailable) }}", DFont.CAPTION_SEMI, DoctorTheme.wine, box)
        ui.text(p.reason, DFont.CAPTION, DoctorTheme.wine, box, lines = 3)
    }
    card.addView(submitHolder, LinearLayout.LayoutParams(-1, -2)); paintSubmit()
}
fun DoctorNativeActivity.issueSelectedLabs(done: () -> Unit) {
    if (!ctx.canIssueLabs) return
    if (ctx.pendingLabs == null) {
        val encounter = ctx.activeConsultation ?: return
        val tests = ctx.selectedLabs.sorted()
        ctx.pendingLabs = DoctorPending("labs", args("p_encounter" to encounter.value("id"), "p_tests" to JSONArray(tests), "p_reason" to ctx.instructions.trim()),
            DoctorNativeContext.uuid(), ctx.selectedPatient?.txt("full_name") ?: ctx.selectedAppointment?.value("patient_name").orEmpty(),
            ctx.selectedPatient?.txt("record_number") ?: ctx.selectedAppointment?.value("record_number").orEmpty(), ctx.instructions.trim(), tests.size)
    }
    val pending = ctx.pendingLabs ?: return
    error = null; ctx.confirmation = null; done()
    work({ repo.call("labs", JSONObject(pending.values.toString()).put("p_key", pending.key)) }, { e ->
        error = describe(e)
        if (e is DoctorFailure && (e.status in setOf(400, 401, 403, 409, 422) || e.resource == R.string.doc_validation)) ctx.pendingLabs = null
        done()
    }) {
        ctx.pendingLabs = null; ctx.selectedLabs.clear(); ctx.instructions = ""
        ctx.confirmation = resources.getQuantityString(R.plurals.dx_labs_sent, pending.count, pending.count)
        done()
    }
}
fun DoctorNativeActivity.prescriptionForm(parent: LinearLayout, repaint: () -> Unit) {
    if (!ctx.canEdit) {
        val card = ui.card(parent, 10)
        ui.blockHeader(card, R.drawable.ic_d_pills, s(R.string.dx_issue_rx), s(R.string.dx_issue_rx_sub))
        ui.text(s(R.string.dx_open_for_rx), DFont.FOOTNOTE, DoctorTheme.secondary, card)
        ui.borderedButton(s(R.string.dx_go_agenda), R.drawable.ic_d_calendar, card) { go("consultation") }.layoutParams = LinearLayout.LayoutParams(-2, -2)
        return
    }
    val meds = ctx.medications
    fun label(m: JSONObject) = listOfNotNull(m.txt("name"), m.txt("strength"), m.txt("presentation")).joinToString(" · ")
    val card = ui.card(parent, 14)
    ui.blockHeader(card, R.drawable.ic_d_pills, s(R.string.dx_medication), s(R.string.dx_medication_sub), "1")
    var medQuery = ""
    ui.searchField(card, s(R.string.dx_search_meds), medQuery) { medQuery = it }
    val chosen = meds.firstOrNull { it.value("id") == ctx.rxMedication }
    val picker = ui.hbox(12, card).apply { background = ui.rounded(Color.WHITE, 14, DoctorTheme.rose, 1.5f); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)); contentDescription = s(R.string.dx_med_strength) }
    ui.icon(R.drawable.ic_d_pills, DoctorTheme.wine, 18, picker, 40, ui.rounded(DoctorTheme.rose, 11))
    val pt = ui.vbox(2, picker).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
    ui.text(s(R.string.dx_med_strength), DFont.CAPTION, DoctorTheme.secondary, pt)
    ui.text(chosen?.let { label(it) } ?: s(R.string.dx_select_med), DFont.SUBHEAD_SEMI, DoctorTheme.ink, pt)
    ui.icon(R.drawable.ic_d_chevron_down, DoctorTheme.wine, 14, picker)
    ui.clickable(picker) {
        val list = meds.filter { medQuery.isBlank() || label(it).contains(medQuery, true) }
        if (list.isEmpty()) return@clickable
        chooser(s(R.string.dx_med_strength), listOf<Pair<String?, String>>(null to s(R.string.dx_select_med)) + list.map { it.value("id") to label(it) }) { ctx.rxMedication = it; repaint() }
    }
    if (meds.isEmpty()) ui.text(s(R.string.dx_no_meds), DFont.FOOTNOTE, DoctorTheme.secondary, card)
    ui.divider(card)
    ui.blockHeader(card, R.drawable.ic_d_clipboard, s(R.string.dx_indication), s(R.string.dx_indication_sub), "2")
    ui.grid(card, listOf(
        { c: LinearLayout -> ui.labeledField(c, s(R.string.doc_dose), s(R.string.dx_eg_500), ctx.rxDose, DFont.CAPTION_SEMI, DoctorTheme.secondary, decimal = true, max = 12) { ctx.rxDose = it }},
        { c: LinearLayout -> ui.vbox(6, c).apply {
            ui.text(s(R.string.doc_dose_unit), DFont.CAPTION_SEMI, DoctorTheme.secondary, this)
            ui.hbox(6, this).apply {
                minimumHeight = ui.dp(44); background = ui.rounded(DoctorTheme.background, 12); setPadding(ui.dp(12), 0, ui.dp(12), 0)
                ui.text(ctx.rxUnit.ifBlank { s(R.string.dx_select) }, DFont.BODY, DoctorTheme.wine, this).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                ui.icon(R.drawable.ic_d_chevron_down, DoctorTheme.wine, 12, this)
                contentDescription = s(R.string.doc_dose_unit)
                ui.clickable(this) { chooser(s(R.string.doc_dose_unit), listOf<Pair<String?, String>>("" to s(R.string.dx_select)) + DoctorRules.doseUnits.map { it to it }) { ctx.rxUnit = it.orEmpty(); repaint() } }
            }
        } },
        { c: LinearLayout -> ui.labeledField(c, s(R.string.dx_every_hours), s(R.string.dx_eg_8), ctx.rxFrequency, DFont.CAPTION_SEMI, DoctorTheme.secondary, numeric = true, unit = "h", max = 3) { ctx.rxFrequency = it }},
        { c: LinearLayout -> ui.labeledField(c, s(R.string.doc_duration), s(R.string.dx_eg_5), ctx.rxDays, DFont.CAPTION_SEMI, DoctorTheme.secondary, numeric = true, unit = s(R.string.dx_days_unit), max = 3) { ctx.rxDays = it }},
        { c: LinearLayout -> ui.labeledField(c, s(R.string.dx_total_qty), s(R.string.dx_eg_15), ctx.rxQuantity, DFont.CAPTION_SEMI, DoctorTheme.secondary, numeric = true, unit = s(R.string.dx_units_unit), max = 5) { ctx.rxQuantity = it }}
    ))
    val route = ui.vbox(6, card)
    ui.text(s(R.string.dx_route), DFont.CAPTION_SEMI, DoctorTheme.secondary, route)
    ui.segmented(route, listOf("oral" to s(R.string.doc_oral), "inyectable" to s(R.string.doc_injectable)), ctx.rxRoute) { ctx.rxRoute = it }
    val ins = ui.vbox(6, card)
    ui.text(s(R.string.dx_patient_instructions), DFont.CAPTION_SEMI, DoctorTheme.secondary, ins)
    ui.field(ins, s(R.string.dx_how_when), ctx.rxInstructions, multiline = true, minLines = 2, max = 2000, padding = 12) { ctx.rxInstructions = it }.maxLines = 5
    ui.borderedButton(s(R.string.dx_add_to_rx), R.drawable.ic_d_add_circle, card, height = 48, font = DFont.HEADLINE) { addMedication(); repaint() }

    val review = ui.card(parent, 12)
    ui.blockHeader(review, R.drawable.ic_d_signature, s(R.string.dx_rx_review, ctx.rxLines.length()), s(R.string.dx_rx_review_sub), "3")
    if (ctx.rxLines.length() == 0) ui.text(s(R.string.dx_rx_empty_hint), DFont.FOOTNOTE, DoctorTheme.secondary, review)
    ctx.rxLines.objects().forEachIndexed { index, line ->
        val med = meds.firstOrNull { it.value("id") == line.value("medication_id") }
        val row = ui.hbox(12, review, center = false).apply { background = ui.rounded(DoctorTheme.background, 14); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)) }
        ui.icon(R.drawable.ic_d_pills, DoctorTheme.wine, 17, row, 36, ui.rounded(DoctorTheme.rose, 10))
        val t = ui.vbox(5, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(med?.let { label(it) }.orEmpty(), DFont.SUBHEAD_BOLD, DoctorTheme.ink, t)
        val flow = ui.flow(5, t)
        listOf("${line.value("dose")} ${line.value("dose_unit")}", s(R.string.dx_via, line.value("route")), s(R.string.dx_every_h, line.value("frequency_hours")),
            s(R.string.dx_n_days, line.value("duration_days")), s(R.string.dx_n_units, line.value("quantity"))).forEach {
            ui.pill(it, null, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION2_SEMI, flow, 8, 3)
        }
        ui.text(line.value("observations"), DFont.CAPTION, DoctorTheme.secondary, t)
        ui.icon(R.drawable.ic_d_trash, Color.rgb(255, 59, 48), 18, row).apply {
            contentDescription = s(R.string.dx_remove_line); isClickable = true; setOnClickListener { ctx.rxLines.remove(index); repaint() }
        }
    }
    ui.primaryButton(s(R.string.dx_review_issue_rx), R.drawable.ic_d_signature, review, ctx.rxLines.length() > 0) {
        val summary = ctx.rxLines.objects().joinToString("\n") { line ->
            val med = meds.firstOrNull { it.value("id") == line.value("medication_id") }?.let { label(it) }.orEmpty()
            s(R.string.dx_rx_line_summary, med, line.value("dose"), line.value("dose_unit"), line.value("frequency_hours"), line.value("duration_days"))
        }
        confirm(s(R.string.dx_issue_rx_title), summary, listOf(s(R.string.dx_confirm_issue_rx) to { issuePrescription(repaint) }), s(R.string.dx_keep_editing))
    }
}
fun DoctorNativeActivity.addMedication() {
    val med = ctx.medications.firstOrNull { it.value("id") == ctx.rxMedication }
    val dose = ctx.rxDose.replace(',', '.').toBigDecimalOrNull()
    val frequency = ctx.rxFrequency.toIntOrNull(); val quantity = ctx.rxQuantity.toIntOrNull(); val days = ctx.rxDays.toIntOrNull()
    if (!ctx.canEdit || ctx.rxLines.length() >= 30 || med == null || dose == null || dose.signum() <= 0 || dose > java.math.BigDecimal(100000) ||
        ctx.rxUnit.isBlank() || ctx.rxUnit.length > 40 || frequency !in 1..720 || quantity !in 1..10000 || days !in 1..365 ||
        ctx.rxRoute !in setOf("oral", "inyectable") || ctx.rxInstructions.isBlank() || ctx.rxInstructions.length > 2000) {
        error = s(R.string.dx_rx_invalid); return
    }
    ctx.rxLines.put(args("medication_id" to med.value("id"), "dose" to dose.stripTrailingZeros().toPlainString(), "dose_unit" to ctx.rxUnit,
        "frequency_hours" to frequency, "route" to ctx.rxRoute, "quantity" to quantity, "duration_days" to days, "observations" to ctx.rxInstructions))
    ctx.rxMedication = null; ctx.rxDose = ""; ctx.rxUnit = ""; ctx.rxFrequency = ""; ctx.rxQuantity = ""; ctx.rxDays = ""; ctx.rxInstructions = ""; error = null
}
fun DoctorNativeActivity.issuePrescription(done: () -> Unit) {
    val encounter = ctx.activeConsultation ?: return
    if (!ctx.canEdit || ctx.rxLines.length() == 0) return
    val lines = JSONArray(ctx.rxLines.toString()); val key = ctx.rxKey
    mutate(R.string.dx_rx_issued, {
        repo.call("prescribe", args("p_encounter" to encounter.value("id"), "p_key" to key, "p_lines" to lines))
        ctx.clearPrescription()
    }) { done() }
}

// ======================================================================
// Recetas (pantalla «prescriptions»)
// ======================================================================

class DoctorNativePrescriptionsActivity : DoctorNativeActivity() {
    override val screen = "prescriptions"
    private var chartFor: String? = null
    override fun render() {
        clear(false)
        moduleTop()
        if (ctx.workspace == null) { if (!busy && error == null) empty(s(R.string.dx_no_info)); return }
        datePickerRow(content, s(R.string.dx_care_date), ctx.day) { ctx.day = it; ctx.select(null); refreshWorkspace { rerender() } }
        val a = ctx.selectedAppointment
        if (a != null && a.txt("encounter_id") != null && chartFor != a.value("id")) { chartFor = a.value("id"); loadChart { rerender() } }
        val box = ui.vbox(16, content)
        val hero = ui.hero(box, 8, 24)
        ui.label(s(R.string.dx_rx_upper), R.drawable.ic_d_pills, DFont.CAPTION2_HEAVY, Color.WHITE, hero, tracking = 1.2f, alpha = 0.85f)
        ui.text(s(R.string.dx_rx_title), DFont.TITLE2, Color.WHITE, hero)
        ui.text(s(R.string.dx_rx_subtitle), DFont.SUBHEAD, Color.WHITE, hero, alpha = 0.9f)
        patientPicker(box)
        prescriptionForm(box) { rerender() }
        ui.label(s(R.string.dx_rx_history), R.drawable.ic_d_doc, DFont.HEADLINE, DoctorTheme.ink, box)
        val list = ctx.contextChart?.list("prescriptions").orEmpty()
        if (list.isEmpty()) ui.emptyState(box, R.drawable.ic_d_pills, s(R.string.dx_no_rx), s(if (a == null) R.string.dx_no_rx_select else R.string.dx_no_rx_yet))
        list.forEach { p ->
            val card = ui.card(box, 8)
            val row = ui.hbox(8, card)
            ui.label(p.value("code"), R.drawable.ic_d_doc, DFont.HEADLINE, DoctorTheme.ink, row)
            ui.spacerView(row)
            ui.pill(if (p.value("status") == "pendiente") s(R.string.dx_pending_delivery) else p.value("status"), null, DoctorTheme.wine, DoctorTheme.rose, DFont.CAPTION2_BOLD, row)
            ui.text(DoctorFormat.display(p.value("issued_at"), s(R.string.dx_unavailable)), DFont.CAPTION, DoctorTheme.secondary, card)
            p.strings("lines").forEach { ui.label(it, R.drawable.ic_d_pills, DFont.FOOTNOTE, DoctorTheme.ink, card) }
        }
    }
    /** patientPicker de DoctorModuleView. */
    private fun patientPicker(parent: LinearLayout) {
        val card = ui.card(parent, 12)
        ui.blockHeader(card, R.drawable.ic_d_person_circle, s(R.string.dx_patient), s(R.string.dx_patient_picker_sub))
        val a = ctx.selectedAppointment
        val menu = ui.hbox(12, card).apply { background = ui.rounded(DoctorTheme.background, 14); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)); contentDescription = s(R.string.dx_patient_turn) }
        ui.circleText(a?.let { DoctorRules.initials(it.value("patient_name")) } ?: "?", 44, DoctorTheme.wine, DoctorTheme.rose, DFont.HEADLINE, menu)
        val t = ui.vbox(2, menu).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(s(R.string.dx_patient_turn), DFont.CAPTION, DoctorTheme.secondary, t)
        ui.text(a?.value("patient_name") ?: s(R.string.dx_select_patient), DFont.SUBHEAD_SEMI, DoctorTheme.ink, t)
        ui.icon(R.drawable.ic_d_chevron_down, DoctorTheme.wine, 14, menu)
        ui.clickable(menu) {
            val day = DoctorRules.dayAppointments(ctx.appointments, ctx.day)
            chooser(s(R.string.dx_patient_turn), listOf<Pair<String?, String>>(null to s(R.string.dx_select_patient)) +
                day.map { it.value("id") to "${it.value("patient_name")} · ${it.txt("ticket_number") ?: it.value("record_number")}" }) { id ->
                if (ctx.rxLines.length() > 0 || ctx.pendingLabs != null) { error = s(R.string.doc_pending); rerender(); return@chooser }
                ctx.select(id); chartFor = null; rerender()
            }
        }
        if (a == null) { ui.text(s(R.string.dx_select_from_agenda), DFont.FOOTNOTE, DoctorTheme.secondary, card); return }
        fun tile(title: String, value: String) = { c: LinearLayout -> ui.vbox(2, c).apply {
            background = ui.rounded(DoctorTheme.background, 10); setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10))
            ui.text(title, DFont.CAPTION2, DoctorTheme.secondary, this); ui.text(value, DFont.FOOTNOTE_SEMI, DoctorTheme.ink, this)
        } }
        val minutes = if (a.isNull("duration_minutes")) null else a.optInt("duration_minutes")
        ui.grid(card, listOf(tile(s(R.string.dx_age), age(a)), tile(s(R.string.dx_record), a.value("record_number")),
            tile(s(R.string.dx_consulting_room), a.txt("room_code") ?: s(R.string.dx_unpublished)),
            tile(s(R.string.dx_duration), minutes?.let { s(R.string.dx_minutes_long, it) } ?: s(R.string.dx_unpublished_f)),
            tile(s(R.string.dx_turn), a.txt("ticket_number") ?: s(R.string.dx_no_turn)), tile(s(R.string.dx_phone), a.txt("phone") ?: s(R.string.dx_unreg_m))))
        ui.detail(s(R.string.dx_requested_specialty), a.txt("specialty") ?: s(R.string.dx_direct_appt), card)
        ui.detail(s(R.string.dx_original_reason), a.txt("reason") ?: s(R.string.dx_no_attention_request), card)
        ui.detail(s(R.string.dx_declared_symptoms), symptoms(a).joinToString(", ").ifBlank { missing() }, card)
        a.txt("other_symptoms")?.let { ui.detail(s(R.string.dx_other_symptoms_label), it, card) }
    }
}
