package sv.edu.catolica.hospital_universitario

import android.widget.LinearLayout
import androidx.core.widget.addTextChangedListener
import org.json.JSONObject
import org.json.JSONArray

class ReceptionHospitalActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_hospital
    private var section="requests"
    private var filter="solicitado"
    private var offset=0
    private var query=""
    private var category=""
    private var bedState=""
    private var roomId=""
    private var selected:String?=null

    override fun render() {
        if(selected==null) selected=intent.getStringExtra("admission_id").also {intent.removeExtra("admission_id")}
        selected?.let {detail(it);return}
        clear()
        chipStrip(listOf("requests" to getString(R.string.desk_hospital_requests),"beds" to getString(R.string.desk_beds),
            "inpatients" to getString(R.string.desk_inpatients),"exits" to getString(R.string.desk_exits)),section) {key ->
            section=key;filter=when(key) {"requests"->"solicitado";"inpatients"->"hospitalizado";else->"alta_medica"}
            offset=0;query="";category="";render()
        }
        retry={render()}
        work({repo.rpc("reception_hospital_inventory") as JSONObject}) {inventory ->
            val rooms=inventory.optJSONArray("rooms")?.objects().orEmpty()
            val beds=inventory.optJSONArray("beds")?.objects().orEmpty()
            if(section=="beds") chipStrip(listOf("disponible","ocupada","limpieza","mantenimiento","fuera_servicio").map {s ->
                s to getString(R.string.desk_stat,status(s),beds.count {displayState(it,rooms)==s})
            },bedState) {bedState=it;render()}
            if(section=="beds") inventory(inventory) else admissions()
        }
    }
    private fun admissions() {
        val search=field(R.string.desk_search,value=query)
        val filters=filterRow()
        val states=when(section) {
            "requests"->listOf("solicitado","cancelado")
            "inpatients"->listOf("hospitalizado","alta_medica","asignado")
            else->listOf("alta_medica","cerrado")
        }
        compact(picker(R.string.desk_state,states.map {it to status(it)},filter,filters) {filter=it;offset=0;render()})
        compact(picker(R.string.desk_category,listOf("" to getString(R.string.desk_all),"vip" to status("vip"),
            "semiprivada" to status("semiprivada")),category,filters) {category=it;render()})
        val list=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(list)
        work({repo.rpc("reception_admissions",args("p_offset" to offset,"p_status" to filter)) as JSONObject}) {page ->
            val all=page.optJSONArray("items")?.objects().orEmpty()
            fun display() {
                list.removeAllViews()
                val rows=all.filter { (category.isBlank()||it.value("category")==category) &&
                    listOf(it.value("patient_name"),it.value("record_number"),it.value("doctor_name"),it.value("assignment"))
                        .joinToString(" ").contains(query,true) }
                if(rows.isEmpty()) note(getString(R.string.desk_empty),list)
                rows.forEach { a ->
                    val location=a.optJSONObject("assignment")
                    val info=listOf(a.value("doctor_name"),status(a.value("category")),
                        a.value("record_number"),location?.let {getString(R.string.desk_location,it.value("room"),it.value("bed"),it.value("floor"))}.orEmpty())
                        .filter {it.isNotBlank()}.joinToString("\n")
                    recordCard(a.value("patient_name"),
                        if(a.value("status")=="solicitado" && a.value("reviewed_at").isNotBlank()) status("en_revision") else status(a.value("status")),
                        info,time(a.value("ordered_at")),list) {selected=a.value("id");detail(selected!!)}
                }
            }
            search.addTextChangedListener {query=it.toString();display()}
            note(getString(R.string.desk_total,page.optInt("total")))
            display()
            if(offset>0) action(R.string.desk_previous) {offset=maxOf(0,offset-25);render()}
            if(page.optBoolean("has_more")) action(R.string.desk_next) {offset=page.optInt("next_offset",offset+25);render()}
        }
    }
    private fun inventory(inv:JSONObject) {
        val rooms=inv.optJSONArray("rooms")?.objects().orEmpty()
        val beds=inv.optJSONArray("beds")?.objects().orEmpty()
        val search=field(R.string.desk_search,value=query)
        val form=filterRow()
        compact(picker(R.string.desk_category,listOf("" to getString(R.string.desk_all))+
            inv.optJSONArray("categories")?.let {a -> (0 until a.length()).map {a.getString(it) to status(a.getString(it))}}.orEmpty(),
            category,form) {category=it;render()})
        compact(picker(R.string.desk_room_filter,listOf("" to getString(R.string.desk_all))+rooms.map {
            it.value("id") to it.value("code")},roomId,form) {roomId=it;render()})
        action(R.string.desk_all) {bedState="";category="";roomId="";query="";render()}
        val list=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(list)
        fun display() {
            list.removeAllViews()
            var shown=0
            rooms.filter {(category.isBlank()||it.value("kind")==category)&&(roomId.isBlank()||it.value("id")==roomId)}.forEach {r ->
                val entries=beds.filter { b ->
                    b.value("room_id")==r.value("id") && (bedState.isBlank()||displayState(b,rooms)==bedState) &&
                        (r.value("code")+" "+b.value("code")+" "+b.optJSONObject("assignment")?.value("patient_name").orEmpty()).contains(query,true)
                }
                if(entries.isEmpty() && (query.isNotBlank()||bedState.isNotBlank())) return@forEach
                shown++
                val body=card(r.value("code"),status(r.value("kind")),list)
                entries.forEach {b ->
                    val state=displayState(b,rooms)
                    val card=card(getString(R.string.desk_bed,r.value("code"),b.value("code"),status(state)),
                        b.value("operational_reason"),body)
                    b.optJSONObject("assignment")?.let {a ->
                        note(a.value("patient_name"),card)
                        note(time(a.value("assigned_at")),card)
                        action(R.string.desk_admission_order,card) {selected=a.value("admission_id");detail(selected!!)}
                    }
                    if(state=="limpieza") action(R.string.desk_clean,card) {
                        confirm(getString(R.string.desk_clean_confirm)) {
                            work({repo.rpc("complete_hospital_bed_cleaning",args("p_bed" to b.value("id")))}) {render()}
                        }
                    }
                }
            }
            if(shown==0) note(getString(R.string.desk_empty),list)
        }
        search.addTextChangedListener {query=it.toString();display()}
        display()
    }
    private fun displayState(b:JSONObject,rooms:List<JSONObject>):String {
        val room=rooms.firstOrNull {it.value("id")==b.value("room_id")}
        return if(!b.optBoolean("active",true)||room?.optBoolean("active",true)==false) "fuera_servicio" else b.value("state")
    }
    private fun detail(id:String) {
        clear()
        action(R.string.desk_back) {selected=null;render()}
        retry={detail(id)}
        work({repo.rpc("reception_hospital_detail",args("p_admission" to id)) as JSONObject}) {d ->
            val body=card(d.value("patient_name"),listOf(d.value("doctor_name"),status(d.value("status")),
                status(d.value("requested_kind")),status(d.value("priority")),time(d.value("ordered_at"))).joinToString("\n"))
            note(d.value("record_number").ifBlank {getString(R.string.desk_missing_record)},body)
            note(d.value("medical_reason"),body);note(d.value("clinical_instructions"),body)
            val state=d.value("status")
            if(state=="solicitado") {
                if(d.value("reviewed_at").isBlank()) action(R.string.desk_review_admission,body) {
                    work({repo.rpc("reception_review_admission",args("p_admission" to id))}) {detail(id)}
                }
                val verified=check(R.string.desk_verify_admission,body)
                verified.isEnabled=d.value("record_number").isNotBlank()
                action(R.string.desk_assign,body) {
                    if(!verified.isChecked || d.value("record_number").isBlank()) {
                        showError(DeskException(R.string.desk_not_verified));return@action
                    }
                    work({
                        if(d.value("reviewed_at").isBlank()) repo.rpc("reception_review_admission",args("p_admission" to id))
                        repo.rpc("reception_admission_availability",args("p_admission" to id)) as JSONObject
                    }) { available ->
                        val beds=available.optJSONArray("beds")?.objects().orEmpty()
                        if(beds.isEmpty()) {note(getString(R.string.remote_no_beds),body);return@work}
                        val options=card(getString(R.string.desk_assign_confirm))
                        beds.forEach {bed ->
                            action(getString(R.string.desk_location,bed.value("room"),bed.value("bed"),bed.value("floor")),options) {
                                confirm(getString(R.string.desk_assign_confirm)+"\n"+d.value("patient_name")+"\n"+
                                    getString(R.string.desk_location,bed.value("room"),bed.value("bed"),bed.value("floor"))) {
                                    work({repo.rpc("reception_resolve_admission",args("p_admission" to id,
                                        "p_action" to "asignar","p_bed" to bed.value("bed_id")))}) {detail(id)}
                                }
                            }
                        }
                    }
                }
                action(R.string.desk_reject_admission,body) {reason(R.string.desk_reject_admission) {why ->
                    work({repo.rpc("reception_resolve_admission",args("p_admission" to id,"p_action" to "rechazar","p_reason" to why))}) {detail(id)}
                }}
            }
            if(state=="hospitalizado") note(getString(R.string.desk_no_discharge),body)
            if(d.value("medically_discharged_at").isNotBlank()) {
                val discharge=card(getString(R.string.desk_discharge_notes),listOf(time(d.value("medically_discharged_at")),
                    d.value("discharged_by_name"),d.value("discharge_notes")).joinToString("\n"))
                if(state=="alta_medica") action(R.string.desk_exit,discharge) {
                    confirm(getString(R.string.desk_exit_confirm)) {
                        work({repo.rpc("release_bed",args("p_admission" to id))}) {detail(id)}
                    }
                }
            }
            if(d.value("closed_at").isNotBlank()) note(listOf(time(d.value("closed_at")),d.value("closed_by_name")).joinToString("\n"),body)
            if(d.value("decision_reason").isNotBlank()) note(d.value("decision_reason"),body)
            val history=card(getString(R.string.desk_history))
            d.optJSONArray("assignments")?.objects()?.forEach {a ->
                note(getString(R.string.desk_location,a.value("room"),a.value("bed"),status(a.value("category"))),history)
                note(listOf(time(a.value("assigned_at")),time(a.value("released_at"))).filter {it.isNotBlank()}.joinToString("\n"),history)
            }
            d.optJSONArray("history")?.objects()?.forEach {h ->
                note(listOf(h.value("label").ifBlank {status(h.value("status"))},time(h.value("at")),h.value("actor"),h.value("reason"))
                    .filter {it.isNotBlank()}.joinToString("\n"),history)
            }
        }
    }
}
