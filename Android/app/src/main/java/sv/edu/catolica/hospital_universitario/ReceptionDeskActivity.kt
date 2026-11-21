package sv.edu.catolica.hospital_universitario

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import sv.edu.catolica.hospital_universitario.databinding.ActivityReceptionDeskBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionCardBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionFieldBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionTileBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionMetricBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionRecordBinding
import sv.edu.catolica.hospital_universitario.databinding.ItemReceptionAppointmentBinding
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** Base visual nativa; una Activity por sección, sin WebView ni datos de demostración. */
abstract class ReceptionDeskActivity : AppCompatActivity() {
    lateinit var binding: ActivityReceptionDeskBinding
    val viewModel: ReceptionDeskViewModel by viewModels()
    val repo: ReceptionDeskRepository get() = viewModel.repository
    private var generation = 0
    val busy: Boolean get() = viewModel.loading.value
    var retry: (() -> Unit)? = null
    abstract val titleRes: Int
    abstract fun render()

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (SessionManager.currentRole != SessionManager.Role.RECEPTION) {
            Navigator.goToLogin(this, true)
            return
        }
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        binding = ActivityReceptionDeskBinding.inflate(layoutInflater)
        setContentView(binding.root)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        binding.title.setText(titleRes)
        binding.subtitle.setText(R.string.desk_subtitle)
        binding.navHome.setOnClickListener { if (!busy) Navigator.goToReceptionHome(this, true) }
        binding.navRequests.setOnClickListener { if (!busy) Navigator.goToReceptionRequests(this, true) }
        binding.navAgenda.setOnClickListener { if (!busy) Navigator.goToAppointments(this, true) }
        binding.navWalkin.setOnClickListener { if (!busy) Navigator.goToReceptionWalkin(this, true) }
        binding.navMore.setOnClickListener {
            if(!busy) MaterialAlertDialogBuilder(this).setItems(arrayOf(
                getString(R.string.desk_patients),getString(R.string.desk_hospital),getString(R.string.desk_ambulance),getString(R.string.dialog_logout_title))) {_,i->
                when(i) {
                    0->Navigator.goToPatients(this,true)
                    1->Navigator.goToAdmissions(this,true)
                    2->Navigator.goToReceptionAmbulance(this,true)
                    else->Navigator.logout(this)
                }
            }.show()
        }
        val active=when(this) {
            is ReceptionHubActivity->binding.navHome
            is ReceptionRequestsActivity->binding.navRequests
            is ReceptionAgendaActivity->binding.navAgenda
            is ReceptionWalkinActivity->binding.navWalkin
            else->binding.navMore
        }
        active.setBackgroundResource(R.drawable.bg_nav_selected)
        binding.error.setOnClickListener { if (!busy) retry?.invoke() }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { viewModel.loading.collect { showLoading(it) } }
        }
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::binding.isInitialized && SessionManager.currentRole != SessionManager.Role.RECEPTION) {
            finish()
        }
    }
    fun clear() {
        generation++
        binding.content.removeAllViews()
        binding.error.visibility = View.GONE
        binding.scroll.scrollTo(0, 0)
    }
    fun card(title: String, detail: String = "", target: LinearLayout = binding.content): LinearLayout {
        val c = ItemReceptionCardBinding.inflate(layoutInflater, target, false)
        c.heading.text = title
        c.detail.text = detail
        c.detail.visibility = if (detail.isBlank()) View.GONE else View.VISIBLE
        target.addView(c.root)
        return c.body
    }
    fun note(text: String, target: LinearLayout = binding.content) {
        target.addView(TextView(this).apply {
            this.text = text
            setTextColor(getColor(R.color.text_secondary))
            textSize = 14f
            setPadding(0, dp(8), 0, dp(12))
        })
    }
    fun action(label: Int, target: LinearLayout = binding.content, run: () -> Unit): Button {
        val button=action(getString(label),target,run)
        if(label in setOf(R.string.desk_create,R.string.desk_schedule,R.string.desk_availability,
            R.string.desk_review_action,R.string.desk_link,R.string.desk_create_link,R.string.desk_assessment_send,
            R.string.desk_assign_confirm,R.string.desk_exit,R.string.desk_start_walkin)) {
            button.backgroundTintList=android.content.res.ColorStateList.valueOf(getColor(R.color.wine_primary))
            button.setTextColor(getColor(R.color.white))
        }
        return button
    }
    fun action(label: String, target: LinearLayout = binding.content, run: () -> Unit): Button {
        val button = com.google.android.material.button.MaterialButton(this).apply {
            text=label;textSize=14f;isAllCaps=false;minHeight=dp(48);minimumHeight=dp(48)
            cornerRadius=dp(12);insetTop=0;insetBottom=0;strokeWidth=dp(1)
            strokeColor=android.content.res.ColorStateList.valueOf(getColor(R.color.pink_caption))
            setTextColor(getColor(R.color.wine_primary))
            backgroundTintList=android.content.res.ColorStateList.valueOf(getColor(R.color.white))
            setPadding(dp(14),dp(12),dp(14),dp(12))
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(10)}
            setOnClickListener {if(!busy) run()}
        }
        target.addView(button)
        return button
    }
    fun field(label: Int, target: LinearLayout = binding.content, value: String = "", max: Int = 2000): EditText {
        val f = ItemReceptionFieldBinding.inflate(layoutInflater, target, false)
        f.label.setText(label)
        f.input.contentDescription=getString(label)
        f.input.setText(value)
        if(label==R.string.desk_search) {f.label.visibility=View.GONE;f.input.hint=getString(label)}
        f.input.filters = arrayOf(android.text.InputFilter.LengthFilter(max))
        if(max>254) {
            f.input.inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            f.input.minLines=3;f.input.gravity=android.view.Gravity.TOP
        } else f.input.setSingleLine(true)
        f.input.setSaveEnabled(false)
        target.addView(f.root)
        return f.input
    }
    fun check(label: Int = R.string.desk_identity, target: LinearLayout = binding.content): CheckBox {
        val c = CheckBox(this).apply { setText(label); minHeight = dp(48);textSize=13f;setTextColor(getColor(R.color.text_secondary));buttonTintList=android.content.res.ColorStateList.valueOf(getColor(R.color.wine_primary)) }
        target.addView(c)
        return c
    }
    fun picker(label: Int, options: List<Pair<String, String>>, selected: String,
               target: LinearLayout = binding.content, changed: (String) -> Unit): Button {
        val button=action(getString(label) + getString(R.string.desk_separator) +
            (options.firstOrNull { it.first == selected }?.second ?: getString(R.string.desk_all)),target) {}
        (button as? com.google.android.material.button.MaterialButton)?.apply {
            icon=androidx.appcompat.content.res.AppCompatResources.getDrawable(this@ReceptionDeskActivity,android.R.drawable.arrow_down_float)
            iconGravity=com.google.android.material.button.MaterialButton.ICON_GRAVITY_END
            iconTint=android.content.res.ColorStateList.valueOf(getColor(R.color.wine_primary))
        }
        button.setOnClickListener {
            if(!busy) MaterialAlertDialogBuilder(this).setTitle(label)
                .setItems(options.map { it.second }.toTypedArray()) { _, i ->
                    button.text=getString(label)+getString(R.string.desk_separator)+options[i].second
                    changed(options[i].first)
                }.setNegativeButton(R.string.desk_cancel, null).show()
        }
        return button
    }
    fun date(day: LocalDate, target: LinearLayout = binding.content, minToday: Boolean = false, changed: (LocalDate) -> Unit) {
        action(getString(R.string.desk_date) + getString(R.string.desk_separator) + day, target) {
            DatePickerDialog(this, { _, y, m, d -> changed(LocalDate.of(y,m+1,d)) },
                day.year,day.monthValue-1,day.dayOfMonth).apply {
                if (minToday) datePicker.minDate = ReceptionClock.today().atStartOfDay(ReceptionClock.zone).toInstant().toEpochMilli()
            }.show()
        }
    }
    fun confirm(text: String = getString(R.string.desk_confirm_action), run: () -> Unit) {
        MaterialAlertDialogBuilder(this).setMessage(text)
            .setPositiveButton(R.string.desk_confirm) { _, _ -> if (!busy) run() }
            .setNegativeButton(R.string.desk_cancel, null).show()
    }
    fun reason(label: Int, submit: (String) -> Unit) {
        val form = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(20),dp(12),dp(20),0) }
        val text = field(R.string.desk_reason, form)
        val dialog = MaterialAlertDialogBuilder(this).setTitle(label).setView(form)
            .setPositiveButton(R.string.desk_confirm, null).setNegativeButton(R.string.desk_cancel,null).create()
        dialog.setOnShowListener {
            dialog.getButton(-1).setOnClickListener {
                if (text.text.toString().isBlank()) text.error=getString(R.string.desk_invalid)
                else { val value=text.text.toString().trim(); dialog.dismiss(); confirm { submit(value) } }
            }
        }
        dialog.show()
    }
    /** Lanza una operación en el ViewModel (corrutinas) y pinta el resultado si la vista sigue vigente. */
    fun <T> work(operation: () -> T, success: (T) -> Unit) {
        val version = generation
        binding.error.visibility=View.GONE
        viewModel.execute(operation) { result ->
            if (isDestroyed || isFinishing) return@execute
            showLoading(false)
            if (version != generation) return@execute
            result.fold(success) { showError(it) }
        }
    }
    private var shownLoading = false
    /** Idempotente: solo actúa en cambios reales, así no reactiva controles que la vista deshabilitó a propósito. */
    private fun showLoading(loading: Boolean) {
        if (loading == shownLoading) return
        shownLoading = loading
        binding.loading.visibility=if (loading) View.VISIBLE else View.GONE
        enable(binding.content,!loading)
        binding.navHome.isEnabled=!loading; binding.navRequests.isEnabled=!loading
        binding.navAgenda.isEnabled=!loading; binding.navWalkin.isEnabled=!loading;binding.navMore.isEnabled=!loading
    }
    fun showError(error: Throwable) {
        binding.error.text=when(error) {
            is AuthException -> getString(error.messageRes)
            is DeskException -> when {
                error.resource == R.string.desk_contract_missing -> getString(error.resource,error.detail)
                error.resource == R.string.desk_server_validation && error.detail.isNotBlank() -> error.detail
                else -> getString(error.resource)
            }
            else -> getString(R.string.desk_response)
        } + getString(R.string.desk_retry_hint)
        binding.error.visibility=View.VISIBLE
    }
    fun status(code: String): String = getString(when(code) {
        "pendiente" -> R.string.desk_pending; "en_revision" -> R.string.desk_review
        "agendada" -> R.string.desk_scheduled; "rechazada","rejected" -> R.string.desk_rejected
        "cancelada" -> R.string.desk_cancelled; "programada" -> R.string.desk_programmed
        "confirmada" -> R.string.desk_confirmed; "en_atencion" -> R.string.desk_in_care
        "completada" -> R.string.desk_completed; "no_asistio" -> R.string.desk_no_show
        "solicitado" -> R.string.desk_requested; "asignado" -> R.string.desk_assigned
        "hospitalizado" -> R.string.desk_hospitalized; "alta_medica" -> R.string.desk_discharge
        "cerrado" -> R.string.desk_closed; "cancelado" -> R.string.desk_admission_cancelled
        "disponible" -> R.string.desk_available; "ocupada" -> R.string.desk_occupied
        "limpieza" -> R.string.desk_cleaning; "mantenimiento" -> R.string.desk_maintenance
        "fuera_servicio" -> R.string.desk_out; "vip" -> R.string.desk_vip; "semiprivada" -> R.string.desk_semi
        "manana" -> R.string.desk_period_morning; "tarde" -> R.string.desk_period_afternoon; "indiferente" -> R.string.desk_period_any
        "normal" -> R.string.desk_normal; "urgente" -> R.string.desk_urgent
        "pending" -> R.string.desk_assessment_pending; "approved" -> R.string.desk_assessment_approved
        "expired" -> R.string.desk_assessment_expired; else -> R.string.desk_unknown
    })
    fun time(value: String): String = runCatching {
        OffsetDateTime.parse(value).atZoneSameInstant(ReceptionClock.zone)
            .format(DateTimeFormatter.ofPattern("dd/MM/yyyy hh:mm a", java.util.Locale.US))
            .lowercase(java.util.Locale.US)
    }.getOrDefault(value)
    fun required(input: EditText): String {
        val value=input.text.toString().trim()
        if(value.isBlank()) { input.error=getString(R.string.desk_invalid); throw DeskException(R.string.desk_invalid) }
        return value
    }
    private fun enable(view: View, enabled: Boolean) {
        view.isEnabled=enabled
        if(view is ViewGroup) for(i in 0 until view.childCount) enable(view.getChildAt(i),enabled)
    }
    fun filterRow(target:LinearLayout=binding.content):LinearLayout {
        val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL;isBaselineAligned=false}
        target.addView(row)
        return row
    }
    fun compact(button:Button) {
        button.layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {setMargins(dp(3),0,dp(3),dp(8))}
        button.textSize=12f;button.maxLines=2
    }
    fun chipStrip(options:List<Pair<String,String>>,selected:String,target:LinearLayout=binding.content,change:(String)->Unit) {
        val scroll=HorizontalScrollView(this).apply {isHorizontalScrollBarEnabled=false}
        val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
        scroll.addView(row)
        target.addView(scroll)
        options.forEach { (id,label) ->
            row.addView(TextView(this).apply {
                text=label;textSize=12f;gravity=android.view.Gravity.CENTER
                minHeight=dp(40);setPadding(dp(12),dp(8),dp(12),dp(8))
                setTextColor(getColor(if(id==selected) R.color.wine_primary else R.color.text_secondary))
                setBackgroundResource(if(id==selected) R.drawable.bg_pill_pink else R.drawable.bg_dashboard_card)
                layoutParams=LinearLayout.LayoutParams(-2,-2).apply {setMargins(0,0,dp(7),dp(10))}
                isClickable=true;isFocusable=true
                setOnClickListener {if(!busy) change(id)}
            })
        }
    }
    fun recordCard(name:String,badge:String,detail:String,date:String,target:LinearLayout=binding.content,accentRes:Int=0,open:()->Unit): ItemReceptionRecordBinding {
        val row=ItemReceptionRecordBinding.inflate(layoutInflater,target,false)
        row.name.text=name;row.badge.text=badge;row.detail.text=detail;row.date.text=date
        row.root.setOnClickListener {if(!busy) open()}
        // Barra de acento izquierda por estado; sin acento conserva la tarjeta original.
        if(accentRes!=0) row.root.setBackgroundResource(accentRes)
        target.addView(row.root)
        return row
    }
    fun appointmentCard(a:org.json.JSONObject,target:LinearLayout) {
        fun hour(v:String)=runCatching {
            OffsetDateTime.parse(v).atZoneSameInstant(ReceptionClock.zone)
                .format(DateTimeFormatter.ofPattern("hh:mm a", java.util.Locale.US))
                .lowercase(java.util.Locale.US)
        }.getOrDefault(v)
        val row=ItemReceptionAppointmentBinding.inflate(layoutInflater,target,false)
        row.start.text=hour(a.value("starts_at"));row.end.text=hour(a.value("ends_at"))
        row.patient.text=a.value("patient_name");row.doctor.text=a.value("doctor_name")
        // Turno hospitalario (appointments.queue_number, asignado por el servidor); se muestra junto al consultorio.
        row.room.text=a.value("queue_number").takeIf { it.isNotBlank() }?.let { getString(R.string.desk_room_queue,a.value("room_code"),it) }
            ?: getString(R.string.desk_consulting_room,a.value("room_code"))
        // Estado con punto y tinte por estado, como la agenda del ADMIN.
        tintBadge(row.badge, a.value("status"))
        target.addView(row.root)
    }
    fun tileGrid(items: List<Triple<Int,Int,Pair<Int,()->Unit>>>) {
        items.chunked(2).forEach { pair ->
            val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
            binding.content.addView(row)
            pair.forEach { (title,icon,detail) ->
                val tile=ItemReceptionTileBinding.inflate(layoutInflater,row,false)
                tile.icon.setImageResource(icon);tile.title.setText(title);tile.caption.setText(detail.first)
                tile.root.layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {setMargins(dp(4),0,dp(4),dp(12))}
                tile.root.setOnClickListener {if(!busy) detail.second()}
                row.addView(tile.root)
            }
            if(pair.size==1) row.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        }
    }
    fun metricGrid(states: List<String>): Map<String,TextView> {
        val fields=linkedMapOf<String,TextView>()
        states.chunked(2).forEach { pair ->
            val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
            binding.content.addView(row)
            pair.forEach { state ->
                val metric=ItemReceptionMetricBinding.inflate(layoutInflater,row,false)
                metric.label.text=status(state)
                metric.root.layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {setMargins(dp(4),0,dp(4),dp(12))}
                fields[state]=metric.amount
                row.addView(metric.root)
            }
            if(pair.size==1) row.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        }
        return fields
    }
    fun section(label:Int, target:LinearLayout=binding.content) {
        target.addView(TextView(this).apply {
            setText(label);textSize=17f;setTypeface(typeface,android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.text_primary));setPadding(dp(4),dp(14),0,dp(14))
        })
    }
    /** Cabecera con icono, antetítulo y título, como los encabezados del ADMIN. */
    fun header(icon:Int, eyebrow:String, title:String, caption:String?=null): LinearLayout {
        val row=LinearLayout(this).apply {
            orientation=LinearLayout.HORIZONTAL;gravity=android.view.Gravity.CENTER_VERTICAL
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(14)}
        }
        row.addView(ImageView(this).apply {
            setImageResource(icon);setColorFilter(getColor(R.color.wine_primary))
            setBackgroundResource(R.drawable.bg_pill_pink)
            layoutParams=LinearLayout.LayoutParams(dp(48),dp(48)).apply {rightMargin=dp(12)}
            setPadding(dp(13),dp(13),dp(13),dp(13))
            importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        val column=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            layoutParams=LinearLayout.LayoutParams(0,-2,1f)
        }
        column.addView(TextView(this).apply {
            text=eyebrow;textSize=10f;letterSpacing=0.12f
            setTypeface(typeface,android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.text_secondary))
        })
        column.addView(TextView(this).apply {
            text=title;textSize=19f
            setTypeface(typeface,android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.wine_primary))
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(3)}
        })
        if(caption!=null) column.addView(TextView(this).apply {
            text=caption;textSize=12f
            setTextColor(getColor(R.color.text_secondary))
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(5)}
        })
        row.addView(column)
        binding.content.addView(row)
        return row
    }
    /** Rejilla etiqueta/valor de dos columnas, como los datos de detalle del ADMIN. */
    fun dataGrid(fields: List<Pair<String,String>>, target: LinearLayout): LinearLayout {
        val grid=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        fields.filter{it.second.isNotBlank()}.chunked(2).forEach { pair ->
            val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
            pair.forEach { (label,value) ->
                val cell=LinearLayout(this).apply {
                    orientation=LinearLayout.VERTICAL
                    layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {rightMargin=dp(16);bottomMargin=dp(12)}
                }
                cell.addView(TextView(this).apply {
                    text=label;textSize=11f
                    setTextColor(getColor(R.color.text_secondary))
                })
                cell.addView(TextView(this).apply {
                    text=value;textSize=13f
                    setTextColor(getColor(R.color.text_primary))
                    layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(3)}
                })
                row.addView(cell)
            }
            grid.addView(row)
        }
        target.addView(grid)
        return grid
    }
    /** Estado vacío con icono, como los huecos punteados del ADMIN. */
    fun emptyState(message:String, icon:Int, target:LinearLayout=binding.content) {
        val box=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL;gravity=android.view.Gravity.CENTER
            setPadding(dp(24),dp(32),dp(24),dp(32))
            setBackgroundResource(R.drawable.bg_empty_state)
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(10)}
        }
        box.addView(ImageView(this).apply {
            setImageResource(icon);setColorFilter(getColor(R.color.text_secondary))
            layoutParams=LinearLayout.LayoutParams(dp(40),dp(40))
            importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        box.addView(TextView(this).apply {
            text=message;textSize=13f;gravity=android.view.Gravity.CENTER
            setTextColor(getColor(R.color.text_secondary))
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(12)}
        })
        target.addView(box)
    }
    /** Badge con punto y tinte por estado, igual que las etiquetas del ADMIN. */
    fun tintBadge(badge: TextView, code: String) {
        badge.text = "● " + status(code)
        val (background, foreground) = when(code) {
            "pendiente","en_atencion" -> R.drawable.bg_badge_waiting to R.color.text_primary
            "en_revision","confirmada" -> R.drawable.bg_badge_inprogress to R.color.text_primary
            "agendada","completada" -> R.drawable.bg_badge_confirmed to R.color.text_primary
            "rechazada" -> R.drawable.bg_badge_triage to R.color.text_primary
            "cancelada","no_asistio" -> R.drawable.bg_input_rounded to R.color.text_secondary
            else -> R.drawable.bg_pill_pink to R.color.wine_primary
        }
        badge.setBackgroundResource(background)
        badge.setTextColor(getColor(foreground))
    }
    internal fun dp(v: Int) = (v*resources.displayMetrics.density).toInt()
}

class ReceptionHubActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_home
    override fun render() {
        clear()
        binding.title.text=getString(R.string.desk_welcome,SessionManager.currentUserName.orEmpty().substringBefore(' '))
        binding.subtitle.text=ReceptionClock.today().format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM",java.util.Locale.forLanguageTag("es-SV")))
        val intro=card(getString(R.string.desk_today),getString(R.string.desk_walkin_caption))
        action(R.string.desk_start_walkin,intro) {Navigator.goToReceptionWalkin(this)}
        section(R.string.section_summary)
        val metrics=metricGrid(listOf("pendiente","en_revision","agendada","rechazada"))
        section(R.string.desk_access)
        tileGrid(listOf(
            Triple(R.string.desk_requests,R.drawable.ic_reception_requests,R.string.desk_request_caption to {Navigator.goToReceptionRequests(this)}),
            Triple(R.string.desk_patients,R.drawable.ic_reception_patient,R.string.desk_patient_caption to {Navigator.goToPatients(this)}),
            Triple(R.string.desk_agenda,R.drawable.ic_reception_calendar,R.string.desk_agenda_caption to {Navigator.goToAppointments(this)}),
            Triple(R.string.desk_hospital,R.drawable.ic_reception_hospital,R.string.desk_hospital_caption to {Navigator.goToAdmissions(this)})))
        retry={render()}
        work({repo.counts()}) { counts ->
            counts.forEach { (state,count) -> metrics[state]?.text=getString(R.string.remote_number,count) }
        }
    }
}
