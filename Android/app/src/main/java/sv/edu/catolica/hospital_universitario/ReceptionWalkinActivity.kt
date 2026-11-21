package sv.edu.catolica.hospital_universitario

import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Patterns
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

class ReceptionWalkinActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_walkin
    private val handler=Handler(Looper.getMainLooper())
    private var lookup: Runnable?=null
    private var lookupVersion=0
    private var patient: JSONObject?=null
    private var code: String?=null
    private var preserved=JSONObject()
    private var assessmentKey=UUID.randomUUID().toString()

    override fun render() {
        if(patient!=null) {showPatient();return}
        clear()
        note(getString(R.string.desk_walkin_help))
        val fields=linkedMapOf<String,EditText>()
        val identityCard=card(getString(R.string.desk_identification))
        fields["first"]=field(R.string.desk_name,identityCard,preserved.value("first"),100)
        fields["last"]=field(R.string.desk_last,identityCard,preserved.value("last"),100)
        fields["dui"]=field(R.string.desk_document,identityCard,preserved.value("dui"),10)
        fields["birth"]=field(R.string.desk_birth,identityCard,preserved.value("birth"),10)
        mask(fields["birth"]!!) { maskDate(it) }
        fields["dui"]!!.inputType=InputType.TYPE_CLASS_PHONE
        mask(fields["dui"]!!) { maskDocument(it) }
        note(getString(R.string.desk_document_hint),identityCard)
        val contact=card(getString(R.string.desk_contact))
        fields["phone"]=field(R.string.desk_phone,contact,preserved.value("phone"),9).apply {inputType=InputType.TYPE_CLASS_PHONE}
        mask(fields["phone"]!!) { maskPhone(it) }
        fields["email"]=field(R.string.desk_email,contact,preserved.value("email"),254).apply {
            inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        var city=preserved.value("city")
        var verified:android.widget.CheckBox?=null
        picker(R.string.desk_city,cityOptions(),city,contact) {
            city=it;preserved.put("city",it);verified?.isChecked=false
        }
        verified=check()
        fields.forEach { (key,input) -> input.addTextChangedListener(SimpleDeskWatcher {
            preserved.put(key,it);verified?.isChecked=false
        }) }
        val lookupText=android.widget.TextView(this)
        identityCard.addView(lookupText)
        val recovery=action(R.string.desk_recover,identityCard) {
            val doc=runCatching {normalizeDocument(fields["dui"]!!.text.toString())}.getOrElse {showError(it);return@action}
            work({repo.patientByDui(doc)?.let {it to repo.record(it.value("id"))}}) {
                if(it==null) lookupText.setText(R.string.desk_walkin_not_found) else {
                    patient=it.first;code=it.second;showPatient()
                }
            }
        }
        recovery.visibility=android.view.View.GONE
        fields["dui"]!!.addTextChangedListener(SimpleDeskWatcher { value ->
            lookup?.let {handler.removeCallbacks(it)}
            val version=++lookupVersion
            recovery.visibility=android.view.View.GONE
            lookupText.text=""
            val doc=runCatching {normalizeDocument(value)}.getOrNull() ?: return@SimpleDeskWatcher
            lookup=Runnable {
                lookupText.setText(R.string.desk_checking)
                val user=SessionManager.currentUser
                AppContainer.ioExecutor.execute {
                    val result=runCatching {repo.patientByDui(doc)}
                    runOnUiThread {
                        if(isDestroyed || isFinishing || lookupVersion!=version || SessionManager.currentUser !== user) return@runOnUiThread
                        result.fold({found ->
                            lookupText.setText(if(found==null) R.string.desk_walkin_not_found else R.string.desk_existing)
                            recovery.visibility=if(found==null) android.view.View.GONE else android.view.View.VISIBLE
                        },{lookupText.setText(R.string.desk_lookup_failed)})
                    }
                }
            }.also {handler.postDelayed(it,450)}
        })
        action(R.string.desk_create) {
            try {
                if(verified?.isChecked != true) throw DeskException(R.string.desk_identity_required)
                val first=required(fields.getValue("first"))
                val last=required(fields.getValue("last"))
                val doc=normalizeDocument(required(fields.getValue("dui")))
                val birth=fields.getValue("birth").text.toString().trim().ifBlank {null}
                val phone=fields.getValue("phone").text.toString().trim().ifBlank {null}
                val email=fields.getValue("email").text.toString().trim().ifBlank {null}
                // El servidor valida los 262 municipios sin departamento: se envía solo el municipio.
                val selectedCity=city.substringBefore(" (").trim().ifBlank {null}
                if(birth!=null) {
                    val d=runCatching {LocalDate.parse(birth)}.getOrNull()
                    if(d==null || d>ReceptionClock.today() || d<ReceptionClock.today().minusYears(120)) {
                        fields.getValue("birth").error=getString(R.string.desk_birth_invalid)
                        throw DeskException(R.string.desk_birth_invalid)
                    }
                }
                if(phone!=null && !Regex("^[0-9]{4}-[0-9]{4}$").matches(phone)) {
                    fields.getValue("phone").error=getString(R.string.desk_phone_error);throw DeskException(R.string.desk_phone_error)
                }
                if(email!=null && !Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                    fields.getValue("email").error=getString(R.string.desk_invalid);throw DeskException(R.string.desk_invalid)
                }
                confirm {
                    lookupVersion++
                    work({
                        val existing=repo.patientByDui(doc)
                        if(existing!=null) existing to repo.record(existing.value("id"))
                        else {
                            val id=repo.rpc("create_walkin_patient",args("p_first" to first,"p_last" to last,"p_dui" to doc,
                                "p_phone" to phone,"p_birth" to birth,"p_city" to selectedCity,"p_email" to email)) as String
                            val saved=repo.patientByDui(doc)?.takeIf {it.value("id")==id}
                                ?: throw DeskException(R.string.desk_no_duplicate)
                            saved to repo.record(id)
                        }
                    }) { patient=it.first;code=it.second;showPatient() }
                }
            } catch(e:DeskException) {showError(e)}
        }
        retry={render()}
    }

    /** Opciones del selector de ciudad: lista oficial de municipios, sin ciudad cuando es opcional. */
    private fun cityOptions(): List<Pair<String,String>> {
        val collator=java.text.Collator.getInstance(java.util.Locale("es","SV"))
        val municipios=resources.getStringArray(R.array.municipios_salvador).sortedWith(object: java.util.Comparator<String> {
            override fun compare(a:String,b:String):Int=collator.compare(a,b)
        })
        return listOf("" to getString(R.string.desk_city_none))+municipios.map {it to it}
    }

    /** Teléfono salvadoreño 0000-0000 aplicado mientras se escribe; acepta solo dígitos. */
    private fun maskPhone(value:String):String {
        val digits=value.filter {it.isDigit()}.take(8)
        return if(digits.length<=4) digits else digits.take(4)+"-"+digits.substring(4)
    }

    /** DUI 00000000-0 aplicado mientras se escribe; acepta solo dígitos. */
    private fun maskDocument(value:String):String {
        val digits=value.filter {it.isDigit()}.take(9)
        return if(digits.length<=8) digits else digits.take(8)+"-"+digits.substring(8)
    }

    /** Fecha AAAA-MM-DD aplicada mientras se escribe; acepta solo dígitos. */
    private fun maskDate(value:String):String {
        val digits=value.filter {it.isDigit()}.take(8)
        return buildString {
            append(digits.take(4))
            if(digits.length>4) append("-").append(digits.substring(4, minOf(6,digits.length)))
            if(digits.length>6) append("-").append(digits.substring(6))
        }
    }

    /** Formatea el texto sin perder el cursor y sin bucles de actualización. */
    private fun mask(input:EditText, format:(String)->String) {
        input.addTextChangedListener(object:TextWatcher {
            private var guard=false
            override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int)=Unit
            override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int)=Unit
            override fun afterTextChanged(text:Editable?) {
                if(guard||text==null) return
                val current=text.toString()
                val formatted=format(current)
                if(formatted==current) return
                guard=true
                try {
                    val cursor=android.text.Selection.getSelectionStart(text).coerceAtLeast(0)
                    val delta=formatted.length-current.length
                    text.replace(0,text.length,formatted)
                    input.setSelection((cursor+delta).coerceIn(0,formatted.length))
                } finally {guard=false}
            }
        })
    }

    private fun showPatient() {
        val p=patient ?: return
        clear()
        val card=patientCard(p,code)
        val verified=check(target=card)
        action(R.string.desk_back,card) {patient=null;render()}
        if(code==null) return
        action(R.string.desk_schedule) {
            if(!verified.isChecked) {showError(DeskException(R.string.desk_identity_required));return@action}
            ReceptionScheduling(this).open(p)
        }
        note(getString(R.string.desk_clinical_guard))
        action(R.string.desk_assessment) {
            if(!verified.isChecked) {showError(DeskException(R.string.desk_identity_required));return@action}
            assessment(p,0)
        }
    }

    private fun assessment(p:JSONObject,offset:Int) {
        clear()
        action(R.string.desk_back) {showPatient()}
        val form=card(getString(R.string.desk_assessment),getString(R.string.desk_assessment_help))
        note(getString(R.string.desk_urgent_notice),form)
        val reason=field(R.string.desk_assessment_reason,form)
        var doctor=""
        var priority="normal"
        val list=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(list)
        retry={assessment(p,offset)}
        work({repo.rpc("admission_assessment_context",args("p_patient" to p.value("id"),"p_offset" to offset)) as JSONObject}) {context ->
            val doctors=context.optJSONArray("doctors")?.objects().orEmpty()
            picker(R.string.desk_doctor,doctors.map {it.value("id") to (it.value("name")+" · "+it.value("code"))},doctor,form) {
                doctor=it;assessmentKey=UUID.randomUUID().toString()
            }
            // Priority options are the exact enum accepted by the ADMIN contract.
            val priorityButton=action(R.string.desk_normal,form) {}
            priorityButton.setOnClickListener {
                com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                    .setItems(arrayOf(status("normal"),status("urgente"))) {_,i ->
                        priority=if(i==0) "normal" else "urgente";priorityButton.text=status(priority);assessmentKey=UUID.randomUUID().toString()
                    }.show()
            }
            reason.addTextChangedListener(SimpleDeskWatcher {assessmentKey=UUID.randomUUID().toString()})
            action(R.string.desk_assessment_send,form) {
                if(doctor.isBlank() || reason.text.toString().isBlank()) {showError(DeskException(R.string.desk_invalid));return@action}
                val text=reason.text.toString().trim()
                confirm(getString(R.string.desk_confirm_assessment)) {
                    work({repo.rpc("reception_request_admission_assessment",args("p_patient" to p.value("id"),
                        "p_doctor" to doctor,"p_reason" to text,"p_priority" to priority,"p_key" to assessmentKey))}) {
                        assessment(p,offset)
                    }
                }
            }
            val items=context.optJSONArray("items")?.objects().orEmpty()
            if(items.isEmpty()) note(getString(R.string.desk_empty),list)
            items.forEach {a ->
                val body=card(status(a.value("status")),listOf(a.value("doctor_name"),time(a.value("requested_at")),
                    a.value("reason"),status(a.value("priority"))).joinToString("\n"),list)
                if(a.value("status")=="approved" && a.value("admission_id").isNotBlank()) {
                    action(R.string.desk_continue_admission,body) {
                        Navigator.goToReceptionHospitalDetail(this,a.value("admission_id"))
                    }
                }
            }
            action(R.string.desk_assessment_follow,list) {assessment(p,offset)}
            if(offset>0) action(R.string.desk_previous,list) {assessment(p,maxOf(0,offset-100))}
            if(context.optBoolean("has_more")) action(R.string.desk_next,list) {assessment(p,context.optInt("next_offset",offset+100))}
        }
    }
    override fun onDestroy() {
        lookupVersion++
        lookup?.let {handler.removeCallbacks(it)}
        super.onDestroy()
    }
}
