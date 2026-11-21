package sv.edu.catolica.hospital_universitario

import android.graphics.Color
import android.view.View
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject

/** Inicio del médico: DoctorDashboardView de iOS. */
class DoctorNativeHomeActivity : DoctorNativeActivity() {
    override val screen = "home"
    override fun onPoll() { if (!busy) refreshWorkspace { rerender() } }
    override fun render() {
        clear(false)
        moduleTop()
        val w = ctx.workspace
        if (w == null) { if (error == null && !busy) empty(s(R.string.dx_no_info)); return }
        ctx.alerts.firstOrNull { it.txt("read_at") == null && it.value("title") == s(R.string.dx_next_reminder_title) }?.let { reminder ->
            val card = ui.hospitalCard(content)
            ui.label(reminder.value("title"), R.drawable.ic_d_bell_fill, DFont.HEADLINE, DoctorTheme.wine, card)
            ui.text(reminder.value("body"), DFont.SUBHEAD, DoctorTheme.ink, card)
            ui.linkButton(s(R.string.dx_view_alerts), null, card) { showNotifications() }
        }
        val name = w.value("doctor_name")
        val today = DoctorRules.dayAppointments(ctx.appointments, ctx.day)
        val consultations = today.count { it.value("status") !in setOf("cancelled", "rejected", "no_show") }
        val pending = today.count { it.value("status") in setOf("scheduled", "confirmed", "in_progress") }
        val completed = today.count { it.value("status") == "completed" }
        val now = java.time.ZonedDateTime.now(DoctorRules.zone)
        val next = DoctorRules.upcomingAfterDay(ctx.appointments, ctx.day).firstOrNull { it.value("status") == "in_progress" || (DoctorRules.start(it)?.isBefore(now) == false) }

        // Saludo
        val greet = ui.hospitalCard(content)
        val row = ui.hbox(14, greet)
        val texts = ui.vbox(6, row).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        ui.text(s(R.string.doc_greeting, name), DFont(22f, 2), DoctorTheme.ink, texts)
        ui.text(s(R.string.dx_home_tagline), DFont(12f), DoctorTheme.secondary, texts)
        val initials = name.split(" ").filter { it.isNotBlank() && it !in setOf("Dr.", "Dra.") }.take(2).mapNotNull { it.firstOrNull()?.toString() }.joinToString("").uppercase()
        ui.circleText(initials, 58, DoctorTheme.wine, DoctorTheme.rose, DFont(18f, 1), row).contentDescription = s(R.string.dx_initials_a11y, name)

        // Jornada de hoy
        val hero = ui.hero(content, 16, 20)
        ui.label(s(R.string.dx_today_label), R.drawable.ic_d_calendar, DFont.CAPTION_BOLD, Color.WHITE, hero, tracking = 1f)
        ui.text(DoctorFormat.dayMonth(DoctorRules.today()), DFont.HEADLINE, Color.WHITE, hero)
        val metrics = ui.hbox(8, hero, center = false)
        listOf(consultations to R.string.dx_m_scheduled, pending to R.string.dx_m_pending, completed to R.string.dx_m_finished).forEach { (count, label) ->
            val box = ui.vbox(6, metrics).apply {
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f); background = ui.rounded(DoctorTheme.alpha(Color.WHITE, 0.1f), 12)
                setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10))
            }
            ui.text(count.toString(), DFont(28f, 2), Color.WHITE, box).typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
            ui.text(s(label), DFont.CAPTION, Color.WHITE, box, lines = 1)
        }

        // Próxima cita
        val nextCard = ui.hospitalCard(content)
        ui.label(s(R.string.dx_next_label), R.drawable.ic_d_clock, DFont.CAPTION_BOLD, DoctorTheme.wine, nextCard)
        if (next != null) {
            ui.text(next.value("patient_name"), DFont.TITLE3, DoctorTheme.ink, nextCard)
            ui.text(DoctorFormat.period(next, s(R.string.dx_no_schedule)), DFont.SUBHEAD, DoctorTheme.ink, nextCard)
            ui.text(next.txt("room_code")?.let { s(R.string.dx_room, it) } ?: s(R.string.dx_room_unpublished), DFont.FOOTNOTE, DoctorTheme.secondary, nextCard)
        } else {
            ui.text(s(R.string.dx_agenda_clear), DFont.TITLE3, DoctorTheme.ink, nextCard)
            ui.text(s(R.string.dx_agenda_clear_body), DFont.SUBHEAD, DoctorTheme.secondary, nextCard)
        }
        ui.linkButton(s(R.string.dx_view_agenda), R.drawable.ic_d_arrow_right, nextCard, DFont.SUBHEAD_BOLD) { go("agenda") }

        ui.heading(s(R.string.dx_quick_access), content)
        ui.grid(content, listOf(
            Triple(R.drawable.ic_d_calendar, R.string.dx_t_agenda_short, "agenda"), Triple(R.drawable.ic_d_people, R.string.doc_tab_patients, "patients"),
            Triple(R.drawable.ic_d_testtube, R.string.doc_tab_labs, "laboratory"), Triple(R.drawable.ic_d_bed, R.string.dx_t_admissions, "admissions")
        ).map { (icon, title, id) -> { cell: LinearLayout -> quickAccess(cell, icon, s(title)) { go(id) } } })
    }
    /** PatientQuickAccessCard */
    private fun quickAccess(parent: LinearLayout, icon: Int, title: String, onClick: () -> Unit): View = ui.vbox(12, parent).apply {
        background = ui.rounded(Color.WHITE, 14, Color.argb(89, 164, 19, 60)); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14))
        minimumHeight = ui.dp(92)
        ui.icon(icon, DoctorTheme.wine, 16, this, 40, ui.oval(DoctorTheme.rose))
        ui.text(title, DFont(13f, 1), DoctorTheme.ink, this)
        contentDescription = title; ui.clickable(this, onClick)
    }
}

/** «Más» del médico: legacyMenu de ContentView. */
class DoctorNativeMoreActivity : DoctorNativeActivity() {
    override val screen = "more"
    override val loadsWorkspace = false
    private val entries = listOf("admissions" to R.string.dx_t_admissions, "ambulance" to R.string.dx_t_ambulance, "patients" to R.string.dx_t_patients,
        "consultation" to R.string.dx_t_consultation, "chart" to R.string.dx_t_chart, "prescriptions" to R.string.dx_t_prescriptions,
        "laboratory" to R.string.dx_t_laboratory, "turns" to R.string.dx_t_turns, "notifications" to R.string.dx_t_notifications, "profile" to R.string.dx_t_profile)
    private fun matches(text: String) = search.isBlank() || text.contains(search.trim(), true)
    override fun render() {
        clear(false)
        val list = ui.vbox(10, content)
        ui.text(s(R.string.dx_services), DFont(16f, 1), DoctorTheme.ink, list)
        entries.filter { matches(s(it.second)) }.forEach { (id, title) ->
            val card = ui.hospitalCard(list)
            val row = ui.hbox(8, card)
            ui.text(s(title), DFont.SUBHEAD, DoctorTheme.ink, row).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            ui.icon(R.drawable.ic_d_chevron_right, DoctorTheme.ink, 12, row)
            ui.clickable(card) { go(id) }
        }
        if (matches(s(R.string.dx_t_rooms))) {
            val card = ui.hospitalCard(list).apply { minimumHeight = ui.dp(95) }
            ui.icon(R.drawable.ic_d_bed, DoctorTheme.wine, 20, card)
            ui.text(s(R.string.dx_t_rooms), DFont(11f, 1), DoctorTheme.ink, card).setPadding(0, ui.dp(10), 0, 0)
            ui.clickable(card) { go("rooms") }
        }
        val out = ui.vbox(0, list).apply { gravity = android.view.Gravity.CENTER_HORIZONTAL; setPadding(0, ui.dp(16), 0, ui.dp(16)) }
        ui.linkButton(s(R.string.dx_sign_out), null, out) { Navigator.logoutNow(this) }
    }
}

/** Mi horario: ContentView.schedule (jornada real asignada por administración). */
class DoctorNativeScheduleActivity : DoctorNativeActivity() {
    override val screen = "turns"
    override val loadsWorkspace = false
    override fun onCreate(state: android.os.Bundle?) { super.onCreate(state); if (ready) load() }
    override fun onPoll() { if (!busy) load(silent = true) }
    private fun load(silent: Boolean = false) {
        val start = ctx.scheduleWeek ?: DoctorWeek.weekStart()
        if (!silent) { ctx.weekError = false; rerender() }
        work({
            val uid = SessionManager.userId ?: throw DoctorFailure(R.string.doc_access_error)
            val staff = ctx.staffId ?: (repo.rest("staff?select=id&profile_id=eq.${enc(uid)}&limit=1") as JSONArray).objects().firstOrNull()?.value("id")
                ?: throw DoctorFailure(R.string.doc_access_error)
            ctx.staffId = staff
            val from = start.atStartOfDay(DoctorRules.zone).toOffsetDateTime(); val to = from.plusDays(7)
            val recurring = runCatching { repo.call("schedule", args("p_from" to from.toString(), "p_until" to to.toString())) as? JSONObject }.getOrNull()
            val schedules = (repo.rest("doctor_schedules?select=id,doctor_id,weekday,start_time,end_time,valid_from,valid_until,active&doctor_id=eq.$staff&active=eq.true&order=weekday.asc,start_time.asc&limit=500") as JSONArray).objects()
            val absences = (repo.rest("staff_absences?select=id,staff_id,starts_at,ends_at,reason,active&staff_id=eq.$staff&active=eq.true&starts_at=lt.${enc(to.toString())}&ends_at=gt.${enc(from.toString())}&order=starts_at.asc&limit=100") as JSONArray).objects()
            val shifts = (repo.rest("staff_shifts?select=id,staff_id,starts_at,ends_at,shift_type,status&staff_id=eq.$staff&starts_at=lt.${enc(to.toString())}&ends_at=gt.${enc(from.toString())}&order=starts_at.asc&limit=100") as JSONArray).objects()
            DoctorWeek.build(schedules, absences, shifts, start, recurring)
        }, { if (!silent) { ctx.week = null; ctx.weekError = true; error = describe(it); rerender() } }) { week ->
            val first = ctx.week == null && ctx.scheduleWeek == null
            ctx.week = week; ctx.weekError = false; error = null; rerender()
            if (first) DoctorReminders.scheduleBreaks(this, week)
        }
    }
    private fun hours(m: Int) = if (m % 60 == 0) s(R.string.dx_hours, m / 60) else s(R.string.dx_hours_min, m / 60, m % 60)
    private fun changeWeek(offset: Long) {
        val current = ctx.week?.start ?: return
        ctx.scheduleWeek = if (offset == 0L) null else current.plusWeeks(offset)
        load()
    }
    override fun render() {
        clear(false)
        val box = ui.vbox(16, content)
        val week = ctx.week
        if (week != null) {
            val hero = ui.hero(box, 12, 24)
            ui.label(s(R.string.dx_my_schedule), R.drawable.ic_d_calendar, DFont.CAPTION2_HEAVY, Color.WHITE, hero, tracking = 1.2f, alpha = 0.85f)
            ui.text(DoctorFormat.dayMonthOnly(week.start) + " – " + DoctorFormat.dayMonthOnly(week.end), DFont.TITLE3, Color.WHITE, hero)
            ui.text(s(R.string.dx_week_summary, hours(week.totalMinutes), week.days.count { !it.free }), DFont.SUBHEAD, Color.WHITE, hero, alpha = 0.9f)
            val nav = ui.hbox(8, hero)
            ui.circleIconButton(R.drawable.ic_d_chevron_left, s(R.string.dx_prev_week), nav, 38, Color.WHITE) { changeWeek(-1) }
            ui.text(s(R.string.dx_this_week), DFont.SUBHEAD_BOLD, DoctorTheme.wine, nav).apply {
                background = ui.capsule(Color.WHITE); setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(10)); minHeight = ui.dp(38)
                alpha = if (ctx.scheduleWeek == null) 0.6f else 1f; ui.clickable(this) { if (ctx.scheduleWeek != null) changeWeek(0) }
            }
            ui.circleIconButton(R.drawable.ic_d_chevron_right, s(R.string.dx_next_week), nav, 38, Color.WHITE) { changeWeek(1) }
            week.days.forEach { day(box, it) }
            ui.borderedButton(s(R.string.dx_break_reminders), R.drawable.ic_d_bell, box, height = 44) {
                if (DoctorReminders.requestPermission(this)) DoctorReminders.scheduleBreaks(this, week)
            }
            ui.text(s(R.string.dx_schedule_note), DFont.CAPTION, DoctorTheme.secondary, box)
        } else if (busy || (!ctx.weekError && error == null)) ui.progress(box, s(R.string.dx_loading_schedule))
        else empty(s(R.string.dx_schedule_failed), box)
        error?.let { ui.text(it, DFont.FOOTNOTE, Color.rgb(255, 59, 48), box) }
    }
    private fun day(parent: LinearLayout, day: DoctorWeek.Day) {
        val card = ui.vbox(12, parent).apply {
            background = ui.rounded(Color.WHITE, 18, if (day.today) DoctorTheme.wine else DoctorTheme.rose, if (day.today) 1.5f else 1f)
            setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16))
        }
        val head = ui.hbox(8, card)
        val names = ui.vbox(2, head).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val weekdays = resources.getStringArray(R.array.dx_weekdays)
        ui.text(weekdays[day.weekday], DFont.HEADLINE, DoctorTheme.ink, names)
        ui.text(DoctorFormat.dayMonthOnly(day.date), DFont.CAPTION, DoctorTheme.secondary, names)
        if (day.today) ui.pill(s(R.string.dx_today), null, Color.WHITE, DoctorTheme.wine, DFont.CAPTION2_BOLD, head, 10, 4)
        if (day.minutes > 0) ui.text(hours(day.minutes), DFont.CAPTION_SEMI, DoctorTheme.wine, head)
        if (day.free && day.absences.isEmpty()) ui.label(s(R.string.dx_free_day), R.drawable.ic_d_sun, DFont.SUBHEAD_SEMI, DoctorTheme.secondary, card)
        day.blocks.forEach { b ->
            row(card, if (b.shift == "afternoon") R.drawable.ic_d_sunset else R.drawable.ic_d_sunrise,
                s(if (b.shift == "afternoon") R.string.dx_afternoon else R.string.dx_morning), "${b.start} – ${b.end}", DoctorTheme.wine, DoctorTheme.rose)
        }
        day.breaks.forEach { b ->
            if (b.kind == "gap") row(card, R.drawable.ic_d_pause, s(R.string.dx_between), "${b.start} – ${b.end}", DoctorTheme.secondary, DoctorTheme.background)
            else row(card, if (b.kind == "lunch") R.drawable.ic_d_fork else R.drawable.ic_d_cup,
                if (b.kind == "lunch") s(R.string.dx_lunch) else b.label.ifBlank { s(R.string.dx_break) }, "${b.start} – ${b.end}", DoctorTheme.greenInk, DoctorTheme.green)
        }
        day.shifts.forEach { sh ->
            row(card, R.drawable.ic_d_clock, s(R.string.dx_assigned_shift, sh.type.replaceFirstChar { it.uppercase() }), "${sh.start} – ${sh.end}", DoctorTheme.ink, DoctorTheme.background)
        }
        day.absences.forEach { a ->
            row(card, R.drawable.ic_d_person, s(R.string.dx_absence, a.reason.ifBlank { s(R.string.dx_absence_default) }),
                if (a.allDay) s(R.string.dx_all_day) else "${a.start.orEmpty()} – ${a.end.orEmpty()}", DoctorTheme.warnInk, DoctorTheme.warnFill)
        }
    }
    private fun row(parent: LinearLayout, icon: Int, title: String, value: String, tint: Int, fill: Int) {
        val row = ui.hbox(12, parent)
        ui.icon(icon, tint, 16, row, 34, ui.rounded(fill, 10))
        ui.text(title, DFont.SUBHEAD, DoctorTheme.ink, row).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        ui.text(value, DFont.SUBHEAD_BOLD, tint, row, lines = 1).fontFeatureSettings = "tnum"
    }
}

/** Perfil del médico: «Datos de registro» + tarjeta de seguridad. */
class DoctorNativeProfileActivity : DoctorNativeActivity() {
    override val screen = "profile"
    override val loadsWorkspace = false
    private var given: String? = null
    private var family: String? = null
    private var current = ""; private var newPassword = ""; private var confirmPassword = ""; private var visible = false
    private var passwordError: String? = null; private var passwordSuccess: String? = null; private var saving = false
    override fun onCreate(state: android.os.Bundle?) {
        super.onCreate(state)
        if (!ready) return
        val uid = SessionManager.userId ?: return
        work({ (repo.rest("profiles?select=first_name,last_name&id=eq.${enc(uid)}&limit=1") as JSONArray).objects().firstOrNull() }, { rerender() }) {
            given = it?.txt("first_name"); family = it?.txt("last_name"); rerender()
        }
    }
    override fun onDestroy() { current = ""; newPassword = ""; confirmPassword = ""; super.onDestroy() }
    private fun problem(): String? = when {
        current.isEmpty() -> s(R.string.dx_pw_current)
        newPassword.length < 8 -> s(R.string.dx_pw_short)
        newPassword.length > 72 -> s(R.string.dx_pw_long)
        newPassword == current -> s(R.string.dx_pw_same)
        confirmPassword != newPassword -> s(R.string.dx_pw_confirm)
        else -> null
    }
    override fun render() {
        clear(false)
        val box = ui.vbox(18, content)
        val head = ui.hbox(14, box).apply { setPadding(0, ui.dp(10), 0, ui.dp(10)) }
        ui.icon(R.drawable.ic_d_person_circle, DoctorTheme.wine, 48, head)
        ui.text(s(R.string.dx_registration_data), DFont(22f, 2), DoctorTheme.ink, head)
        listOf(R.string.dx_first_name to given, R.string.dx_last_name to family).forEach { (label, value) ->
            val card = ui.hospitalCard(box)
            val field = ui.vbox(5, card)
            ui.text(s(label), DFont.CAPTION_SEMI, DoctorTheme.secondary, field)
            ui.text(value ?: s(R.string.dx_not_available), DFont.SUBHEAD, DoctorTheme.ink, field)
        }
        passwordCard(box)
    }
    private fun passwordCard(parent: LinearLayout) {
        val card = ui.vbox(14, parent).apply { background = ui.rounded(Color.WHITE, 20, DoctorTheme.rose); setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(18)) }
        val head = ui.hbox(12, card)
        ui.icon(R.drawable.ic_d_lock, DoctorTheme.wine, 18, head, 40, ui.rounded(DoctorTheme.rose, 12))
        val t = ui.vbox(2, head)
        ui.text(s(R.string.dx_security), DFont.HEADLINE, DoctorTheme.ink, t)
        ui.text(s(R.string.dx_security_body), DFont.CAPTION, DoctorTheme.secondary, t)
        lateinit var problemView: android.widget.TextView
        lateinit var submit: LinearLayout
        fun refresh() {
            val p = problem(); val touched = current.isNotEmpty() || newPassword.isNotEmpty() || confirmPassword.isNotEmpty()
            problemView.text = p.orEmpty(); problemView.visibility = if (touched && p != null) View.VISIBLE else View.GONE
            submit.alpha = if (p == null && !saving) 1f else 0.55f; submit.isEnabled = p == null && !saving
        }
        listOf(Triple(R.string.dx_pw_label_current, current) { v: String -> current = v }, Triple(R.string.dx_pw_label_new, newPassword) { v: String -> newPassword = v },
            Triple(R.string.dx_pw_label_confirm, confirmPassword) { v: String -> confirmPassword = v }).forEach { (label, value, set) ->
            val f = ui.vbox(5, card)
            ui.text(s(label), DFont.CAPTION_SEMI, DoctorTheme.ink, f)
            ui.field(f, s(label), value, password = !visible, padding = 12) { set(it); refresh() }
        }
        val toggle = ui.hbox(8, card)
        ui.text(s(R.string.dx_pw_show), DFont.FOOTNOTE, DoctorTheme.ink, toggle).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        toggle.addView(com.google.android.material.materialswitch.MaterialSwitch(this).apply {
            isChecked = visible; trackTintList = android.content.res.ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(DoctorTheme.wine, DoctorTheme.divider))
            setOnCheckedChangeListener { _, on -> visible = on; rerender() }
        })
        ui.label(s(R.string.dx_pw_hint), R.drawable.ic_d_info, DFont.CAPTION, DoctorTheme.secondary, card)
        problemView = ui.text("", DFont.FOOTNOTE_SEMI, DoctorTheme.wine, card)
        passwordError?.let { ui.label(it, R.drawable.ic_d_warning, DFont.FOOTNOTE_SEMI, DoctorTheme.errorInk, card).apply { background = ui.rounded(DoctorTheme.errorFill, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)); layoutParams = LinearLayout.LayoutParams(-1, -2) } }
        passwordSuccess?.let { ui.label(it, R.drawable.ic_d_check_circle, DFont.FOOTNOTE_SEMI, DoctorTheme.successInk, card).apply { background = ui.rounded(DoctorTheme.successFill, 12); setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12)); layoutParams = LinearLayout.LayoutParams(-1, -2) } }
        submit = ui.primaryButton(s(if (saving) R.string.dx_pw_updating else R.string.dx_pw_update), R.drawable.ic_d_shield, card, height = 50, radius = 14) {
            if (problem() != null || saving) return@primaryButton
            saving = true; passwordError = null; passwordSuccess = null; rerender()
            val c = current; val n = newPassword
            work({ repo.changePassword(c, n) }, { e ->
                saving = false; passwordError = if (e is AuthException && e.messageRes == R.string.error_invalid_credentials) s(R.string.dx_pw_wrong) else s(R.string.dx_pw_failed); rerender()
            }) { saving = false; current = ""; newPassword = ""; confirmPassword = ""; passwordSuccess = s(R.string.dx_pw_done); rerender() }
        }
        refresh()
    }
}

/**
 * Habitaciones del médico (paridad con DoctorRoomsView de iOS). RPC: doctor_native_rooms, room_candidates,
 * hospitalize, assign_bed y discharge (supabase/paciente-ambulancia-habitaciones-medico.sql).
 * - Mapa de habitaciones/camas con detalle; las camas ocupadas no se pueden asignar (el servidor lo valida con FOR UPDATE).
 * - Solo se hospitalizan pacientes que ya pasaron consulta con este médico; el alta solo aplica a sus propios hospitalizados.
 */
class DoctorNativeRoomsActivity : DoctorNativeActivity() {
    override val screen = "rooms"
    override val loadsWorkspace = false
    private var board: JSONObject? = null
    private var tab = 0
    private var mode = "list"               // list | room | patient | hospitalize | assign
    private var roomId: String? = null
    private var admission: JSONObject? = null
    private var bed: JSONObject? = null
    private var candidates = listOf<JSONObject>()
    private var candidate: JSONObject? = null
    private var query = ""
    private var reason = ""
    private var instructions = ""
    private var notes = ""
    private var urgent = false
    private var saving = false
    private var notice: String? = null
    private var hospitalizeKey = java.util.UUID.randomUUID().toString()
    private val subviewBack = object : androidx.activity.OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { show("list") }
    }

    override fun onCreate(state: android.os.Bundle?) {
        super.onCreate(state)
        onBackPressedDispatcher.addCallback(this, subviewBack)
        if (ready) load()
    }
    private fun show(next: String) { mode = next; subviewBack.isEnabled = next != "list"; rerender() }
    private fun load() { work({ repo.call("rooms") as JSONObject }) { board = it; error = null; rerender() } }
    private val rooms: List<JSONObject> get() = board?.list("rooms").orEmpty()
    private val hospitalized: List<JSONObject> get() = board?.list("hospitalized").orEmpty()
    private fun beds(room: JSONObject) = room.list("beds")
    private fun category(v: String) = when (v) { "vip" -> "VIP"; "semiprivada" -> "Semiprivada"; else -> v }
    private fun status(v: String) = mapOf("solicitado" to "Pendiente de cama", "asignado" to "Asignado", "hospitalizado" to "Hospitalizado",
        "alta_medica" to "Alta médica", "cerrado" to "Cerrado").getOrElse(v) { v }
    private fun date(v: String?) = v?.take(16)?.replace('T', ' ') ?: "—"

    private fun mutate(op: String, values: JSONObject, success: String, after: () -> Unit = {}) {
        if (saving) return
        saving = true; notice = null; error = null; rerender()
        work({ repo.call(op, values) }, { e -> saving = false; error = describe(e); load() }) {
            saving = false; notice = success; after(); show("list"); load()
        }
    }

    override fun render() {
        clear(false)
        val box = ui.vbox(12, content)
        notice?.let { ui.text(it, DFont.FOOTNOTE, DoctorTheme.wine, box) }
        error?.let { ui.text(it, DFont.FOOTNOTE, Color.RED, box) }
        if (mode != "list") ui.linkButton("Volver", R.drawable.ic_d_chevron_left, box) { show("list") }
        when (mode) {
            "room" -> renderRoom(box)
            "patient" -> renderPatient(box)
            "hospitalize" -> renderHospitalize(box)
            "assign" -> renderAssign(box)
            else -> renderList(box)
        }
    }

    private fun renderList(box: LinearLayout) {
        val allBeds = rooms.flatMap { beds(it) }
        val head = ui.hospitalCard(box)
        ui.label("Habitaciones", R.drawable.ic_d_bed, DFont.SUBHEAD_BOLD, DoctorTheme.wine, head)
        ui.text("${allBeds.count { it.optBoolean("available") }} camas libres · ${allBeds.count { it.value("state") == "ocupada" }} ocupadas · " +
            "${hospitalized.count { it.value("status") == "hospitalizado" }} pacientes míos", DFont.FOOTNOTE, DoctorTheme.secondary, head)
        val tabs = ui.hbox(16, box)
        ui.linkButton(if (tab == 0) "● Habitaciones" else "Habitaciones", null, tabs) { tab = 0; rerender() }
        ui.linkButton(if (tab == 1) "● Mis hospitalizados" else "Mis hospitalizados", null, tabs) { tab = 1; rerender() }
        if (board == null) { if (!busy) empty("No se pudieron cargar las habitaciones.", box); return }
        val q = search.trim()
        if (tab == 0) {
            val list = rooms.filter { q.isBlank() || it.value("code").contains(q, true) || it.value("floor").contains(q, true) }
            list.forEach { room ->
                val free = beds(room).count { it.optBoolean("available") }
                val active = room.optBoolean("active")
                val card = ui.hospitalCard(box)
                ui.label("${room.value("code")} · ${category(room.value("kind"))}", R.drawable.ic_d_bed, DFont.SUBHEAD_SEMI, DoctorTheme.ink, card)
                ui.text("${room.value("floor")} · ${beds(room).size} cama(s)" + (if (beds(room).any { it.optBoolean("mine") }) " · tienes pacientes aquí" else ""),
                    DFont.CAPTION, DoctorTheme.secondary, card)
                ui.badge(if (!active) "Inactiva" else if (free > 0) "$free libre(s)" else "Ocupada", free == 0 || !active, card)
                ui.clickable(card) { roomId = room.value("id"); show("room") }
            }
            if (list.isEmpty()) empty("No hay habitaciones que coincidan.", box)
        } else {
            val match = { a: JSONObject -> q.isBlank() || a.value("patient_name").contains(q, true) || a.value("record_number").contains(q, true) }
            val pending = hospitalized.filter { it.value("status") == "solicitado" && match(it) }
            if (pending.isNotEmpty()) ui.heading("Pendientes de cama", box)
            pending.forEach { a ->
                val card = ui.hospitalCard(box)
                ui.text(a.value("patient_name"), DFont.SUBHEAD_SEMI, DoctorTheme.ink, card)
                ui.text("${category(a.value("category"))} · ${a.value("reason")}", DFont.CAPTION, DoctorTheme.secondary, card)
                ui.linkButton("Asignar cama", R.drawable.ic_d_bed, card) { admission = a; show("assign") }
            }
            ui.heading("Hospitalizados por mí", box)
            val mine = hospitalized.filter { it.value("status") != "solicitado" && match(it) }
            mine.forEach { a ->
                val card = ui.hospitalCard(box)
                ui.text(a.value("patient_name"), DFont.SUBHEAD_SEMI, DoctorTheme.ink, card)
                ui.text(listOfNotNull(a.txt("record_number"), a.txt("room")?.let { "$it · ${a.value("bed")}" }, status(a.value("status"))).joinToString(" · "),
                    DFont.CAPTION, DoctorTheme.secondary, card)
                ui.clickable(card) { admission = a; notes = ""; show("patient") }
            }
            if (mine.isEmpty()) empty("No tienes pacientes hospitalizados.", box)
        }
    }

    private fun renderRoom(box: LinearLayout) {
        val room = rooms.firstOrNull { it.value("id") == roomId } ?: run { renderList(box); return }
        val info = ui.hospitalCard(box)
        ui.label(room.value("code"), R.drawable.ic_d_bed, DFont.SUBHEAD_BOLD, DoctorTheme.wine, info)
        ui.text("Categoría: ${category(room.value("kind"))}\nPiso: ${room.value("floor")}\nEstado: ${if (room.optBoolean("active")) "Activa" else "Inactiva"}\n" +
            "Camas libres: ${beds(room).count { it.optBoolean("available") }} de ${beds(room).size}", DFont.FOOTNOTE, DoctorTheme.ink, info)
        beds(room).forEach { b ->
            val card = ui.hospitalCard(box)
            val label = mapOf("disponible" to "Disponible", "ocupada" to "Ocupada", "limpieza" to "En limpieza", "mantenimiento" to "Mantenimiento")
                .getOrElse(b.value("state")) { b.value("state") }
            ui.text("Cama ${b.value("code")}", DFont.SUBHEAD_SEMI, DoctorTheme.ink, card)
            ui.badge(label, !b.optBoolean("available"), card)
            val occupant = b.optJSONObject("occupant")
            if (occupant != null) {
                ui.text("${occupant.value("patient_name")} · desde ${date(occupant.txt("since"))}", DFont.FOOTNOTE, DoctorTheme.ink, card)
                ui.linkButton("Ver paciente hospitalizado", R.drawable.ic_d_person, card) {
                    admission = hospitalized.firstOrNull { it.value("admission_id") == occupant.value("admission_id") }; notes = ""
                    if (admission != null) show("patient")
                }
            } else if (b.value("state") == "ocupada") {
                ui.text("Ocupada por un paciente de otro médico.", DFont.CAPTION, DoctorTheme.secondary, card)
            }
            if (b.optBoolean("available")) ui.primaryButton("Hospitalizar paciente aquí", R.drawable.ic_d_bed, card, height = 44) {
                bed = b; candidate = null; reason = ""; instructions = ""; urgent = false; query = ""; candidates = emptyList()
                show("hospitalize"); searchCandidates()
            }
        }
    }

    private fun renderPatient(box: LinearLayout) {
        val a = admission ?: return
        val card = ui.hospitalCard(box)
        ui.label(a.value("patient_name"), R.drawable.ic_d_person, DFont.SUBHEAD_BOLD, DoctorTheme.wine, card)
        val lines = mutableListOf(
            "Expediente: ${a.txt("record_number") ?: "—"}", "Estado: ${status(a.value("status"))}", "Prioridad: ${a.value("priority")}",
            "Habitación: ${a.txt("room") ?: "Sin asignar"} · Cama: ${a.txt("bed") ?: "—"} · ${a.txt("floor") ?: ""}",
            "Categoría: ${category(a.value("category"))}", "Ingreso: ${date(a.txt("assigned_at") ?: a.txt("ordered_at"))}",
            "Motivo: ${a.value("reason")}")
        a.txt("observations")?.let { lines += "Indicaciones: $it" }
        ui.text(lines.joinToString("\n"), DFont.FOOTNOTE, DoctorTheme.ink, card)
        when (a.value("status")) {
            "hospitalizado" -> {
                val d = ui.hospitalCard(box)
                ui.text("Dar de alta", DFont.SUBHEAD_BOLD, DoctorTheme.ink, d)
                ui.field(d, "Indicaciones de alta (obligatorio)", notes, multiline = true, minLines = 3) { notes = it }
                ui.primaryButton(if (saving) "Guardando…" else "Registrar alta médica", R.drawable.ic_d_check_circle, d, enabled = !saving) {
                    if (notes.trim().length < 5) { error = "Escribe las indicaciones de alta."; rerender(); return@primaryButton }
                    confirm("¿Dar de alta a ${a.value("patient_name")}?", "Recepción liberará la cama después del alta.", listOf("Dar de alta" to {
                        mutate("discharge", args("p_admission" to a.value("admission_id"), "p_notes" to notes),
                            "Alta médica registrada para ${a.value("patient_name")}.")
                    }), destructive = 0)
                }
            }
            "alta_medica" -> ui.text("Alta registrada el ${date(a.txt("discharged_at"))}. ${a.txt("discharge_notes") ?: ""}\nPendiente de liberar la cama en recepción.",
                DFont.FOOTNOTE, DoctorTheme.secondary, ui.hospitalCard(box))
        }
    }

    private fun searchCandidates() {
        val q = query
        work({ (repo.call("room_candidates", args("p_query" to q)) as JSONArray).objects() }) { candidates = it; rerender() }
    }

    private fun renderHospitalize(box: LinearLayout) {
        val b = bed ?: return
        ui.heading("Hospitalizar en cama ${b.value("code")}", box)
        val find = ui.hospitalCard(box)
        ui.text("Paciente (solo quienes ya pasaron consulta contigo)", DFont.SUBHEAD_SEMI, DoctorTheme.ink, find)
        ui.field(find, "Nombre, expediente o DUI", query) { query = it }
        ui.linkButton("Buscar", R.drawable.ic_d_arrow_right, find) { searchCandidates() }
        candidates.forEach { c ->
            val row = ui.hospitalCard(box)
            val blocked = c.txt("active_admission") != null
            val selected = candidate?.value("id") == c.value("id")
            ui.text((if (selected) "✓ " else "") + c.value("full_name"), DFont.SUBHEAD_SEMI, if (blocked) DoctorTheme.secondary else DoctorTheme.ink, row)
            ui.text(listOfNotNull(c.txt("record_number"), c.txt("last_consultation")?.let { "Última consulta ${date(it)}" }).joinToString(" · "),
                DFont.CAPTION, DoctorTheme.secondary, row)
            if (blocked) ui.text("Ya tiene hospitalización activa (${status(c.value("active_admission"))})", DFont.CAPTION, Color.RED, row)
            else ui.clickable(row) { candidate = c; rerender() }
        }
        if (candidates.isEmpty() && !busy) empty("Sin pacientes atendidos por ti con ese criterio.", box)
        val form = ui.hospitalCard(box)
        ui.field(form, "Motivo de hospitalización", reason, multiline = true, minLines = 2) { reason = it }
        ui.field(form, "Indicaciones (opcional)", instructions, multiline = true, minLines = 2) { instructions = it }
        ui.linkButton(if (urgent) "☑ Urgente" else "☐ Urgente", null, form) { urgent = !urgent; rerender() }
        val c = candidate
        ui.primaryButton(if (saving) "Guardando…" else "Hospitalizar", R.drawable.ic_d_bed, form, enabled = c != null && !saving) {
            if (c == null) return@primaryButton
            if (reason.trim().length < 5) { error = "Describe el motivo de hospitalización."; rerender(); return@primaryButton }
            mutate("hospitalize", args("p_patient" to c.value("id"), "p_bed" to b.value("id"), "p_reason" to reason,
                "p_instructions" to instructions, "p_priority" to (if (urgent) "urgente" else "normal"), "p_key" to hospitalizeKey),
                "${c.value("full_name")} quedó hospitalizado en la cama ${b.value("code")}.") { hospitalizeKey = java.util.UUID.randomUUID().toString() }
        }
    }

    private fun renderAssign(box: LinearLayout) {
        val a = admission ?: return
        ui.heading("Asignar cama a ${a.value("patient_name")}", box)
        ui.text("Categoría solicitada: ${category(a.value("category"))}. Solo se muestran camas libres.", DFont.FOOTNOTE, DoctorTheme.secondary, box)
        val free = rooms.filter { it.optBoolean("active") && it.value("kind") == a.value("category") }
            .flatMap { r -> beds(r).filter { it.optBoolean("available") }.map { r to it } }
        free.forEach { (r, b) ->
            val card = ui.hospitalCard(box)
            ui.text("${r.value("code")} · Cama ${b.value("code")} · ${r.value("floor")}", DFont.SUBHEAD_SEMI, DoctorTheme.ink, card)
            ui.clickable(card) {
                mutate("assign_bed", args("p_admission" to a.value("admission_id"), "p_bed" to b.value("id")),
                    "Cama ${b.value("code")} asignada a ${a.value("patient_name")}.")
            }
        }
        if (free.isEmpty()) empty("No hay camas libres de esta categoría.", box)
    }
}
