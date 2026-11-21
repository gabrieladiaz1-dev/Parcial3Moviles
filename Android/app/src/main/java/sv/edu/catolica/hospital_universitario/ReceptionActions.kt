package sv.edu.catolica.hospital_universitario

import android.app.DatePickerDialog
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Formularios de recepción que conservan UUID y usan exclusivamente operaciones del servidor. */
object ReceptionActions {
    private val repository: ReceptionRepository get() = AppContainer.receptionRepository

    fun schedule(activity: AppCompatActivity, refresh: () -> Unit) {
        val today = LocalDate.now(ZoneId.of("America/El_Salvador"))
        DatePickerDialog(activity, { _, year, month, day ->
            val date = LocalDate.of(year, month + 1, day)
            RemoteUi.run(activity, {
                AppContainer.patientRepository.refresh()
                AppContainer.patientRepository.getAll() to repository.availability(date)
            }) { (patients, slots) ->
                if (patients.isEmpty()) {
                    MaterialAlertDialogBuilder(activity).setMessage(R.string.patients_empty)
                        .setPositiveButton(R.string.action_register_patient) { _, _ -> Navigator.goToPatients(activity) }
                        .setNegativeButton(R.string.list_cancel, null).show()
                } else if (slots.isEmpty()) {
                    MaterialAlertDialogBuilder(activity).setMessage(R.string.remote_no_slots)
                        .setPositiveButton(R.string.remote_retry) { _, _ -> schedule(activity, refresh) }
                        .setNegativeButton(R.string.list_cancel, null).show()
                } else {
                    MaterialAlertDialogBuilder(activity).setTitle(R.string.remote_select_patient)
                        .setItems(patients.map {
                            activity.getString(R.string.patient_card_name, it.fullName, it.record)
                        }.toTypedArray()) { _, patientIndex ->
                            MaterialAlertDialogBuilder(activity).setTitle(R.string.remote_select_slot)
                                .setItems(slots.map { slot ->
                                    activity.getString(R.string.remote_slot, time(slot.startsAt), time(slot.endsAt),
                                        slot.doctorName, slot.roomCode)
                                }.toTypedArray()) { _, slotIndex ->
                                    val slot = slots[slotIndex]
                                    confirm(activity, {
                                        repository.schedule(patients[patientIndex].id, slot)
                                    }, refresh)
                                }.setNegativeButton(R.string.list_cancel, null).show()
                        }.setNegativeButton(R.string.list_cancel, null).show()
                }
            }
        }, today.year, today.monthValue - 1, today.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis()
        }.show()
    }

    fun appointment(activity: AppCompatActivity, entry: Entry, refresh: () -> Unit) {
        val next = when (entry.stateCode) {
            "programada" -> listOf("confirmada", "en_atencion", "no_asistio")
            "confirmada" -> listOf("en_atencion", "no_asistio")
            "en_atencion" -> listOf("completada")
            else -> emptyList()
        }
        val labels = next.map { activity.getString(ReceptionStatuses.option(it).labelRes) }.toMutableList()
        val canCancel = entry.stateCode in listOf("programada", "confirmada")
        if (canCancel) labels.add(activity.getString(R.string.remote_appointment_cancel))
        if (labels.isEmpty()) {
            MaterialAlertDialogBuilder(activity).setTitle(entry.displayTitle)
                .setMessage(activity.getString(R.string.remote_entry_details,
                    entry.meta, activity.getString(entry.status.labelRes)))
                .setPositiveButton(R.string.list_close, null).show()
            return
        }
        MaterialAlertDialogBuilder(activity).setTitle(entry.displayTitle)
            .setItems(labels.toTypedArray()) { _, which ->
                if (which < next.size) {
                    confirm(activity, { repository.changeAppointment(entry.remoteId, next[which]) }, refresh)
                } else {
                    val reason = EditText(activity).apply { setHint(R.string.remote_cancel_reason) }
                    MaterialAlertDialogBuilder(activity).setTitle(R.string.remote_appointment_cancel)
                        .setView(reason)
                        .setPositiveButton(R.string.remote_confirm) { _, _ ->
                            val text = reason.text.toString().trim().ifBlank { null }
                            RemoteUi.run(activity, {
                                repository.cancelAppointment(entry.remoteId, text)
                            }) { saved(activity, refresh) }
                        }.setNegativeButton(R.string.list_cancel, null).show()
                }
            }.setNegativeButton(R.string.list_close, null).show()
    }

    fun admission(activity: AppCompatActivity, entry: Entry, refresh: () -> Unit) {
        val builder = MaterialAlertDialogBuilder(activity).setTitle(entry.title)
            .setMessage(activity.getString(R.string.remote_admission_details, entry.meta,
                activity.getString(entry.status.labelRes),
                activity.getString(if (entry.roomKind == "vip") R.string.remote_room_vip else R.string.remote_room_semi)))
            .setNegativeButton(R.string.list_close, null)
        if (entry.stateCode == "solicitado") {
            builder.setPositiveButton(R.string.remote_assign_bed) { _, _ ->
                RemoteUi.run(activity, { repository.beds().filter {
                    it.kind == entry.roomKind && it.state == "disponible"
                } }) { beds ->
                    if (beds.isEmpty()) {
                        Toast.makeText(activity, R.string.remote_no_beds, Toast.LENGTH_LONG).show()
                    } else {
                        MaterialAlertDialogBuilder(activity).setTitle(R.string.remote_assign_bed)
                            .setItems(beds.map { it.code }.toTypedArray()) { _, index ->
                                confirm(activity, { repository.assignBed(entry.remoteId, beds[index].id) }, refresh)
                            }.setNegativeButton(R.string.list_cancel, null).show()
                    }
                }
            }
        } else if (entry.stateCode == "alta_medica") {
            builder.setPositiveButton(R.string.remote_release_bed) { _, _ ->
                confirm(activity, { repository.releaseBed(entry.remoteId) }, refresh)
            }
        }
        builder.show()
    }

    private fun confirm(activity: AppCompatActivity, action: () -> Unit, refresh: () -> Unit) {
        MaterialAlertDialogBuilder(activity).setMessage(R.string.remote_confirm_action)
            .setPositiveButton(R.string.remote_confirm) { _, _ ->
                RemoteUi.run(activity, action) { saved(activity, refresh) }
            }.setNegativeButton(R.string.list_cancel, null).show()
    }

    private fun saved(activity: AppCompatActivity, refresh: () -> Unit) {
        Toast.makeText(activity, R.string.remote_saved, Toast.LENGTH_SHORT).show()
        refresh()
    }

    private fun time(value: String): String = OffsetDateTime.parse(value)
        .atZoneSameInstant(ZoneId.of("America/El_Salvador"))
        .format(DateTimeFormatter.ofPattern("hh:mm a", java.util.Locale.US))
        .lowercase(java.util.Locale.US)
}
