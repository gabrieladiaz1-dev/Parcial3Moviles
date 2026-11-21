package sv.edu.catolica.hospital_universitario

import android.text.InputType
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

internal fun ReceptionDeskActivity.patientText(p: JSONObject): String =
    listOf("first_name" to R.string.desk_name,"last_name" to R.string.desk_last,
        "dui" to R.string.desk_dui,"birth_date" to R.string.desk_birth,
        "phone" to R.string.desk_phone,"email" to R.string.desk_email,"city" to R.string.desk_city,
        "patient_code" to R.string.desk_patient_code).mapNotNull { (key,label) ->
        p.value(key).takeIf {it.isNotBlank()}?.let {getString(R.string.desk_identity_row,getString(label),it)}
    }.joinToString("\n")

internal fun normalizeDocument(value: String): String {
    val v=value.trim()
    if(!Regex("^[0-9]{8}-?[0-9]$").matches(v)) throw DeskException(R.string.desk_dui_error)
    val digits=v.replace("-","")
    return digits.take(8)+"-"+digits.takeLast(1)
}

internal fun ReceptionDeskActivity.patientCard(p: JSONObject, record: String?, target: LinearLayout = binding.content): LinearLayout {
    if(record!=null) p.put("record_code",record)
    val body=card(getString(R.string.desk_patient_data), "", target)

    // Cabecera como la tarjeta del ADMIN: avatar, nombre y píldora verde del expediente.
    val name=listOf(p.value("first_name"),p.value("last_name")).filter{it.isNotBlank()}.joinToString(" ")
    val heading=LinearLayout(this).apply {
        orientation=LinearLayout.HORIZONTAL
        gravity=android.view.Gravity.CENTER_VERTICAL
    }
    heading.addView(ImageView(this).apply {
        setImageResource(R.drawable.ic_reception_patient)
        setColorFilter(getColor(R.color.wine_primary))
        setBackgroundResource(R.drawable.bg_pill_pink)
        layoutParams=LinearLayout.LayoutParams(dp(40),dp(40)).apply {rightMargin=dp(12)}
        setPadding(dp(9),dp(9),dp(9),dp(9))
        importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
    })
    if(name.isNotBlank()) heading.addView(TextView(this).apply {
        text=name;textSize=15f
        setTypeface(typeface,android.graphics.Typeface.BOLD)
        setTextColor(getColor(R.color.text_primary))
        layoutParams=LinearLayout.LayoutParams(0,-2,1f)
    })
    if(record!=null) heading.addView(TextView(this).apply {
        text=getString(R.string.desk_record,record);textSize=12f
        setTextColor(getColor(R.color.text_primary))
        setBackgroundResource(R.drawable.bg_badge_confirmed)
        setPadding(dp(10),dp(6),dp(10),dp(6))
    })
    body.addView(heading)

    // Rejilla de datos: etiqueta fina sobre valor, dos columnas (dl del ADMIN).
    val fields=listOf(
        R.string.desk_data_dui to p.value("dui"),
        R.string.desk_data_birth to p.value("birth_date"),
        R.string.desk_data_phone to p.value("phone"),
        R.string.desk_email to p.value("email"),
        R.string.desk_city to p.value("city"),
        R.string.desk_patient_code to p.value("patient_code")
    ).filter{it.second.isNotBlank()}
    val grid=LinearLayout(this).apply {
        orientation=LinearLayout.VERTICAL
        layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(16)}
    }
    fields.chunked(2).forEach { pair ->
        val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
        pair.forEach { (label,value) ->
            row.addView(LinearLayout(this).apply {
                orientation=LinearLayout.VERTICAL
                layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply {rightMargin=dp(16);bottomMargin=dp(12)}
                addView(TextView(context).apply {
                    text=getString(label);textSize=11f
                    setTextColor(getColor(R.color.text_secondary))
                })
                addView(TextView(context).apply {
                    text=value;textSize=13f
                    setTextColor(getColor(R.color.text_primary))
                    layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(3)}
                })
            })
        }
        grid.addView(row)
    }
    body.addView(grid)

    // Estado del expediente: aviso destacado cuando no existe (como el directorio del ADMIN).
    if(record==null) body.addView(TextView(this).apply {
        text=getString(R.string.desk_missing_record);textSize=12f
        setTextColor(getColor(R.color.text_primary))
        setBackgroundResource(R.drawable.bg_badge_waiting)
        setPadding(dp(12),dp(10),dp(12),dp(10))
        layoutParams=LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(14)}
    })
    return body
}

class ReceptionPatientsActivity : ReceptionDeskActivity() {
    override val titleRes=R.string.desk_patients
    override fun render() {
        clear()
        val form=card(getString(R.string.desk_lookup))
        val document=field(R.string.desk_dui,form,max=10)
        document.inputType=InputType.TYPE_CLASS_PHONE
        val results=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
        binding.content.addView(results)
        action(R.string.desk_lookup,form) {
            val dui=runCatching {normalizeDocument(document.text.toString())}.getOrElse {showError(it);return@action}
            retry={document.requestFocus()}
            results.removeAllViews()
            work({repo.patientByDui(dui)?.let {it to repo.record(it.value("id"))}}) { found ->
                if(found==null) note(getString(R.string.desk_not_found),results)
                else {
                    val body=patientCard(found.first,found.second,results)
                    // Mismo patrón que la ficha de Atención presencial: identidad verificada antes de agendar.
                    if(found.second!=null) {
                        val verified=check(target=body)
                        action(R.string.desk_schedule,body) {
                            if(!verified.isChecked) {showError(DeskException(R.string.desk_identity_required));return@action}
                            ReceptionScheduling(this).open(found.first)
                        }
                    }
                }
            }
        }
    }
}
