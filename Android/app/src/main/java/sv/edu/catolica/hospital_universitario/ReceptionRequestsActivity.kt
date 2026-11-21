package sv.edu.catolica.hospital_universitario

import androidx.core.widget.addTextChangedListener
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

class ReceptionRequestsActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_requests
    private var state=""
    private var newest=false
    private var offset=0
    private var rows=listOf<JSONObject>()
    private var specialties=mapOf<Long,String>()
    private var query=""
    private var selected: JSONObject?=null

    override fun render() {
        if(selected!=null) { detail(selected!!);return }
        clear()
        val metricStates=listOf("pendiente","en_revision","agendada","rechazada","cancelada")
        // Encabezado de la bandeja con el contador de solicitudes en pantalla.
        val head=header(R.drawable.ic_reception_requests,getString(R.string.desk_inbox_eyebrow),
            getString(R.string.desk_inbox_title),getString(R.string.desk_inbox_help))
        val countNumber=TextView(this).apply {
            textSize=23f;setTypeface(typeface,android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.wine_primary));gravity=android.view.Gravity.CENTER
        }
        val countLabel=TextView(this).apply {
            textSize=10f;setTextColor(getColor(R.color.text_secondary));gravity=android.view.Gravity.CENTER
        }
        head.addView(LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL;gravity=android.view.Gravity.CENTER
            setBackgroundResource(R.drawable.bg_count_box)
            setPadding(dp(13),dp(9),dp(13),dp(9))
            layoutParams=LinearLayout.LayoutParams(-2,-2).apply {leftMargin=dp(8)}
            addView(countNumber);addView(countLabel)
        })
        val summary=HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled=false
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(12)}
        }
        val summaryRow=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
        val metrics=linkedMapOf<String,TextView>()
        summary.addView(summaryRow)
        binding.content.addView(summary)
        metricStates.forEach {code ->
            val amount=TextView(this).apply {
                text=getString(R.string.remote_number,0)
                textSize=18f
                setTypeface(typeface,android.graphics.Typeface.BOLD)
                setTextColor(getColor(R.color.wine_primary))
                gravity=android.view.Gravity.START
            }
            val label=TextView(this).apply {
                text=status(code)
                textSize=11f
                setTextColor(getColor(R.color.text_secondary))
                gravity=android.view.Gravity.START
                layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(2)}
            }
            val chip=LinearLayout(this).apply {
                orientation=LinearLayout.VERTICAL
                setPadding(dp(12),dp(9),dp(12),dp(9))
                setBackgroundResource(if(code==state) R.drawable.bg_pill_pink else R.drawable.bg_dashboard_card)
                layoutParams=LinearLayout.LayoutParams(dp(112),-2).apply {rightMargin=dp(8)}
                isClickable=true;isFocusable=true
                addView(amount);addView(label)
                setOnClickListener {if(!busy){state=code;offset=0;render()}}
            }
            metrics[code]=amount
            summaryRow.addView(chip)
        }
        val filterCard=card(getString(R.string.desk_request_filters))
        val search=field(R.string.desk_search,filterCard,value=query)
        val controls=filterRow(filterCard)
        val states=listOf("","pendiente","en_revision","agendada","rechazada","cancelada")
        compact(picker(R.string.desk_state,states.map {it to if(it.isBlank()) getString(R.string.desk_open) else status(it)},state,controls) {
            state=it;offset=0;render()
        })
        compact(picker(R.string.desk_order,listOf("old" to getString(R.string.desk_old_short),"new" to getString(R.string.desk_new_short)),
            if(newest) "new" else "old",controls) {newest=it=="new";offset=0;render()})
        compact(action(getString(R.string.desk_refresh),controls) {offset=0;render()})
        section(R.string.desk_request_results)
        val list=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(list)
        val more=action(R.string.desk_more) {}
        more.visibility=android.view.View.GONE
        fun display() {
            list.removeAllViews()
            val visible=rows.filter {
                (it.optJSONObject("applicant_data")?.toString().orEmpty()+" "+specialties[it.optLong("specialty_id")]).contains(query,true)
            }
            countNumber.text=getString(R.string.remote_number,visible.size)
            countLabel.text=resources.getQuantityString(R.plurals.desk_visible_count,visible.size)
            if(visible.isEmpty()) emptyState(getString(R.string.desk_empty),R.drawable.ic_reception_requests,list)
            visible.forEach { row ->
                val person=row.optJSONObject("applicant_data")?:JSONObject()
                val title=listOf(person.value("first_name"),person.value("last_name")).joinToString(" ")
                    .trim().ifBlank {getString(R.string.desk_name_missing)}
                val initials=listOf(person.value("first_name"),person.value("last_name"))
                    .map{it.trim()}.filter{it.isNotEmpty()}.map{it[0].uppercaseChar()}.take(2).joinToString("")
                // Barra de acento izquierda por estado, como las tarjetas del ADMIN.
                val accent=when(row.value("status")) {
                    "pendiente" -> R.drawable.bg_card_accent_pending
                    "en_revision" -> R.drawable.bg_card_accent_review
                    "agendada" -> R.drawable.bg_card_accent_scheduled
                    "rechazada" -> R.drawable.bg_card_accent_rejected
                    "cancelada" -> R.drawable.bg_card_accent_cancelled
                    else -> 0
                }
                val item=recordCard(title,"",
                    listOf(specialties[row.optLong("specialty_id")].orEmpty(),status(row.value("preferred_period"))).joinToString(" · "),
                    getString(R.string.desk_received_at,time(row.value("created_at"))),list,accent) {selected=row;detail(row)}
                if(initials.isNotBlank()) {
                    item.avatar.text=initials
                    item.avatar.visibility=android.view.View.VISIBLE
                }
                item.eyebrow.setText(R.string.desk_request_eyebrow)
                item.eyebrow.visibility=android.view.View.VISIBLE
                tintBadge(item.badge,row.value("status"))
                item.footerLeft.setText(if(row.value("patient_id").isBlank()) R.string.desk_lookup else R.string.desk_patient_linked)
                item.footerRight.setText(if(row.value("status")=="en_revision") R.string.desk_continue_attention else R.string.desk_view_request)
                item.footerRow.visibility=android.view.View.VISIBLE
            }
        }
        search.addTextChangedListener {query=it.toString();display()}
        retry={offset=0;render()}
        work({
            val catalog=repo.rows("specialties","select=id,name")
            Triple(repo.requestPage(state,offset,newest),repo.counts(),catalog)
        }) { (page,counts,catalog) ->
            specialties=catalog.associate {it.getLong("id") to it.value("name")}
            rows=page.first
            counts.forEach {(s,n)-> metrics[s]?.text=getString(R.string.remote_number,n)}
            more.visibility=if(page.second) android.view.View.VISIBLE else android.view.View.GONE
            display()
            more.setOnClickListener {
                if(!busy) {
                    val nextOffset=offset+100
                    work({repo.requestPage(state,nextOffset,newest)}) { next ->
                        offset=nextOffset
                        val codes=listOf("pendiente","en_revision","agendada","rechazada","cancelada")
                        rows=(rows+next.first).distinctBy {it.value("id")}.sortedWith {a,b ->
                            val priority=if(state.isBlank()) codes.indexOf(a.value("status"))-codes.indexOf(b.value("status")) else 0
                            if(priority!=0) priority else a.value("created_at").compareTo(b.value("created_at")) * if(newest) -1 else 1
                        }
                        more.visibility=if(next.second) android.view.View.VISIBLE else android.view.View.GONE
                        display()
                    }
                }
            }
        }
    }
    private fun detail(request: JSONObject) {
        selected=request
        clear()
        action(R.string.desk_back) { selected=null;offset=0;render() }
        val person=request.optJSONObject("applicant_data")?:JSONObject()
        val fullName=listOf(person.value("first_name"),person.value("last_name")).filter{it.isNotBlank()}
            .joinToString(" ").ifBlank {getString(R.string.desk_name_missing)}
        header(R.drawable.ic_reception_requests,getString(R.string.desk_request_eyebrow),fullName)
        // Estado con punto y fecha de recepción, como el encabezado del detalle en el ADMIN.
        val statusRow=LinearLayout(this).apply {
            orientation=LinearLayout.HORIZONTAL;gravity=android.view.Gravity.CENTER_VERTICAL
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(14)}
        }
        val stateBadge=TextView(this)
        tintBadge(stateBadge,request.value("status"))
        stateBadge.setPadding(dp(10),dp(6),dp(10),dp(6))
        statusRow.addView(stateBadge)
        statusRow.addView(TextView(this).apply {
            text=getString(R.string.desk_received_at,time(request.value("created_at")))
            textSize=11f;setTextColor(getColor(R.color.text_secondary))
            layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {leftMargin=dp(10)}
        })
        binding.content.addView(statusRow)
        val data=card(getString(R.string.desk_request_data))
        var fields=listOf(
            getString(R.string.desk_data_dui) to person.value("dui"),
            getString(R.string.desk_data_birth) to person.value("birth_date"),
            getString(R.string.desk_data_phone) to person.value("phone"),
            getString(R.string.desk_email) to person.value("email"),
            getString(R.string.desk_city) to person.value("city"),
            getString(R.string.desk_patient_code) to person.value("patient_code"),
            getString(R.string.desk_specialty) to specialties[request.optLong("specialty_id")].orEmpty(),
            getString(R.string.desk_preference) to status(request.value("preferred_period")),
            getString(R.string.desk_data_reason) to request.value("reason"),
            getString(R.string.desk_other_symptoms) to request.value("other_symptoms"))
        if(request.value("closure_reason").isNotBlank())
            fields=fields+(getString(R.string.desk_closure_reason) to request.value("closure_reason"))
        dataGrid(fields,data)
        val follow=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(follow)
        retry={detail(request)}
        work({
            val id=request.value("patient_id")
            val account=request.value("requester_id")
            val patients=when {
                id.isNotBlank()->repo.rows("patients","select=*&id=eq.$id")
                account.isNotBlank()->repo.rows("patients","select=*&profile_id=eq.$account")
                else -> emptyList()
            }
            val symptoms=repo.rows("appointment_request_symptoms",
                "select=symptom_id,symptom_catalog(name)&request_id=eq.${request.value("id")}")
            val appointment=repo.rows("appointments","select=*&request_id=eq.${request.value("id")}&limit=2").map {a ->
                val day=java.time.OffsetDateTime.parse(a.value("starts_at"))
                    .atZoneSameInstant(ReceptionClock.zone).toLocalDate().toString()
                val agenda=(repo.rpc("reception_agenda",args("p_day" to day)) as JSONArray).objects()
                agenda.firstOrNull {it.value("id")==a.value("id")} ?: a
            }
            Triple(patients.singleOrNull()?.let {it to repo.record(it.value("id"))},symptoms,appointment)
        }) { (linked,symptoms,appointment) ->
            val names=symptoms.mapNotNull {it.optJSONObject("symptom_catalog")?.value("name")}.joinToString(", ")
            if(names.isNotBlank()) {
                fields=fields+(getString(R.string.desk_symptoms) to names)
                data.removeAllViews()
                dataGrid(fields,data)
            }
            if(appointment.isNotEmpty()) {
                section(R.string.desk_appointments,follow)
                appointment.forEach {a ->
                    if(a.value("patient_name").isBlank()) a.put("patient_name",fullName)
                    appointmentCard(a,follow)
                }
            }
            if(request.value("status") !in listOf("pendiente","en_revision")) return@work
            action(R.string.desk_review_action,follow) {
                work({repo.rpc("review_attention_request",args("p_request" to request.value("id"),"p_status" to "en_revision"))}) {
                    request.put("status","en_revision")
                    verify(request,linked)
                }
            }
            action(R.string.desk_reject,follow) {close(request,"rechazada")}
            action(R.string.desk_cancel_request,follow) {close(request,"cancelada")}
        }
    }
    private fun close(request: JSONObject,state: String) {
        reason(if(state=="rechazada") R.string.desk_reject else R.string.desk_cancel_request) {text ->
            work({repo.rpc("close_attention_request",args("p_request" to request.value("id"),"p_status" to state,"p_reason" to text))}) {
                request.put("status",state).put("closure_reason",text);detail(request)
            }
        }
    }
    private fun verify(request: JSONObject,linked: Pair<JSONObject,String?>?) {
        clear()
        action(R.string.desk_back) {detail(request)}
        val person=request.optJSONObject("applicant_data")?:JSONObject()
        card(getString(R.string.desk_request_data),patientText(person))
        if(linked!=null) {
            val body=patientCard(linked.first,linked.second)
            if(linked.second!=null && request.value("patient_id").isNotBlank()) {
                action(R.string.desk_schedule,body) {
                    ReceptionScheduling(this).open(linked.first,request)
                }
                return
            }
        }
        val form=card(getString(R.string.desk_compare))
        val document=field(R.string.desk_dui,form,person.value("dui"),10)
        val results=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(results)
        action(R.string.desk_lookup,form) {
            val dui=runCatching {normalizeDocument(document.text.toString())}.getOrElse {showError(it);return@action}
            work({repo.patientByDui(dui)?.let {it to repo.record(it.value("id"))}}) {found ->
                results.removeAllViews()
                if(found!=null) {
                    val body=patientCard(found.first,found.second,results)
                    note(getString(R.string.desk_match_compare,patientText(person),patientText(found.first)),body)
                    val differentAccount=found.first.value("profile_id").isNotBlank() &&
                        found.first.value("profile_id")!=request.value("requester_id")
                    if(differentAccount) note(getString(R.string.desk_other_account),body)
                    val identity=check(target=body)
                    identity.isEnabled=!differentAccount
                    if(found.second!=null && !differentAccount) action(R.string.desk_link,body) {
                        if(!identity.isChecked) {showError(DeskException(R.string.desk_identity_required));return@action}
                        confirm(getString(R.string.desk_confirm_link)) {
                            work({repo.rpc("link_attention_patient",args("p_request" to request.value("id"),
                                "p_patient" to found.first.value("id"),"p_identity_confirmed" to true))}) {
                                request.put("patient_id",found.first.value("id"))
                                verify(request,found)
                            }
                        }
                    }
                } else {
                    note(getString(R.string.desk_not_found),results)
                    val identity=check(target=results)
                    action(R.string.desk_create_link,results) {
                        if(!identity.isChecked) {showError(DeskException(R.string.desk_identity_required));return@action}
                        confirm(getString(R.string.desk_confirm_create)) {
                            work({
                                val id=repo.rpc("create_attention_patient",args("p_request" to request.value("id"),
                                    "p_identity_confirmed" to true)) as String
                                val p=repo.rows("patients","select=*&id=eq.$id").single()
                                p to repo.record(id)
                            }) { patient -> request.put("patient_id",patient.first.value("id"));verify(request,patient) }
                        }
                    }
                }
            }
        }
    }
}
