package sv.edu.catolica.hospital_universitario

import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import org.json.JSONObject
import sv.edu.catolica.hospital_universitario.databinding.ActivityDoctorNativeBinding
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Formatos de fecha en America/El_Salvador con locale es-SV (ConsultationFormat / DoctorDate de iOS). */
object DoctorFormat {
    val locale: Locale = Locale.forLanguageTag("es-SV")
    private fun pattern(value: String) = DateTimeFormatter.ofPattern(value, locale)
    private val complete = pattern("EEEE, d 'de' MMMM 'de' yyyy") /*raw*/
    private val time = pattern("h:mm a") /*raw*/
    private val medium = pattern("d MMM yyyy, h:mm a") /*raw*/
    private val dayMonth = pattern("EEEE, d 'de' MMMM") /*raw*/
    private val shortDay = pattern("EEE, d MMM yyyy") /*raw*/
    private val abbrDay = pattern("EEE d MMM") /*raw*/
    private val longDate = pattern("d 'de' MMMM 'de' yyyy") /*raw*/
    private val dayMonthOnly = pattern("d 'de' MMMM") /*raw*/
    fun cap(text: String) = text.replaceFirstChar { it.titlecase(locale) }
    fun date(value: ZonedDateTime?, missing: String) = value?.let { cap(complete.format(it)) } ?: missing
    fun time(value: ZonedDateTime?, missing: String) = value?.let { time.format(it) } ?: missing
    fun display(value: String?, missing: String) = DoctorRules.local(value)?.let { medium.format(it) } ?: missing
    fun dayMonth(value: LocalDate) = dayMonth.format(value)
    fun longWeekday(value: LocalDate) = complete.format(value)
    fun shortDay(value: LocalDate) = shortDay.format(value)
    fun abbrDay(value: ZonedDateTime) = abbrDay.format(value)
    fun longDate(value: LocalDate) = longDate.format(value)
    fun dayMonthOnly(value: LocalDate) = dayMonthOnly.format(value)
    fun hour12(value: ZonedDateTime?): String = value?.let { String.format(Locale.US, "%d:%02d", if (it.hour % 12 == 0) 12 else it.hour % 12, it.minute) } ?: "--:--"
    fun period(a: JSONObject, missing: String): String {
        val raw = a.value("period").drop(1).dropLast(1).split(",").map { it.trim().trim('"') }
        val start = DoctorRules.local(raw.getOrNull(0)); val end = DoctorRules.local(raw.getOrNull(1))
        return if (start == null || end == null) missing else medium.format(start) + " – " + medium.format(end)
    }
}

/** Base del módulo Doctor: shell idéntico al portal iOS. Una Activity por pantalla, sin WebView ni datos de ejemplo. */
abstract class DoctorNativeActivity : AppCompatActivity() {
    lateinit var binding: ActivityDoctorNativeBinding
    lateinit var ui: DoctorUi
    val viewModel: DoctorNativeViewModel by viewModels()
    val repo: DoctorNativeRepository get() = viewModel.repository
    val ctx get() = AppContainer.doctorNativeContext
    val busy: Boolean get() = viewModel.loading.value
    /** El shell se creó (sesión de médico válida). */
    val ready: Boolean get() = ::binding.isInitialized
    var retry: (() -> Unit)? = null
    var search = ""
    var error: String? = null
    private var generation = 0
    private val handler = Handler(Looper.getMainLooper())
    private val poll = object : Runnable { override fun run() { refreshAlertsSilently(); onPoll(); handler.postDelayed(this, 30_000) } }

    /** Identificador de la pantalla iOS (store.screenID). */
    abstract val screen: String
    abstract fun render()
    open fun onPoll() {}
    open val loadsWorkspace = true

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (SessionManager.currentRole != SessionManager.Role.DOCTOR) { Navigator.goToLogin(this, true); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityDoctorNativeBinding.inflate(layoutInflater)
        setContentView(binding.root)
        WindowCompat.getInsetsController(window, binding.root).isAppearanceLightStatusBars = false
        ui = DoctorUi(this)
        ctx.bind()
        val headerTop = binding.header.paddingTop
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            binding.header.setPadding(binding.header.paddingLeft, headerTop + bars.top, binding.header.paddingRight, binding.header.paddingBottom)
            binding.bottomBar.setPadding(binding.bottomBar.paddingLeft, binding.bottomBar.paddingTop, binding.bottomBar.paddingRight, ui.dp(4) + bars.bottom)
            binding.bottomBar.visibility = if (ime.bottom > 0) View.GONE else View.VISIBLE
            binding.root.setPadding(bars.left, 0, bars.right, if (ime.bottom > 0) ime.bottom else 0)
            insets
        }
        binding.content.dividerDrawable = android.graphics.drawable.GradientDrawable().apply { setSize(1, ui.dp(18)); setColor(Color.TRANSPARENT) }
        binding.content.showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
        setupHeader()
        setupTabs()
        binding.error.setOnClickListener { if (!busy) retry?.invoke() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (screen == "home") finish() else if (!busy) go("home") }
        })
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { viewModel.loading.collect { showLoading(it) } } }
        if (loadsWorkspace) refreshWorkspace { render() } else render()
    }
    override fun onResume() {
        super.onResume()
        if (::binding.isInitialized && SessionManager.currentRole != SessionManager.Role.DOCTOR) { finish(); return }
        handler.postDelayed(poll, 30_000)
    }
    override fun onPause() { super.onPause(); handler.removeCallbacks(poll) }

    // ---------- Encabezado ----------
    private data class Meta(val title: Int, val subtitle: Int, val search: Int)
    private fun meta(id: String): Meta = when (id) {
        "home" -> Meta(R.string.dx_t_home, R.string.dx_s_home, R.string.dx_q_home)
        "agenda" -> Meta(R.string.dx_t_agenda, R.string.dx_s_default, R.string.dx_q_patient)
        "consultation" -> Meta(R.string.dx_t_consultation, R.string.dx_s_consultation, R.string.dx_q_patient)
        "patients" -> Meta(R.string.dx_t_patients, R.string.dx_s_patients, R.string.dx_q_patient)
        "chart" -> Meta(R.string.dx_t_chart, R.string.dx_s_chart, R.string.dx_q_chart)
        "laboratory" -> Meta(R.string.dx_t_laboratory, R.string.dx_s_laboratory, R.string.dx_q_laboratory)
        "prescriptions" -> Meta(R.string.dx_t_prescriptions, R.string.dx_s_prescriptions, R.string.dx_q_prescriptions)
        "admissions" -> Meta(R.string.dx_t_admissions, R.string.dx_s_admissions, R.string.dx_q_admissions)
        "ambulance" -> Meta(R.string.dx_t_ambulance, R.string.dx_s_ambulance, R.string.dx_q_ambulance)
        "turns" -> Meta(R.string.dx_t_turns, R.string.dx_s_turns, R.string.dx_q_turns)
        "notifications" -> Meta(R.string.dx_t_notifications, R.string.dx_s_notifications, R.string.dx_q_notifications)
        "profile" -> Meta(R.string.dx_t_profile, R.string.dx_s_profile, R.string.dx_q_profile)
        "rooms" -> Meta(R.string.dx_t_rooms, R.string.dx_s_default, R.string.dx_q_home)
        else -> Meta(R.string.dx_t_more, R.string.dx_s_default, R.string.dx_q_home)
    }
    private fun setupHeader() {
        val m = meta(screen)
        binding.title.setText(m.title); binding.subtitle.setText(m.subtitle)
        val compact = screen in setOf("home", "profile")
        binding.header.setPadding(binding.header.paddingLeft, binding.header.paddingTop, binding.header.paddingRight, ui.dp(if (compact) 24 else 48))
        val showSearch = screen !in setOf("home", "patients", "laboratory", "admissions", "ambulance", "profile")
        binding.searchBar.visibility = if (showSearch) View.VISIBLE else View.GONE
        binding.searchBar.background = ui.rounded(Color.WHITE, 13)
        binding.search.setHint(m.search)
        binding.search.doAfterTextChanged { search = it?.toString().orEmpty(); onSearchChanged() }
        binding.bellCount.background = ui.capsule(DoctorTheme.alpha(Color.WHITE, 0.2f))
        binding.bell.setOnClickListener { showNotifications() }
        updateBell()
    }
    open fun onSearchChanged() { rerender() }
    fun updateBell() {
        val unread = ctx.unread
        binding.bellIcon.setImageResource(if (unread > 0) R.drawable.ic_d_bell_fill else R.drawable.ic_d_bell)
        binding.bellCount.visibility = if (unread > 0) View.VISIBLE else View.GONE
        binding.bellCount.text = unread.toString()
        binding.bell.contentDescription = getString(R.string.dx_unread_a11y, unread)
    }

    // ---------- Barra inferior ----------
    private fun setupTabs() {
        val tabs = listOf(Triple(binding.navHome, "home", binding.navHomeIcon to binding.navHomeText),
            Triple(binding.navPatients, "patients", binding.navPatientsIcon to binding.navPatientsText),
            Triple(binding.navConsult, "consultation", binding.navConsultIcon to binding.navConsultText),
            Triple(binding.navLabs, "laboratory", binding.navLabsIcon to binding.navLabsText),
            Triple(binding.navMore, "more", binding.navMoreIcon to binding.navMoreText))
        val active = when (screen) {
            "home" -> "home"; "patients" -> "patients"; "consultation", "agenda" -> "consultation"; "laboratory" -> "laboratory"; else -> "more"
        }
        tabs.forEach { (view, id, parts) ->
            val on = id == active
            val color = if (on) DoctorTheme.wine else DoctorTheme.secondary
            parts.first.imageTintList = ColorStateList.valueOf(color); parts.second.setTextColor(color)
            view.background = if (on) ui.rounded(DoctorTheme.rose, 12) else null
            view.isSelected = on
            view.setOnClickListener { if (!busy && (id != screen || id == "more")) go(id) }
        }
    }
    /** go(id) de ContentView: notificaciones abre el panel de avisos; el resto reemplaza la pantalla. */
    fun go(id: String) {
        if (id == "notifications") { showNotifications(); return }
        if (busy) return
        if (id == "consultation" && screen != id && ctx.selectedAppointmentId == null) ctx.day = DoctorRules.today()
        val target = when (id) {
            "home" -> DoctorNativeHomeActivity::class.java; "agenda" -> DoctorNativeAgendaActivity::class.java
            "consultation" -> DoctorNativeConsultActivity::class.java; "patients" -> DoctorNativePatientsActivity::class.java
            "chart" -> DoctorNativeChartActivity::class.java; "laboratory" -> DoctorNativeLabsActivity::class.java
            "prescriptions" -> DoctorNativePrescriptionsActivity::class.java; "admissions" -> DoctorNativeAdmissionsActivity::class.java
            "ambulance" -> DoctorNativeAmbulanceActivity::class.java; "turns" -> DoctorNativeScheduleActivity::class.java
            "profile" -> DoctorNativeProfileActivity::class.java; "rooms" -> DoctorNativeRoomsActivity::class.java
            else -> DoctorNativeMoreActivity::class.java
        }
        startActivity(android.content.Intent(this, target).addFlags(android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION))
        overridePendingTransition(0, 0)
        finish()
    }

    // ---------- Contenido ----------
    val content: LinearLayout get() = binding.content
    fun clear(resetScroll: Boolean = true) {
        generation++
        binding.content.removeAllViews()
        if (resetScroll) binding.scroll.scrollTo(0, 0)
    }
    /** Vuelve a dibujar sin perder la posición de desplazamiento (cambios de estado en la misma pantalla). */
    fun rerender() {
        val y = binding.scroll.scrollY
        render()
        binding.scroll.post { binding.scroll.scrollTo(0, y) }
    }
    /** Cabecera común de DoctorModuleView: progreso, error con Reintentar, confirmación y aviso sin leer. */
    fun moduleTop(target: LinearLayout = content) {
        error?.let { message ->
            ui.text(message, DFont.FOOTNOTE, Color.rgb(255, 59, 48), target).contentDescription = getString(R.string.dx_error_a11y, message)
            ui.linkButton(getString(R.string.dx_retry), R.drawable.ic_d_refresh, target) { error = null; refreshWorkspace { render() } }
        }
        ctx.confirmation?.let { ui.text(it, DFont.FOOTNOTE, DoctorTheme.wine, target) }
        if (screen !in setOf("home", "notifications")) ctx.alerts.firstOrNull { it.txt("read_at") == null }?.let { notice ->
            val card = ui.hospitalCard(target)
            ui.label(notice.value("title"), R.drawable.ic_d_bell_fill, DFont.SUBHEAD_BOLD, DoctorTheme.wine, card)
            ui.linkButton(getString(R.string.dx_view_alerts), null, card) { showNotifications() }
        }
    }
    fun empty(text: String, target: LinearLayout = content) = ui.hospitalCard(target).also { ui.text(text, DFont.FOOTNOTE, DoctorTheme.secondary, it) }

    // ---------- Operaciones ----------
    /** Ejecuta en el ViewModel (corrutinas) y pinta el resultado si la vista sigue vigente. */
    fun <T> work(operation: () -> T, failure: ((Throwable) -> Unit)? = null, success: (T) -> Unit) {
        val version = generation
        val started = viewModel.execute(operation) { result ->
            if (isDestroyed || isFinishing) return@execute
            if (version != generation && failure == null) { result.onSuccess(success); return@execute }
            result.fold(success) { if (failure != null) failure(it) else { error = describe(it); rerender() } }
        }
        if (!started) handler.postDelayed({ if (!isDestroyed) work(operation, failure, success) }, 250)
    }
    fun refreshWorkspace(done: () -> Unit) {
        work({ repo.workspace(ctx.day) to runCatching { repo.call("alerts", args("p_offset" to 0)) as JSONObject }.getOrNull() }, { e ->
            ctx.workspace = null; error = describe(e); done()
        }) { (w, alerts) ->
            ctx.workspace = w; error = null
            alerts?.let { applyAlerts(it, false) }
            val selected = ctx.selectedAppointmentId
            if (selected != null && ctx.appointments.none { it.value("id") == selected }) { val p = ctx.selectedPatient; ctx.select(null); ctx.selectedPatient = p }
            done()
        }
    }
    fun describe(e: Throwable): String = when (e) {
        is AuthException -> getString(e.messageRes)
        is DoctorFailure -> when {
            e.resource == R.string.doc_contract_missing -> getString(e.resource, e.detail)
            (e.resource == R.string.doc_validation || e.resource == R.string.doc_version_conflict) && e.detail.isNotBlank() -> e.detail
            else -> getString(e.resource)
        }
        else -> getString(R.string.desk_response)
    }
    private var shownLoading = false
    private fun showLoading(loading: Boolean) {
        if (loading == shownLoading) return
        shownLoading = loading
        binding.loading.visibility = if (loading) View.VISIBLE else View.GONE
        listOf(binding.navHome, binding.navPatients, binding.navConsult, binding.navLabs, binding.navMore).forEach { it.isEnabled = !loading }
    }
    fun applyAlerts(page: JSONObject, more: Boolean) {
        ctx.alerts = if (more) ctx.alerts + page.list("items") else page.list("items")
        ctx.unread = page.optInt("unread"); ctx.alertsMore = page.optBoolean("has_more"); ctx.alertsError = null
        if (!more) { ctx.upcoming = page.list("upcoming"); DoctorReminders.scheduleAppointments(this, ctx.upcoming) }
        updateBell()
    }
    private fun refreshAlertsSilently() {
        if (busy) return
        viewModel.execute({ repo.call("alerts", args("p_offset" to 0)) as JSONObject }) { r -> if (!isDestroyed) r.onSuccess { applyAlerts(it, false); notificationsPanel?.invoke() } }
    }

    // ---------- Diálogos ----------
    /** `.alert` / `.confirmationDialog` de iOS. La acción destructiva se pinta en rojo. */
    fun confirm(title: String, message: String?, actions: List<Pair<String, () -> Unit>>, cancel: String = getString(R.string.desk_cancel), destructive: Int = -1) {
        val builder = MaterialAlertDialogBuilder(this).setTitle(title)
        if (message != null) builder.setMessage(message)
        val dialog = builder.create()
        val box = ui.vbox(0).apply { setPadding(0, ui.dp(4), 0, ui.dp(8)) }
        actions.forEachIndexed { i, (label, run) ->
            ui.divider(box)
            ui.text(label, DFont.BODY, if (i == destructive) Color.rgb(255, 59, 48) else DoctorTheme.wine, box, center = true).apply {
                setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14)); ui.clickable(this) { dialog.dismiss(); if (!busy) run() }
            }
        }
        ui.divider(box)
        ui.text(cancel, DFont.HEADLINE, DoctorTheme.wine, box, center = true).apply {
            setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14)); ui.clickable(this) { dialog.dismiss() }
        }
        dialog.setView(box)
        dialog.show()
    }
    /** Hoja modal a pantalla completa con barra de navegación (NavigationStack dentro de `.sheet`). */
    fun sheet(title: String, leading: String?, trailing: String?, onTrailing: (() -> Unit)? = null, build: (LinearLayout, Dialog) -> Unit): Dialog {
        val dialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar)
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val root = ui.vbox(0).apply { setBackgroundColor(DoctorTheme.background); layoutParams = ViewGroup.LayoutParams(-1, -1) }
        val bar = FrameLayout(this).apply { setBackgroundColor(DoctorTheme.background); setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14)) }
        root.addView(bar, LinearLayout.LayoutParams(-1, -2))
        bar.addView(TextView(this).apply {
            text = title; textSize = 17f; typeface = ui.face(1); setTextColor(DoctorTheme.ink); gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        if (leading != null) bar.addView(ui.linkButton(leading, null, null) { dialog.dismiss() }, FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.CENTER_VERTICAL))
        if (trailing != null) bar.addView(ui.linkButton(trailing, null, null, DFont.HEADLINE) { onTrailing?.invoke() ?: dialog.dismiss() },
            FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.CENTER_VERTICAL))
        ui.divider(root)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val body = ui.vbox(16).apply { setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(30)) }
        scroll.addView(body)
        dialog.setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        build(body, dialog)
        dialog.show()
        return dialog
    }

    // ---------- Notificaciones (popover de la campana) ----------
    private var notificationsPanel: (() -> Unit)? = null
    fun showNotifications() {
        val dialog = Dialog(this)
        dialog.window?.setBackgroundDrawable(ui.rounded(Color.WHITE, 14))
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val root = ui.vbox(14).apply { setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(18)) }
        var reading: String? = null
        fun paint() {
            root.removeAllViews()
            val head = ui.hbox(8, root)
            val titles = ui.vbox(4, head).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            ui.text(getString(R.string.dx_t_notifications), DFont.TITLE3, DoctorTheme.ink, titles)
            ui.text(getString(R.string.dx_unread, ctx.unread), DFont.CAPTION, DoctorTheme.secondary, titles)
            ui.icon(R.drawable.ic_d_clear, DoctorTheme.wine, 26, head).apply {
                contentDescription = getString(R.string.dx_close_alerts); isClickable = true; setOnClickListener { dialog.dismiss() }
            }
            ui.divider(root)
            ctx.alertsError?.let { ui.text(it, DFont.FOOTNOTE, Color.rgb(255, 59, 48), root) }
            val scroll = ScrollView(this)
            root.addView(scroll, LinearLayout.LayoutParams(-1, ui.dp(300)))
            val list = ui.vbox(12).also { scroll.addView(it) }
            if (ctx.alerts.isEmpty()) ui.label(getString(R.string.dx_alerts_clear), R.drawable.ic_d_check_circle, DFont.SUBHEAD, DoctorTheme.ink, list).setPadding(0, ui.dp(24), 0, ui.dp(24))
            ctx.alerts.forEach { item ->
                val unread = item.txt("read_at") == null
                val card = ui.vbox(8, list).apply { background = ui.rounded(if (unread) DoctorTheme.rose else DoctorTheme.background, 14); setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
                ui.label(item.value("title"), if (unread) R.drawable.ic_d_dot else R.drawable.ic_d_check_circle, DFont.SUBHEAD_BOLD, DoctorTheme.wine, card)
                ui.text(item.value("body"), DFont.FOOTNOTE, DoctorTheme.ink, card)
                ui.text(DoctorFormat.display(item.value("created_at"), getString(R.string.dx_unavailable)), DFont.CAPTION2, DoctorTheme.secondary, card)
                if (unread) ui.linkButton(getString(if (reading == item.value("id")) R.string.dx_saving_short else R.string.dx_mark_read), null, card, DFont.CAPTION_BOLD, enabled = reading == null) {
                    reading = item.value("id"); paint()
                    markRead(item) { reading = null; paint() }
                } else ui.text(getString(R.string.dx_read), DFont.CAPTION, DoctorTheme.secondary, card)
            }
            if (ctx.alertsMore) ui.linkButton(getString(R.string.dx_more_alerts), null, list) {
                work({ repo.call("alerts", args("p_offset" to ctx.alerts.size)) as JSONObject }, { ctx.alertsError = getString(R.string.dx_alerts_failed); paint() }) { applyAlerts(it, true); paint() }
            }
            val actions = ui.hbox(8, root)
            ui.linkButton(getString(R.string.dx_refresh_alerts), R.drawable.ic_d_refresh, actions, DFont.CAPTION_BOLD) { reloadAlerts { paint() } }
            ui.spacerView(actions)
            ui.linkButton(getString(R.string.dx_reminders), null, actions, DFont.CAPTION_BOLD) { enableReminders { paint() } }
            ctx.notificationMessage?.let { ui.text(it, DFont.CAPTION, DoctorTheme.secondary, root) }
        }
        notificationsPanel = { if (dialog.isShowing) paint() }
        paint()
        dialog.setContentView(root)
        dialog.setOnDismissListener { notificationsPanel = null }
        dialog.show()
        dialog.window?.setLayout(ui.dp(330), ViewGroup.LayoutParams.WRAP_CONTENT)
        reloadAlerts { paint() }
    }
    fun reloadAlerts(done: () -> Unit) {
        work({ repo.call("alerts", args("p_offset" to 0)) as JSONObject }, { ctx.alertsError = getString(R.string.dx_alerts_failed); done() }) { applyAlerts(it, false); done() }
    }
    fun markRead(item: JSONObject, done: () -> Unit) {
        val user = SessionManager.userId ?: return
        work({
            repo.rest("notifications?id=eq.${enc(item.value("id"))}&recipient_id=eq.${enc(user)}", "PATCH", JSONObject().put("read_at", java.time.Instant.now().toString()))
            repo.call("alerts", args("p_offset" to 0)) as JSONObject
        }, { ctx.alertsError = getString(R.string.dx_mark_failed); done() }) { applyAlerts(it, false); done() }
    }
    fun enableReminders(done: () -> Unit) {
        val allowed = DoctorReminders.requestPermission(this)
        ctx.notificationMessage = getString(if (allowed) R.string.dx_reminders_on else R.string.dx_reminders_settings)
        if (allowed) DoctorReminders.scheduleAppointments(this, ctx.upcoming)
        reloadAlerts(done)
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == DoctorReminders.REQUEST && grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            ctx.notificationMessage = getString(R.string.dx_reminders_on); DoctorReminders.scheduleAppointments(this, ctx.upcoming); notificationsPanel?.invoke()
        }
    }
    fun s(id: Int, vararg values: Any): String = getString(id, *values)
}
