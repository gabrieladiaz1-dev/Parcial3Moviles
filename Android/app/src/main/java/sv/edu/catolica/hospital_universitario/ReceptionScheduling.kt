package sv.edu.catolica.hospital_universitario

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Mismo filtrado y RPC que RequestDetail/WalkinCare del ADMIN. */
class ReceptionScheduling(private val ui: ReceptionDeskActivity) {
    private var day=ReceptionClock.today()
    private var mode="scheduled"
    private var specialty=0L
    private var priority="normal"
    private var doctor=""
    private var slots=listOf<JSONObject>()
    private var key=UUID.randomUUID().toString()
    private var submittedPayload=""
    private var reason=""
    private var symptoms=""
    private var request: JSONObject?=null
    private lateinit var patient: JSONObject

    fun open(patient: JSONObject,request: JSONObject?=null) {
        this.patient=patient;this.request=request
        specialty=request?.optLong("specialty_id")?:0L
        render()
    }
    private fun render(): Unit = with(ui) {
        clear()
        action(R.string.desk_back) {ui.render()}
        patientCard(patient,nullRecord())
        val form=card(getString(R.string.desk_schedule))
        if(request==null) {
            // render() calificado: sin él, dentro de with(ui) resuelve al render() de la Activity contenedora.
            picker(R.string.desk_service,listOf("scheduled" to getString(R.string.desk_mode_scheduled),
                "immediate" to getString(R.string.desk_mode_immediate)),mode,form) { mode=it;slots=emptyList();doctor="";key=UUID.randomUUID().toString();this@ReceptionScheduling.render() }
            val reasonField=field(R.string.desk_care_reason,form,reason)
            val symptomField=field(R.string.desk_care_symptoms,form,symptoms,1000)
            reasonField.addTextChangedListener(SimpleDeskWatcher {reason=it;key=UUID.randomUUID().toString()})
            symptomField.addTextChangedListener(SimpleDeskWatcher {symptoms=it;key=UUID.randomUUID().toString()})
            picker(R.string.desk_priority,listOf("normal" to status("normal"),"urgente" to status("urgente")),priority,form) {
                priority=it;key=UUID.randomUUID().toString();this@ReceptionScheduling.render()
            }
            if(priority=="urgente" || mode=="immediate") note(getString(R.string.desk_urgent_notice),form)
        } else note(status(request!!.value("preferred_period")),form)
        if(mode=="scheduled") date(day,form,true) {day=it;slots=emptyList();doctor="";key=UUID.randomUUID().toString();this@ReceptionScheduling.render()}
        val slotList=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(slotList)
        retry={this@ReceptionScheduling.render()}
        work({ repo.rows("specialties","select=id,name&active=eq.true") }) { catalog ->
            val choices=if(request==null) catalog else catalog.filter {it.optLong("id")==specialty}
            picker(R.string.desk_specialty,choices.map {it.value("id") to it.value("name")},specialty.toString(),form) {
                specialty=it.toLong();slots=emptyList();doctor="";key=UUID.randomUUID().toString();this@ReceptionScheduling.render()
            }
            action(R.string.desk_availability,form) {
                if(specialty==0L) {showError(DeskException(R.string.desk_invalid));return@action}
                if(mode=="scheduled" && day<ReceptionClock.today()) {showError(DeskException(R.string.desk_invalid));return@action}
                work({
                    repo.slots(specialty,if(mode=="immediate") ReceptionClock.today() else day,patient.value("id")).filter {
                        mode!="immediate" || OffsetDateTime.parse(it.value("starts_at")).toInstant().let { t ->
                            t>java.time.Instant.now() && t<=java.time.Instant.now().plusSeconds(7200)
                        }
                    }
                }) { found -> slots=found;doctor="";showSlots(slotList) }
            }
            if(slots.isNotEmpty()) showSlots(slotList)
        }
    }
    // Patient identity was verified by the preceding screen. The server checks it again.
    private fun nullRecord(): String? = patient.value("record_code").ifBlank {null}
    private fun showSlots(target: LinearLayout): Unit = with(ui) {
        target.removeAllViews()
        if(slots.isEmpty()) {note(getString(R.string.desk_no_slots),target);return}
        val doctors=slots.distinctBy {it.value("doctor_id")}
        picker(R.string.desk_select_doctor,listOf("" to getString(R.string.desk_all))+
            doctors.map {it.value("doctor_id") to it.value("doctor_name")},doctor,target) {
            doctor=it;showSlots(target)
        }
        val preference=request?.value("preferred_period")
        val ordered=slots.sortedWith(compareBy<JSONObject> {
            val morning=OffsetDateTime.parse(it.value("starts_at")).atZoneSameInstant(ReceptionClock.zone).hour<12
            if(preference=="manana" && morning || preference=="tarde" && !morning) 0 else 1
        }.thenBy {it.value("starts_at")})
        ordered.filter {doctor.isBlank() || it.value("doctor_id")==doctor}.forEach {slot ->
            val label=getString(R.string.desk_slot,slot.value("doctor_name"),time(slot.value("starts_at")),
                time(slot.value("ends_at")),slot.value("room_code"),slot.optInt("slot_minutes"))
            action(label,target) {showSelection(slot)}
        }
    }
    private fun showSelection(slot: JSONObject): Unit = with(ui) {
        work({repo.rpc("reception_doctor_day",args("p_doctor" to slot.value("doctor_id"),"p_day" to
            (if(mode=="immediate") ReceptionClock.today() else day).toString())) as JSONObject}) {context ->
            val panel=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL;setPadding(24,12,24,12)}
            note(patientText(patient),panel)
            note(getString(R.string.desk_slot,slot.value("doctor_name"),time(slot.value("starts_at")),
                time(slot.value("ends_at")),slot.value("room_code"),slot.optInt("slot_minutes")),panel)
            context.optJSONArray("shifts")?.objects()?.forEach {
                note(getString(R.string.desk_shift,time(it.value("starts_at")),time(it.value("ends_at"))),panel)
            }
            context.optJSONArray("consultations")?.objects()?.forEach {
                note(getString(R.string.desk_consultation,time(it.value("starts_at")),time(it.value("ends_at")),
                    it.value("room_code"),it.optInt("slot_minutes")),panel)
            }
            val verified=check(R.string.desk_confirm_appointment,panel)
            val scroll=android.widget.ScrollView(this).apply {addView(panel)}
            val dialog=com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle(R.string.desk_doctor_day).setView(scroll)
                .setPositiveButton(R.string.desk_schedule,null).setNegativeButton(R.string.desk_cancel,null).create()
            dialog.setOnShowListener {
                dialog.getButton(-1).setOnClickListener {
                    if(!verified.isChecked) {verified.error=getString(R.string.desk_identity_required);return@setOnClickListener}
                    if(request==null && (reason.isBlank() || mode=="immediate" && symptoms.isBlank())) {
                        showError(DeskException(R.string.desk_invalid));return@setOnClickListener
                    }
                    dialog.dismiss()
                    val values=args("mode" to mode,"specialty_id" to specialty,"doctor_id" to slot.value("doctor_id"),
                        "room_id" to slot.value("consulting_room_id"),"starts_at" to slot.value("starts_at"),
                        "ends_at" to slot.value("ends_at"),"reason" to reason,"symptoms" to symptoms,
                        "priority" to priority,"identity_confirmed" to true)
                    if(values.toString()!=submittedPayload) {
                        submittedPayload=values.toString();key=UUID.randomUUID().toString()
                    }
                    work({
                        if(request!=null) repo.rpc("schedule_appointment",args(
                            "p_request" to request!!.value("id"),"p_patient" to patient.value("id"),
                            "p_doctor" to slot.value("doctor_id"),"p_room" to slot.value("consulting_room_id"),
                            "p_start" to slot.value("starts_at"),"p_end" to slot.value("ends_at")))
                        else repo.rpc("reception_walkin_attention",args("p_patient" to patient.value("id"),
                            "p_key" to key,"p_values" to values))
                    }) {
                        clear()
                        card(getString(R.string.desk_saved),getString(R.string.desk_slot,
                            slot.value("doctor_name"),time(slot.value("starts_at")),time(slot.value("ends_at")),
                            slot.value("room_code"),slot.optInt("slot_minutes")))
                        note(getString(R.string.desk_clinical_guard))
                        action(R.string.desk_agenda) {Navigator.goToAppointments(this,true)}
                    }
                }
            }
            dialog.show()
        }
    }
}
internal class SimpleDeskWatcher(private val change:(String)->Unit) : android.text.TextWatcher {
    override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int) {}
    override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int) {change(s?.toString().orEmpty())}
    override fun afterTextChanged(s:android.text.Editable?) {}
}

class ReceptionAgendaActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_agenda
    private var day=ReceptionClock.today()
    override fun render() {
        clear()
        // Cabecera con la fecha larga y el total del día, como el encabezado diario del ADMIN.
        val title=day.format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM 'de' yyyy",
            java.util.Locale.forLanguageTag("es-SV")))
        val head=header(R.drawable.ic_reception_calendar,getString(R.string.desk_agenda_eyebrow),
            title,getString(R.string.desk_agenda_help))
        val count=TextView(this).apply {
            textSize=11f;visibility=android.view.View.GONE
            setTextColor(getColor(R.color.wine_primary))
            setBackgroundResource(R.drawable.bg_pill_pink)
            setPadding(dp(10),dp(6),dp(10),dp(6))
            layoutParams=LinearLayout.LayoutParams(-2,-2).apply {leftMargin=dp(8)}
        }
        head.addView(count)
        val controls=filterRow()
        date(day,controls) {day=it;render()}
        compact(controls.getChildAt(0) as Button)
        compact(action(getString(R.string.desk_refresh),controls) {render()})
        val list=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(list)
        retry={render()}
        work({
            val agenda=(repo.rpc("reception_agenda",args("p_day" to day.toString())) as JSONArray).objects()
            // reception_agenda no publica el turno: se lee appointments.queue_number (RLS de recepción) y se une por id.
            val ids=agenda.map { it.value("id") }.filter { Regex("^[0-9a-fA-F-]{36}$").matches(it) }
            if(ids.isNotEmpty()) {
                val turns=repo.rows("appointments","select=id,queue_number&id=in.(${ids.joinToString(",")})").associate { it.value("id") to it.value("queue_number") }
                agenda.forEach { a -> turns[a.value("id")]?.takeIf { it.isNotBlank() }?.let { a.put("queue_number",it) } }
            }
            agenda
        }) { rows ->
            count.text=resources.getQuantityString(R.plurals.desk_agenda_count,rows.size,rows.size)
            count.visibility=android.view.View.VISIBLE
            if(rows.isEmpty()) emptyState(getString(R.string.desk_empty),R.drawable.ic_reception_calendar,list)
            else rows.forEach {a -> appointmentCard(a,list) }
        }
    }
}
